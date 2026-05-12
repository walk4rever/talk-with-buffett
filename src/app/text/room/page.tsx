import { Suspense } from "react";
import { TextRoomWorkspace } from "@/components/TextRoomWorkspace";
import { SiteNav } from "@/components/SiteNav";

export const metadata = {
  title: "Text Room — Talk with Buffett",
  description: "文字对话房间：提问、追问，并同步查看引用原文。",
};

export default function TextRoomPage() {
  return (
    <>
      <SiteNav />
      <Suspense>
        <TextRoomWorkspace />
      </Suspense>
    </>
  );
}
