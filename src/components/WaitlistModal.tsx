"use client";

import { useState } from "react";

interface WaitlistModalProps {
  source: string;
  trigger?: React.ReactNode;
  title?: string;
  desc?: string;
}

export function WaitlistModal({
  source,
  trigger,
  title = "获取早期体验资格",
  desc = "留下你的邮箱或微信，我们会在新功能上线时第一时间通知你。",
}: WaitlistModalProps) {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function submit() {
    if (!contact.trim()) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact, source }),
      });
      setStatus(res.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <>
      <span onClick={() => setOpen(true)} style={{ cursor: "pointer" }}>
        {trigger ?? <button className="waitlist-btn">加入候补名单</button>}
      </span>

      {open && (
        <div className="waitlist-overlay" onClick={() => setOpen(false)}>
          <div className="waitlist-modal" onClick={(e) => e.stopPropagation()}>
            <button className="waitlist-close" onClick={() => setOpen(false)}>✕</button>

            {status === "done" ? (
              <div className="waitlist-done">
                <div className="waitlist-done-icon">✓</div>
                <p>已收到，感谢你的支持！</p>
              </div>
            ) : (
              <>
                <h3 className="waitlist-title">{title}</h3>
                <p className="waitlist-desc">{desc}</p>
                <input
                  className="waitlist-input"
                  type="text"
                  placeholder="邮箱 或 微信号"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  autoFocus
                />
                {status === "error" && (
                  <p className="waitlist-error">提交失败，请稍后重试</p>
                )}
                <button
                  className="waitlist-submit"
                  onClick={submit}
                  disabled={status === "loading"}
                >
                  {status === "loading" ? "提交中…" : "提交"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
