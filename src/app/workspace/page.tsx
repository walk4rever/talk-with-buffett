import { Suspense } from "react";
import { Workspace } from "@/components/Workspace";

export const metadata = { title: "对话与原文 — Talk with Buffett" };

export default function WorkspacePage() {
  return (
    <Suspense>
      <Workspace />
    </Suspense>
  );
}
