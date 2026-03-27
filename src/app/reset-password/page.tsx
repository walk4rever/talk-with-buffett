"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const email = params.get("email") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (!token || !email) {
    return (
      <div className="login-wrap">
        <Link href="/" className="login-brand">Talk with Buffett</Link>
        <div className="login-card">
          <p className="login-error">链接无效，请重新申请密码重置。</p>
          <Link href="/login" className="login-submit" style={{ display: "block", textAlign: "center", marginTop: 16 }}>返回登录</Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("两次密码不一致"); return; }
    if (password.length < 6) { setError("密码至少 6 位"); return; }

    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, token, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) { setError(data.error ?? "重置失败，请重试"); return; }
    setDone(true);
    setTimeout(() => router.push("/login"), 2000);
  }

  if (done) {
    return (
      <div className="login-wrap">
        <Link href="/" className="login-brand">Talk with Buffett</Link>
        <div className="login-card">
          <p style={{ textAlign: "center", color: "var(--accent)" }}>密码重置成功，正在跳转登录…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <Link href="/" className="login-brand">Talk with Buffett</Link>
      <div className="login-card">
        <div className="login-tabs">
          <span className="login-tab login-tab--active">设置新密码</span>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <input
            className="login-input"
            type="password"
            placeholder="新密码（至少 6 位）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
          <input
            className="login-input"
            type="password"
            placeholder="确认新密码"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          {error && <p className="login-error">{error}</p>}
          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? "请稍候…" : "确认重置"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
