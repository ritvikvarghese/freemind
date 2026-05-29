"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Toast = { id: number; message: string; kind: "info" | "error" };

type ToastApi = {
  show: (message: string, kind?: Toast["kind"]) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, kind: Toast["kind"] = "info") => {
    setToasts((prev) => [...prev, { id: Date.now() + Math.random(), message, kind }]);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((prev) => prev.slice(1)), 4500);
    return () => clearTimeout(t);
  }, [toasts]);

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-panel border border-hairline bg-elevated px-3.5 py-2 text-[12px] text-text-primary shadow-[var(--shadow-floating)]"
            style={
              t.kind === "error"
                ? { color: "var(--color-error)", borderColor: "var(--color-error)" }
                : undefined
            }
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

// Imperative escape hatch for non-React modules (e.g. tldraw drop handlers).
let imperativeApi: ToastApi | null = null;

export function ToastBridge() {
  const api = useToast();
  useEffect(() => {
    imperativeApi = api;
    return () => {
      if (imperativeApi === api) imperativeApi = null;
    };
  }, [api]);
  return null;
}

export function toast(message: string, kind: Toast["kind"] = "info") {
  if (imperativeApi) imperativeApi.show(message, kind);
}
