"use client";

import dynamic from "next/dynamic";

const HomeInner = dynamic(
  () => import("@/components/home/HomeInner").then((m) => m.HomeInner),
  { ssr: false },
);

export default function Page() {
  return <HomeInner />;
}
