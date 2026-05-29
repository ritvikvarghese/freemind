"use client";

import dynamic from "next/dynamic";
import { use } from "react";

const BoardPageInner = dynamic(
  () =>
    import("@/components/home/BoardPageInner").then((m) => m.BoardPageInner),
  { ssr: false },
);

export default function Page({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = use(params);
  return <BoardPageInner boardId={boardId} />;
}
