"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Source {
  year: number;
  title: string | null;
  letterType: string;
  excerpt: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  streaming?: boolean;
}

interface ChatDrawerProps {
  open: boolean;
  onClose: () => void;
}

async function streamChatAPI(
  messages: Message[],
  onDelta: (text: string) => void,
  onDone: (sources: Source[]) => void,
  onError: (msg: string) => void,
) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (res.status === 429) {
    const data = await res.json().catch(() => null);
    onError(data?.error ?? "今日免费次数已用完，请明天再来。");
    return;
  }

  if (!res.ok) {
    onError("抱歉，服务暂时不可用，请稍后重试。");
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let gotDone = false;

  function processLines(lines: string[]) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { currentEvent = ""; continue; }
      if (trimmed.startsWith("event: ")) { currentEvent = trimmed.slice(7); continue; }
      if (trimmed.startsWith("data: ")) {
        const payload = trimmed.slice(6);
        if (currentEvent === "delta") {
          try { onDelta(JSON.parse(payload)); } catch { /* skip */ }
        } else if (currentEvent === "done") {
          try { onDone(JSON.parse(payload).sources ?? []); } catch { onDone([]); }
          gotDone = true;
        } else if (currentEvent === "error") {
          onError("抱歉，服务暂时不可用，请稍后重试。");
        }
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      processLines(lines);
    }
    if (done) {
      if (buffer.trim()) {
        processLines([buffer]);
      }
      break;
    }
  }

  if (!gotDone) {
    onDone([]);
  }
}

export function ChatDrawer({ open, onClose }: ChatDrawerProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamingTextRef = useRef("");

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    streamingTextRef.current = "";

    const placeholder: Message = { role: "assistant", content: "", streaming: true };
    setMessages((prev) => [...prev, placeholder]);

    const allMessages = [...messages, userMsg];

    await streamChatAPI(
      allMessages,
      (delta) => {
        streamingTextRef.current += delta;
        const currentText = streamingTextRef.current;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content: currentText };
          return updated;
        });
      },
      (sources) => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            sources,
            streaming: false,
          };
          return updated;
        });
        setLoading(false);
      },
      (errorMsg) => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: errorMsg, streaming: false };
          return updated;
        });
        setLoading(false);
      },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, loading]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <>
      {open && (
        <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      )}

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
            <div key={i} className={`drawer-msg drawer-msg--${msg.role}`}>
              {msg.role === "assistant" && (
                <span className="drawer-msg-label">巴菲特</span>
              )}
              {msg.role === "assistant" && msg.streaming && !msg.content ? (
                <p className="drawer-msg-content drawer-thinking">
                  <span className="dot" /><span className="dot" /><span className="dot" />
                </p>
              ) : msg.role === "assistant" ? (
                <>
                  <div className="drawer-msg-content msg-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="sources">
                      <p className="sources-label">相关原文</p>
                      {msg.sources.map((s, j) => (
                        <DrawerSourceCard key={j} source={s} />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="drawer-msg-content">{msg.content}</p>
              )}
            </div>
          ))}
          {loading && messages[messages.length - 1]?.content === "" && null}
          <div ref={bottomRef} />
        </div>

        <form className="drawer-input-bar" onSubmit={handleSubmit}>
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

function DrawerSourceCard({ source }: { source: Source }) {
  const letterLabel = source.letterType === "partnership" ? "合伙人信" : "股东信";
  const linkType = source.letterType === "partnership" ? "partnership" : "shareholder";

  return (
    <div className="source-card">
      <div className="source-header">
        <span className="source-year">
          {source.year} 年{letterLabel}
          {source.title ? ` · ${source.title}` : ""}
        </span>
        <Link href={`/letters/${linkType}/${source.year}`} className="source-link">
          查看 →
        </Link>
      </div>
      <blockquote className="source-quote">{source.excerpt}</blockquote>
    </div>
  );
}
