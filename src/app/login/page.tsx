import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export const metadata = { title: "登录 / 注册 — Talk with Buffett" };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
