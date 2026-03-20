import { Suspense } from "react";
import { ChatPage } from "@/components/ChatPage";

export const metadata = {
  title: "与巴菲特对话 — Talk with Buffett",
};

export default function Chat() {
  return (
    <Suspense>
      <ChatPage />
    </Suspense>
  );
}
