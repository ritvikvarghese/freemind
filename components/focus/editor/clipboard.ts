import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { imageFiles, insertImageFiles } from "./insertImages";

/**
 * Paste and drop handling for the document editor.
 *
 * - Image files (screenshot, "Copy image", drag from Finder) become image nodes
 *   at the cursor or drop point instead of the browser opening the file.
 * - An HTML table always beats an image on the clipboard: Excel and Numbers
 *   put a picture of the copied cells next to the table HTML, and we want the
 *   cells, not the picture.
 * - Pasted HTML tables are normalized to what a GFM markdown table can hold
 *   (see `normalizeTables`), since markdown is the persisted format.
 * - Plain-text markdown pipe tables and tab-separated rows become tables.
 */
export const DocumentClipboard = Extension.create({
  name: "documentClipboard",

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("documentClipboard"),
        props: {
          transformPastedHTML: (html) =>
            TABLE_TAG.test(html) ? normalizeTables(html) : html,

          handlePaste: (view, event) => {
            const data = event.clipboardData;
            if (!data) return false;
            const html = data.getData("text/html");
            if (TABLE_TAG.test(html)) return false;

            const images = imageFiles(data.files);
            if (images.length) {
              event.preventDefault();
              void insertImageFiles(view, images);
              return true;
            }

            // Converting plain text into a table only makes sense in normal
            // prose: not inside code, and not inside a table (that would nest).
            if (html || inCodeOrTable(view)) return false;
            const markdown = plainTextToTableMarkdown(data.getData("text/plain"));
            if (!markdown) return false;
            event.preventDefault();
            editor.commands.insertContent(markdown, { contentType: "markdown" });
            return true;
          },

          handleDrop: (view, event, _slice, moved) => {
            if (moved || !event.dataTransfer?.files.length) return false;
            const images = imageFiles(event.dataTransfer.files);
            if (images.length) {
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              void insertImageFiles(view, images, at?.pos);
            }
            // Returning true makes ProseMirror preventDefault, so a dropped
            // file never makes the browser navigate away, image or not.
            return true;
          },
        },
      }),
    ];
  },
});

const TABLE_TAG = /<table[\s>]/i;

function inCodeOrTable(view: EditorView): boolean {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "codeBlock" || name === "table") return true;
  }
  return false;
}

const BLOCK_IN_CELL = "p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, pre";

/**
 * Rebuild every pasted table as a plain grid a GFM table can persist: merged
 * cells are split (the span's extra slots become empty cells), block content
 * inside a cell is flattened to one line, images in cells are dropped, and the
 * first row is always the header. Inline marks (bold, links, code) survive.
 * Google Sheets' wrapper and inline styles fall away because only the rebuilt
 * cell content is kept.
 */
function normalizeTables(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const table of Array.from(doc.querySelectorAll("table"))) {
    // Skip tables nested in another table's cell; the outer rebuild flattens them.
    if (table.parentElement?.closest("table")) continue;
    table.replaceWith(rebuildTable(doc, table));
  }
  return doc.body.innerHTML;
}

function rebuildTable(doc: Document, table: HTMLTableElement): HTMLTableElement {
  const grid: string[][] = [];
  Array.from(table.rows).forEach((row, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const cell of Array.from(row.cells)) {
      while (grid[r][c] !== undefined) c++;
      const colspan = Math.max(1, cell.colSpan || 1);
      const rowspan = Math.max(1, cell.rowSpan || 1);
      for (let dr = 0; dr < rowspan; dr++) {
        grid[r + dr] ??= [];
        for (let dc = 0; dc < colspan; dc++) {
          grid[r + dr][c + dc] = dr === 0 && dc === 0 ? flattenCell(cell) : "";
        }
      }
      c += colspan;
    }
  });

  const width = Math.max(1, ...grid.map((row) => row.length));
  const out = doc.createElement("table");
  const body = doc.createElement("tbody");
  grid.forEach((row, r) => {
    const tr = doc.createElement("tr");
    for (let c = 0; c < width; c++) {
      const cell = doc.createElement(r === 0 ? "th" : "td");
      const p = doc.createElement("p");
      p.innerHTML = row[c] ?? "";
      cell.appendChild(p);
      tr.appendChild(cell);
    }
    body.appendChild(tr);
  });
  out.appendChild(body);
  return out;
}

function flattenCell(cell: HTMLTableCellElement): string {
  const copy = cell.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("img, table, style, script").forEach((el) => el.remove());
  copy.querySelectorAll("br").forEach((el) => el.replaceWith(" "));
  // Deepest first, so nested blocks unwrap cleanly into their parent.
  const blocks = Array.from(copy.querySelectorAll(BLOCK_IN_CELL)).reverse();
  for (const el of blocks) el.replaceWith(" ", ...Array.from(el.childNodes), " ");
  return copy.innerHTML.replace(/\s+/g, " ").trim();
}

const PIPE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/**
 * Markdown for a table if `text` is a GFM pipe table or tab-separated rows
 * (spreadsheets copied as plain text), otherwise null.
 */
export function plainTextToTableMarkdown(text: string): string | null {
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n");
  if (lines.length < 2) return null;

  if (lines[0].includes("|") && PIPE_SEPARATOR.test(lines[1])) return lines.join("\n");

  if (!lines.every((line) => line.includes("\t"))) return null;
  const rows = lines.map((line) => line.split("\t").map((cell) => cell.trim()));
  const width = rows[0].length;
  if (width < 2 || rows.some((row) => row.length !== width)) return null;
  const toRow = (cells: string[]) =>
    `| ${cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`;
  return [
    toRow(rows[0]),
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...rows.slice(1).map(toRow),
  ].join("\n");
}
