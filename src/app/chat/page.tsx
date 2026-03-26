import { Suspense } from "react";
import { Workspace } from "@/components/Workspace";

export const metadata = {
  title: "与巴菲特对话 — Talk with Buffett",
};

export default function ChatPage() {
  return (
    <Suspense>
      <Workspace />
    </Suspense>
  );
}
