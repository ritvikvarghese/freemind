"use client";

import { useEffect } from "react";
import { MinimalToolbar } from "./toolbar/MinimalToolbar";
import { FloatingToolbar } from "./toolbar/FloatingToolbar";
import { EmptyState } from "./EmptyState";
import { FloatingPrompt } from "./prompt/FloatingPrompt";
import { FocusMode } from "@/components/focus/FocusMode";
import { closeFocus, useFocusShapeId } from "@/lib/focus/openFocus";
import { ApiKeyPanel } from "@/components/settings/ApiKeyPanel";
import { ChatDock } from "./chat/ChatDock";
import { ChatsMenu } from "./chat/ChatsMenu";
import { useBoardKey } from "./BoardContext";
import { closeChat, useOpenChatId } from "@/lib/chat/openChat";
import { useCanvasChat } from "@/lib/storage/canvasChats";

export function CanvasOverlay() {
  const focusShapeId = useFocusShapeId();
  const boardKey = useBoardKey();
  const openChatId = useOpenChatId();
  const openSession = useCanvasChat(openChatId);

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
      <MinimalToolbar />
      <FloatingToolbar />
      <ApiKeyPanel />
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
