"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function ChatDrawer({ open, onClose }: ChatDrawerProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      });

      const data = await res.json();

      if (res.status === 429) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.error ?? "今日次数已用完，请明天再来。" },
        ]);
      } else if (res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.reply },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "暂时无法回答，请稍后再试。" },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "网络错误，请稍后再试。" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      )}

      {/* Drawer panel */}
      <aside className={`chat-drawer${open ? " chat-drawer--open" : ""}`} aria-label="与巴菲特对话">
        <div className="drawer-header">
          <span className="drawer-title">与巴菲特对话</span>
          <button className="drawer-close" onClick={onClose} aria-label="关闭">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="drawer-messages">
          {messages.length === 0 && (
            <div className="drawer-empty">
              <p>你正在阅读巴菲特致股东信。</p>
              <p>问他任何关于这封信、投资理念或具体公司的问题。</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`drawer-msg drawer-msg--${msg.role}`}
            >
              {msg.role === "assistant" && (
                <span className="drawer-msg-label">巴菲特</span>
              )}
              <p className="drawer-msg-content">{msg.content}</p>
            </div>
          ))}
          {loading && (
            <div className="drawer-msg drawer-msg--assistant">
              <span className="drawer-msg-label">巴菲特</span>
              <p className="drawer-msg-content drawer-thinking">
                <span className="dot" /><span className="dot" /><span className="dot" />
              </p>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form className="drawer-input-bar" onSubmit={handleSend}>
          <input
            className="drawer-input"
            type="text"
            placeholder="输入你的问题…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button
            className="drawer-send"
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="发送"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M3 9h12M10 4l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </form>
      </aside>
    </>
  );
}
