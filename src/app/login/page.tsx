import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";
import { SiteNav } from "@/components/SiteNav";

export const metadata = { title: "登录 / 注册 — Buffett Tribe" };

export default function LoginPage() {
  return (
    <div className="login-page">
      <SiteNav />
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
