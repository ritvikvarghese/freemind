"use client";

import { useEffect } from "react";
import { useEditor } from "tldraw";
import { MinimalToolbar } from "./toolbar/MinimalToolbar";
import { FloatingToolbar } from "./toolbar/FloatingToolbar";
import { EmptyState } from "./EmptyState";
import { FloatingPrompt } from "./prompt/FloatingPrompt";
import { FocusMode } from "@/components/focus/FocusMode";
import { closeFocus, useFocusShapeId } from "@/lib/focus/openFocus";
import { ApiKeyPanel } from "@/components/settings/ApiKeyPanel";
import { ChatDock } from "./chat/ChatDock";
import { ChatsMenu } from "./chat/ChatsMenu";
import { ConnectDots } from "./overlay/ConnectDots";
import { WelcomeModal } from "@/components/onboarding/WelcomeModal";
import { useBoardKey } from "./BoardContext";
import { closeChat, useOpenChatId } from "@/lib/chat/openChat";
import { useCanvasChat } from "@/lib/storage/canvasChats";
import { clearCanvas } from "@/lib/canvas/clearCanvas";
import { toast } from "@/components/canvas/toast";

export function CanvasOverlay() {
  const editor = useEditor();
  const focusShapeId = useFocusShapeId();
  const boardKey = useBoardKey();
  const openChatId = useOpenChatId();
  const openSession = useCanvasChat(openChatId);

  // Clear-canvas lives in the settings panel but needs the editor + toast,
  // which only exist in-canvas. We pass it down so the panel itself stays
  // editor-free and reusable on the home screen (where it is omitted).
  function handleClearCanvas() {
    const removed = clearCanvas(editor);
    if (removed === 0) {
      toast("Canvas was already empty.");
    } else {
      toast(
        `Cleared ${removed} shape${removed === 1 ? "" : "s"} — undo if needed (⌘Z).`,
      );
    }
  }

  // The open-chat state is global (module-level), but a chat belongs to exactly
  // one canvas. If the user switches canvases without closing the dock, the open
  // id now points at the *other* board's chat — drop it so the dock and the
  // board-shifted top-right cluster (ChatsMenu/gear) reset together.
  const dockOnThisBoard =
    !!openSession && openSession.boardPersistenceKey === boardKey;
  useEffect(() => {
    if (openChatId && !dockOnThisBoard) closeChat();
  }, [openChatId, dockOnThisBoard]);

  return (
    <>
      <EmptyState />
      <ConnectDots />
      <MinimalToolbar />
      <FloatingToolbar />
      <ApiKeyPanel onClearCanvas={handleClearCanvas} />
      <WelcomeModal />
      <ChatsMenu />
      <FloatingPrompt />
      {dockOnThisBoard ? (
        <ChatDock key={openSession.id} id={openSession.id} />
      ) : null}
      {focusShapeId ? (
        <FocusMode shapeId={focusShapeId} onClose={closeFocus} />
      ) : null}
    </>
  );
}
