"use client";

import { MinimalToolbar } from "./toolbar/MinimalToolbar";
import { EmptyState } from "./EmptyState";
import { FloatingPrompt } from "./prompt/FloatingPrompt";
import { FocusMode } from "@/components/focus/FocusMode";
import { closeFocus, useFocusShapeId } from "@/lib/focus/openFocus";
import { ApiKeyPanel } from "@/components/settings/ApiKeyPanel";

export function CanvasOverlay() {
  const focusShapeId = useFocusShapeId();
  return (
    <>
      <EmptyState />
      <MinimalToolbar />
      <ApiKeyPanel />
      <FloatingPrompt />
      {focusShapeId ? (
        <FocusMode shapeId={focusShapeId} onClose={closeFocus} />
      ) : null}
    </>
  );
}
