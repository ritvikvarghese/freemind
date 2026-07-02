"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect } from "react";
import { getBoard } from "@/lib/storage/boards";
import { abortRun, getActiveShapeId } from "@/lib/agent/abortRegistry";

const CanvasRoot = dynamic(
  () => import("@/components/canvas/CanvasRoot").then((m) => m.CanvasRoot),
  { ssr: false },
);

// Board page body — client-only via the dynamic({ ssr: false }) wrapper in
// app/b/[boardId]/page.tsx. Looks up the board synchronously from
// localStorage; renders the canvas or a not-found view.
export function BoardPageInner({ boardId }: { boardId: string }) {
  const board = getBoard(boardId);

  // Abort any active research run when leaving this board. Without this, a
  // streaming run keeps writing into the board's DocumentNode after we've
  // navigated away — see plan #1, gotcha discussion.
  useEffect(
    () => () => {
      const id = getActiveShapeId();
      if (id) abortRun(id);
    },
    [],
  );

  if (!board) {
    return (
      <div className="grid place-items-center min-h-screen text-text-tertiary px-6 text-center">
        <div>
          Board not found.{" "}
          <Link href="/" className="underline text-text-secondary">
            Go home
          </Link>
          .
        </div>
      </div>
    );
  }

  return (
    <CanvasRoot
      key={board.persistenceKey}
      persistenceKey={board.persistenceKey}
      boardId={board.id}
    />
  );
}
