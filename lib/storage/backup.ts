"use client";

/**
 * Whole-app backup. Everything lives in the browser (IndexedDB + localStorage)
 * with no server, so this is the only real safety net against an accidental
 * "clear data", storage eviction, or moving machines.
 *
 * Export dumps every app + tldraw IndexedDB database generically (schema +
 * records, with Blob/binary-safe encoding) plus our localStorage (minus the API
 * key) into one JSON file. Import is non-destructive: it restores what's MISSING
 * locally and never clobbers an existing board's live canvas.
 */

const LS_PREFIX = "canvas-ai";
const API_KEY_LS = "canvas-ai:anthropic-api-key"; // never exported (secret)
// IndexedDB databases we own: our stores + tldraw's per-board stores.
const IDB_PREFIXES = ["canvas-ai-", "TLDRAW_"];

export const BACKUP_VERSION = 1;

type IndexDump = {
  name: string;
  keyPath: string | string[];
  unique: boolean;
  multiEntry: boolean;
};
type StoreDump = {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: IndexDump[];
  // `key` is present only for out-of-line stores (keyPath === null).
  records: { key?: IDBValidKey; value: unknown }[];
};
type DbDump = { name: string; version: number; stores: StoreDump[] };

export type BackupFile = {
  format: "freemind-backup";
  version: number;
  createdAt: string;
  localStorage: Record<string, string>;
  databases: DbDump[];
};

export type ImportResult = {
  boardsAdded: number;
  databasesRestored: number;
  databasesSkipped: number;
  recordsMerged: number;
  lsKeysRestored: number;
};

// --- Blob / binary encoding (JSON can't hold Blob/ArrayBuffer) ----------------

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function encodeValue(v: unknown): Promise<unknown> {
  if (v == null || typeof v !== "object") return v;
  if (v instanceof Blob) {
    const buf = new Uint8Array(await v.arrayBuffer());
    return { __t: "blob", type: v.type, b64: bytesToB64(buf) };
  }
  if (v instanceof ArrayBuffer) {
    return { __t: "ab", b64: bytesToB64(new Uint8Array(v)) };
  }
  if (ArrayBuffer.isView(v)) {
    const view = v as ArrayBufferView;
    const bytes = new Uint8Array(
      view.buffer,
      view.byteOffset,
      view.byteLength,
    );
    return { __t: "u8", b64: bytesToB64(bytes) };
  }
  if (Array.isArray(v)) {
    return Promise.all(v.map((item) => encodeValue(item)));
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) out[k] = await encodeValue(val);
  return out;
}

function decodeValue(v: unknown): unknown {
  if (v == null || typeof v !== "object") return v;
  const tag = (v as { __t?: string }).__t;
  if (tag === "blob") {
    const { type, b64 } = v as { type: string; b64: string };
    return new Blob([b64ToBytes(b64).buffer as ArrayBuffer], { type });
  }
  if (tag === "ab") return b64ToBytes((v as { b64: string }).b64).buffer;
  if (tag === "u8") return b64ToBytes((v as { b64: string }).b64);
  if (Array.isArray(v)) return v.map(decodeValue);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) out[k] = decodeValue(val);
  return out;
}

// --- raw IndexedDB helpers ----------------------------------------------------

function openDb(name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function listOurDatabases(): Promise<string[]> {
  // We can't safely probe a DB by opening it (that would CREATE an empty one),
  // so enumeration is required. Fail loudly rather than back up nothing.
  if (!indexedDB.databases) {
    throw new Error(
      "This browser can't enumerate storage (indexedDB.databases). Use Chrome or Firefox to back up.",
    );
  }
  const infos = await indexedDB.databases();
  return infos
    .map((i) => i.name)
    .filter((n): n is string => !!n && IDB_PREFIXES.some((p) => n.startsWith(p)));
}

type RawStore = {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: IndexDump[];
  values: unknown[];
  keys: IDBValidKey[] | null;
};

async function dumpDatabase(name: string): Promise<DbDump> {
  const db = await openDb(name);
  const storeNames = Array.from(db.objectStoreNames);
  const version = db.version;

  // Phase 1 — read raw values inside the transaction. CRITICAL: only IDB
  // requests may be awaited here; awaiting anything else (e.g. Blob encoding)
  // lets the transaction auto-commit and the next store access throws
  // "transaction has finished". One short read txn per store keeps it simple.
  const raws: RawStore[] = [];
  for (const sName of storeNames) {
    const tx = db.transaction([sName], "readonly");
    const store = tx.objectStore(sName);
    const indexes: IndexDump[] = Array.from(store.indexNames).map((iName) => {
      const idx = store.index(iName);
      return {
        name: iName,
        keyPath: idx.keyPath as string | string[],
        unique: idx.unique,
        multiEntry: idx.multiEntry,
      };
    });
    // Issue both requests before awaiting so the txn stays alive until they land.
    const valuesReq = store.getAll();
    const keysReq = store.keyPath === null ? store.getAllKeys() : null;
    const values = await reqToPromise(valuesReq);
    const keys = keysReq ? await reqToPromise(keysReq) : null;
    raws.push({
      name: sName,
      keyPath: store.keyPath as string | string[] | null,
      autoIncrement: store.autoIncrement,
      indexes,
      values,
      keys,
    });
  }
  db.close();

  // Phase 2 — encode (Blob/binary → base64) with no transaction open.
  const stores: StoreDump[] = [];
  for (const r of raws) {
    const records: StoreDump["records"] = [];
    for (let i = 0; i < r.values.length; i++) {
      records.push({
        ...(r.keys ? { key: r.keys[i] } : {}),
        value: await encodeValue(r.values[i]),
      });
    }
    stores.push({
      name: r.name,
      keyPath: r.keyPath,
      autoIncrement: r.autoIncrement,
      indexes: r.indexes,
      records,
    });
  }
  return { name, version, stores };
}

// --- export -------------------------------------------------------------------

export async function exportAll(): Promise<BackupFile> {
  const ls: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(LS_PREFIX) || key === API_KEY_LS) continue;
    const val = localStorage.getItem(key);
    if (val !== null) ls[key] = val;
  }
  const names = await listOurDatabases();
  const databases: DbDump[] = [];
  for (const name of names) databases.push(await dumpDatabase(name));
  return {
    format: "freemind-backup",
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    localStorage: ls,
    databases,
  };
}

/** Serialize + trigger a download of the backup file. */
export async function downloadBackup(): Promise<void> {
  const data = await exportAll();
  const stamp = data.createdAt.slice(0, 19).replace(/[:T]/g, "-");
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `freemind-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --- import (non-destructive) -------------------------------------------------

const BOARDS_LS = "canvas-ai:boards";

/** Best-effort delete of a database; resolves regardless of outcome. */
function deleteDatabaseSafe(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

function createDatabaseFromDump(dump: DbDump): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dump.name, dump.version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of dump.stores) {
        const store = db.createObjectStore(s.name, {
          keyPath: s.keyPath ?? undefined,
          autoIncrement: s.autoIncrement,
        });
        for (const idx of s.indexes) {
          store.createIndex(idx.name, idx.keyPath, {
            unique: idx.unique,
            multiEntry: idx.multiEntry,
          });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function restoreFullDatabase(dump: DbDump): Promise<number> {
  const db = await createDatabaseFromDump(dump);
  let merged = 0;
  const storeNames = dump.stores.map((s) => s.name).filter((n) =>
    db.objectStoreNames.contains(n),
  );
  if (storeNames.length > 0) {
    const tx = db.transaction(storeNames, "readwrite");
    for (const s of dump.stores) {
      if (!db.objectStoreNames.contains(s.name)) continue;
      const store = tx.objectStore(s.name);
      for (const rec of s.records) {
        const value = decodeValue(rec.value);
        if ("key" in rec) store.put(value, rec.key);
        else store.put(value);
        merged++;
      }
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  db.close();
  return merged;
}

/** Merge only records whose key isn't already present (safe for our app DBs). */
async function mergeMissingRecords(dump: DbDump): Promise<number> {
  const db = await openDb(dump.name);
  let merged = 0;
  const storeNames = dump.stores
    .map((s) => s.name)
    .filter((n) => db.objectStoreNames.contains(n));
  if (storeNames.length === 0) {
    db.close();
    return 0;
  }

  // Phase 1 — read existing keys per store (read txn, IDB awaits only).
  const existingByStore = new Map<string, Set<string>>();
  for (const name of storeNames) {
    const tx = db.transaction([name], "readonly");
    const keys = await reqToPromise(tx.objectStore(name).getAllKeys());
    existingByStore.set(name, new Set(keys.map((k) => String(k))));
  }

  // Phase 2 — write missing records (single write txn; decode is synchronous).
  const tx = db.transaction(storeNames, "readwrite");
  for (const s of dump.stores) {
    if (!db.objectStoreNames.contains(s.name)) continue;
    const existing = existingByStore.get(s.name) ?? new Set<string>();
    const store = tx.objectStore(s.name);
    for (const rec of s.records) {
      const value = decodeValue(rec.value) as Record<string, unknown>;
      // Derive the key: out-of-line records carry it; in-line use keyPath.
      let key: IDBValidKey | undefined = rec.key;
      if (key === undefined && typeof s.keyPath === "string") {
        key = value[s.keyPath] as IDBValidKey;
      }
      if (key !== undefined && existing.has(String(key))) continue;
      if ("key" in rec) store.put(value, rec.key);
      else store.put(value);
      merged++;
    }
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return merged;
}

export async function importBackup(data: BackupFile): Promise<ImportResult> {
  if (data?.format !== "freemind-backup")
    throw new Error("Not a Freemind backup file.");

  const result: ImportResult = {
    boardsAdded: 0,
    databasesRestored: 0,
    databasesSkipped: 0,
    recordsMerged: 0,
    lsKeysRestored: 0,
  };

  const existing = new Set(await listOurDatabases());
  const dumps = Array.isArray(data.databases) ? data.databases : [];

  for (const dump of dumps) {
    const isTldraw = dump.name.startsWith("TLDRAW_");
    if (!existing.has(dump.name)) {
      try {
        result.recordsMerged += await restoreFullDatabase(dump);
        result.databasesRestored++;
      } catch (err) {
        // A failed restore can leave a half-created empty DB behind. That DB
        // would then look "existing" on a retry and be skipped forever (the
        // tldraw branch never clobbers). Delete it so a retry re-attempts
        // cleanly, then surface the failure as before.
        await deleteDatabaseSafe(dump.name);
        throw err;
      }
    } else if (isTldraw) {
      // Never clobber a live canvas that already exists locally.
      result.databasesSkipped++;
    } else {
      result.recordsMerged += await mergeMissingRecords(dump);
    }
  }

  // localStorage: restore missing keys; merge the boards array by id.
  for (const [key, val] of Object.entries(data.localStorage ?? {})) {
    if (key === BOARDS_LS) continue; // handled below
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, val);
      result.lsKeysRestored++;
    }
  }
  const backupBoardsRaw = data.localStorage?.[BOARDS_LS];
  if (backupBoardsRaw) {
    result.boardsAdded = mergeBoards(backupBoardsRaw);
  }

  return result;
}

type StoredBoard = { id: string };

function mergeBoards(backupRaw: string): number {
  let backupBoards: StoredBoard[];
  try {
    backupBoards = JSON.parse(backupRaw) as StoredBoard[];
  } catch {
    return 0;
  }
  if (!Array.isArray(backupBoards)) return 0;
  let localBoards: StoredBoard[] = [];
  try {
    const raw = localStorage.getItem(BOARDS_LS);
    if (raw) localBoards = JSON.parse(raw) as StoredBoard[];
  } catch {
    localBoards = [];
  }
  const have = new Set(localBoards.map((b) => b.id));
  const added = backupBoards.filter((b) => b?.id && !have.has(b.id));
  if (added.length === 0 && localBoards.length > 0) return 0;
  localStorage.setItem(BOARDS_LS, JSON.stringify([...localBoards, ...added]));
  return added.length;
}

/** Parse + import a user-selected backup file. */
export async function importBackupFile(file: File): Promise<ImportResult> {
  const text = await file.text();
  const data = JSON.parse(text) as BackupFile;
  return importBackup(data);
}
