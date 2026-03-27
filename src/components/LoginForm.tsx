"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";

  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("邮箱或密码错误");
    } else {
      router.push(callbackUrl);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "注册失败");
      setLoading(false);
      return;
    }
    // Auto-login after register
    await signIn("credentials", { email: email.trim().toLowerCase(), password, redirect: false });
    setLoading(false);
    router.push(callbackUrl);
  }

  return (
    <div className="login-wrap">
      <Link href="/" className="login-brand">Talk with Buffett</Link>

      <div className="login-card">
        <div className="login-tabs">
          <button
            className={`login-tab${tab === "login" ? " login-tab--active" : ""}`}
            onClick={() => { setTab("login"); setError(""); }}
          >
            登录
          </button>
          <button
            className={`login-tab${tab === "register" ? " login-tab--active" : ""}`}
            onClick={() => { setTab("register"); setError(""); }}
          >
            注册
          </button>
        </div>

        <form onSubmit={tab === "login" ? handleLogin : handleRegister} className="login-form">
          {tab === "register" && (
            <input
              className="login-input"
              type="text"
              placeholder="昵称（可选）"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <input
            className="login-input"
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          <input
            className="login-input"
            type="password"
            placeholder={tab === "register" ? "密码（至少 6 位）" : "密码"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && <p className="login-error">{error}</p>}

          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? "请稍候…" : tab === "login" ? "登录" : "注册"}
          </button>
        </form>
      </div>
    </div>
  );
}
