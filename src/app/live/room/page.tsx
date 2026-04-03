import { Suspense } from "react";
import type { Metadata } from "next";
import { LiveRoomWorkspace } from "@/components/LiveRoomWorkspace";

export const metadata: Metadata = {
  title: "Live Room — Talk with Buffett",
  description: "视频对话房间：语音输入、LLM 对话、数字人播报。",
};

export default function LiveRoomPage() {
  return (
    <Suspense>
      <LiveRoomWorkspace />
    </Suspense>
  );
}
