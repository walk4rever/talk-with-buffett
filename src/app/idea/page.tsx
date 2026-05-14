import { Suspense } from "react";
import { TextRoomWorkspace } from "@/components/TextRoomWorkspace";
import { SiteNav } from "@/components/SiteNav";

export const metadata = {
  title: "Idea — 巴菲特部落",
  description: "用价值投资大师的框架理解一家公司，与大师思想直接对话。",
};

export default function IdeaPage() {
  return (
    <>
      <SiteNav />
      <Suspense>
        <TextRoomWorkspace />
      </Suspense>
    </>
  );
}
