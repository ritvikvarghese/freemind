"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

// Top-left affordance on the canvas: name of the current board + a link back
// to the home page. Sits inside the toast/overlay layer of `CanvasRoot` so it
// stays anchored regardless of canvas pan/zoom.
export function BoardHeader({ title }: { title: string }) {
  return (
    <Link
      href="/"
      className="pointer-events-auto fixed left-4 top-4 z-30 flex items-center gap-1.5 rounded-panel bg-elevated border border-hairline px-3 py-2 text-[13px] text-text-secondary hover:text-text-primary shadow-[var(--shadow-panel)] transition-colors duration-100"
      title="Back to all boards"
    >
      <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
      <span className="max-w-[200px] truncate">{title}</span>
    </Link>
  );
}
