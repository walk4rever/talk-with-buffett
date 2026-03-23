"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { WaitlistModal } from "@/components/WaitlistModal";
import {
  type ChatMessage,
  type ChatSource,
  streamChatAPI,
  getSourceTypeLabel,
} from "@/lib/chat";

const STARTERS = [
  "护城河这个概念，你怎么理解？",
  "1999年网络泡沫时你是怎么想的？",
  "什么样的生意你永远不会买？",
  "你怎么看现在的 AI 公司？",
];

// ── Canvas content cache (scroll position + content) ─────────────────────

interface CanvasContent {
  type: string;
  year: number;
  title: string;
  contentMd: string;
  videoUrl?: string | null;
  videoSource?: string | null;
}

const scrollPositions = new Map<string, number>();

function canvasKey(type: string, year: number) {
  return `${type}:${year}`;
}

// ── Strip metadata header (shared with LetterReadingArea) ────────────────

function stripHeader(md: string): string {
  const lines = md.split("\n");
  let lastMetaLine = 0;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const t = lines[i].trim();
    if (
      t.startsWith("原文信息") ||
      t.startsWith("- 标题") ||
      t.startsWith("- 作者") ||
      t.startsWith("- 发表") ||
      t.startsWith("- 链接") ||
      t.startsWith("- 中文") ||
      t.startsWith("- 整理") ||
      t.startsWith("- 修订") ||
      t.startsWith("- 校译") ||
      t.startsWith("- 校对") ||
      t.startsWith("[^") ||
      (t === "---" && i < 20) ||
      t === ""
    ) {
      lastMetaLine = i;
    }
  }
  return lines.slice(lastMetaLine + 1).join("\n").trim();
}

// ── Main Workspace Component ─────────────────────────────────────────────

export function Workspace() {
  const params = useSearchParams();
  const router = useRouter();

  // Canvas state from URL
  const canvasType = params.get("source") ?? "";
  const canvasYear = parseInt(params.get("year") ?? "0", 10);
  const hasCanvas = !!canvasType && canvasYear > 0;

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingTextRef = useRef("");

  // Canvas state
  const [canvasContent, setCanvasContent] = useState<CanvasContent | null>(null);
  const [canvasLoading, setCanvasLoading] = useState(false);
  const canvasScrollRef = useRef<HTMLDivElement>(null);

  // Mobile: which panel is active
  const [mobilePanel, setMobilePanel] = useState<"chat" | "canvas">(
    hasCanvas ? "canvas" : "chat"
  );

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Fetch canvas content when URL params change
  useEffect(() => {
    if (!hasCanvas) {
      setCanvasContent(null);
      return;
    }

    // Save current scroll position before switching
    if (canvasContent && canvasScrollRef.current) {
      const key = canvasKey(canvasContent.type, canvasContent.year);
      scrollPositions.set(key, canvasScrollRef.current.scrollTop);
    }

    let cancelled = false;
    setCanvasLoading(true);

    fetch(`/api/source?type=${canvasType}&year=${canvasYear}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setCanvasContent(data);
        setCanvasLoading(false);

        // Restore scroll position
        requestAnimationFrame(() => {
          const key = canvasKey(canvasType, canvasYear);
          const savedPos = scrollPositions.get(key);
          if (savedPos && canvasScrollRef.current) {
            canvasScrollRef.current.scrollTop = savedPos;
          }
        });
      })
      .catch(() => {
        if (!cancelled) setCanvasLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasType, canvasYear]);

  // Open a source in canvas
  const openCanvas = useCallback(
    (type: string, year: number) => {
      router.push(`/workspace?source=${type}&year=${year}`, { scroll: false });
      setMobilePanel("canvas");
    },
    [router],
  );

  // Close canvas
  const closeCanvas = useCallback(() => {
    // Save scroll position
    if (canvasContent && canvasScrollRef.current) {
      const key = canvasKey(canvasContent.type, canvasContent.year);
      scrollPositions.set(key, canvasScrollRef.current.scrollTop);
    }
    router.push("/workspace", { scroll: false });
    setMobilePanel("chat");
  }, [router, canvasContent]);

  // Send chat message
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const userMsg: ChatMessage = { role: "user", content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setLoading(true);
      streamingTextRef.current = "";

      const placeholderMsg: ChatMessage = { role: "assistant", content: "", streaming: true };
      setMessages((prev) => [...prev, placeholderMsg]);

      const allMessages = [...messages, userMsg];

      await streamChatAPI(
        allMessages,
        (delta) => {
          streamingTextRef.current += delta;
          const currentText = streamingTextRef.current;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: currentText,
            };
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
            updated[updated.length - 1] = {
              role: "assistant",
              content: errorMsg,
              streaming: false,
            };
            return updated;
          });
          setLoading(false);
        },
      );
    },
    [messages, loading],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <div className={`workspace${hasCanvas ? " workspace--split" : ""}`}>
      {/* ── Chat Panel ── */}
      <div className={`workspace-chat${mobilePanel !== "chat" && hasCanvas ? " workspace-panel--hidden-mobile" : ""}`}>
        <div className="workspace-chat-header">
          <Link href="/" className="chat-back">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            返回
          </Link>
          <span className="workspace-chat-title">与巴菲特对话</span>
          {hasCanvas && (
            <button
              className="workspace-mobile-toggle"
              onClick={() => setMobilePanel("canvas")}
            >
              查看原文
            </button>
          )}
        </div>

        <div className="workspace-chat-body">
          {messages.length === 0 ? (
            <div className="empty-chat">
              <img src="/buffett-avarta.png" alt="Warren Buffett" className="empty-chat-avatar" />
              <h2 className="empty-chat-title">与巴菲特对话</h2>
              <p className="empty-chat-sub">
                基于 1957–2025 年全部合伙人/股东信 · 每个回答标注来源
              </p>
              <div className="starter-grid">
                {STARTERS.map((s) => (
                  <button key={s} className="starter-chip" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((msg, i) => (
                <WorkspaceMessage key={i} msg={msg} onSourceClick={openCanvas} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="chat-input-wrap">
          <form className="chat-input-bar" onSubmit={handleSubmit}>
            <input
              className="chat-input"
              type="text"
              placeholder="问巴菲特任何关于投资的问题…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              autoFocus
            />
            <button
              className="chat-send-btn"
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="发送"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M3 9h12M10 4l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </form>
          <p className="chat-disclaimer">
            回答基于巴菲特公开的信件、文章与演讲，仅供学习参考。
          </p>
        </div>
      </div>

      {/* ── Canvas Panel ── */}
      {hasCanvas && (
        <div className={`workspace-canvas${mobilePanel !== "canvas" ? " workspace-panel--hidden-mobile" : ""}`}>
          <div className="workspace-canvas-header">
            <button
              className="workspace-mobile-toggle"
              onClick={() => setMobilePanel("chat")}
            >
              ← 对话
            </button>
            <span className="workspace-canvas-title">
              {canvasContent
                ? `${canvasContent.year} ${getSourceTypeLabel(canvasContent.type)}`
                : "加载中…"}
            </span>
            <button className="workspace-canvas-close" onClick={closeCanvas} aria-label="关闭">
              ✕
            </button>
          </div>

          <div className="workspace-canvas-body" ref={canvasScrollRef}>
            {canvasLoading ? (
              <div className="workspace-canvas-loading">加载中…</div>
            ) : canvasContent ? (
              <div className="md-reader" style={{ fontSize: 16, lineHeight: 1.8 }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {stripHeader(canvasContent.contentMd)}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="workspace-canvas-loading">未找到内容</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Message Bubble with source click → Canvas ────────────────────────────

function WorkspaceMessage({
  msg,
  onSourceClick,
}: {
  msg: ChatMessage;
  onSourceClick: (type: string, year: number) => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="msg msg--user">
        <p className="msg-text">{msg.content}</p>
      </div>
    );
  }

  if (msg.content.startsWith("__LIMIT__")) {
    const limitMsg = msg.content.slice(9);
    return (
      <div className="msg msg--assistant">
        <img src="/buffett-avarta.png" alt="Buffett" className="msg-avatar" />
        <div className="msg-body">
          <p className="msg-text">{limitMsg}</p>
          <WaitlistModal
            source="chat_limit"
            title="解锁无限对话"
            desc="留下邮箱或微信，付费版上线时第一时间通知你。"
            trigger={
              <button className="waitlist-btn waitlist-btn--inline">我想要更多 →</button>
            }
          />
        </div>
      </div>
    );
  }

  if (msg.streaming && !msg.content) {
    return (
      <div className="msg msg--assistant">
        <img src="/buffett-avarta.png" alt="Buffett" className="msg-avatar" />
        <div className="msg-body">
          <div className="thinking-dots">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg msg--assistant">
      <img src="/buffett-avarta.png" alt="Buffett" className="msg-avatar" />
      <div className="msg-body">
        <div className="msg-text msg-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
        </div>
        {msg.sources && msg.sources.length > 0 && (
          <div className="sources">
            <p className="sources-label">相关原文</p>
            {msg.sources.map((s, i) => (
              <WorkspaceSourceCard key={i} source={s} onClick={onSourceClick} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceSourceCard({
  source,
  onClick,
}: {
  source: ChatSource;
  onClick: (type: string, year: number) => void;
}) {
  const typeLabel = getSourceTypeLabel(source.sourceType);

  return (
    <div className="source-card">
      <div className="source-header">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 2h8v8H2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M4 5h4M4 7h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span className="source-year">
          {source.year} 年{typeLabel}
          {source.title ? ` · ${source.title}` : ""}
        </span>
        <button
          className="source-link"
          onClick={() => onClick(source.sourceType, source.year)}
        >
          查看 →
        </button>
      </div>
      <blockquote className="source-quote">{source.excerpt}</blockquote>
    </div>
  );
}
