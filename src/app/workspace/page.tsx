import { Suspense } from "react";
import { Workspace } from "@/components/Workspace";

export const metadata = { title: "工作区 — Talk with Buffett" };

export default function WorkspacePage() {
  return (
    <Suspense>
      <Workspace />
    </Suspense>
  );
}
