"use client";

import { createContext, useContext } from "react";

/**
 * Exposes the active board's persistenceKey to anything rendered inside
 * <Tldraw> (overlays via the components slot, connect handles inside shapes).
 * Reading the module-level currentBoard getter from those spots is unreliable
 * at first paint because child effects fire before the parent effect that sets
 * it — context gives them a value during render instead.
 */
const BoardKeyContext = createContext<string | null>(null);

export function BoardProvider({
  persistenceKey,
  children,
}: {
  persistenceKey: string;
  children: React.ReactNode;
}) {
  return (
    <BoardKeyContext.Provider value={persistenceKey}>
      {children}
    </BoardKeyContext.Provider>
  );
}

export function useBoardKey(): string | null {
  return useContext(BoardKeyContext);
}
