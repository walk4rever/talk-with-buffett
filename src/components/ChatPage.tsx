"use client";

import { useState, useRef, useEffect, useCallback, type ComponentPropsWithoutRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { WaitlistModal } from "@/components/WaitlistModal";

type Mode = "text" | "avatar";

interface Source {
  year: number;
  title: string | null;
  sourceType: string;
  excerpt: string;
  excerptZh?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  streaming?: boolean;
}

const STARTERS = [
  "护城河这个概念，你怎么理解？",
  "1999年网络泡沫时你是怎么想的？",
  "什么样的生意你永远不会买？",
  "你怎么看现在的 AI 公司？",
];

const WORKSPACE_CHAT_TRANSFER_KEY = "workspace-chat-transfer-v1";

const messageMarkdownComponents = {
  table: (props: ComponentPropsWithoutRef<"table">) => (
    <div className="msg-table-wrap">
      <table {...props} />
    </div>
  ),
  a: (props: ComponentPropsWithoutRef<"a">) => {
    const href = props.href ?? "";
    const isExternal = /^https?:\/\//i.test(href);
    return (
      <a
        {...props}
        target={isExternal ? "_blank" : props.target}
        rel={isExternal ? "noopener noreferrer" : props.rel}
      />
    );
  },
};

// ── SSE streaming client ─────────────────────────────────────────────────

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
    onError("__LIMIT__" + (data?.error ?? "今日免费次数已用完，请明天再来。"));
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
          try {
            const data = JSON.parse(payload);
            onDone(data.sources ?? []);
          } catch {
            onDone([]);
          }
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
      // Process any remaining data in the buffer
      if (buffer.trim()) {
        processLines([buffer]);
      }
      break;
    }
  }

  // If stream closed without a "done" event, finalize so UI doesn't stay stuck
  if (!gotDone) {
    onDone([]);
  }
}

export function ChatPage() {
  const params = useSearchParams();
  const initialMode = params.get("mode") === "avatar" ? "avatar" : "text";
  const initialQ = params.get("q") ?? "";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [avatarSpeaking, setAvatarSpeaking] = useState(false);
  const [subtitleText, setSubtitleText] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentInitialQ = useRef(false);
  // Accumulate streaming text in a ref so callbacks always see the latest
  const streamingTextRef = useRef("");

  const persistChatForWorkspace = useCallback(() => {
    try {
      const transferable = messages
        .filter((m) => m.role === "user" || m.content.trim() !== "")
        .map((m) => ({
          role: m.role,
          content: m.content,
          sources: m.sources,
        }));

      sessionStorage.setItem(
        WORKSPACE_CHAT_TRANSFER_KEY,
        JSON.stringify({ savedAt: Date.now(), messages: transferable }),
      );
    } catch {
      // Ignore storage errors; navigation should still proceed.
    }
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-send ?q= on first mount
  useEffect(() => {
    if (initialQ && !sentInitialQ.current) {
      sentInitialQ.current = true;
      send(initialQ);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: "user", content: trimmed };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    streamingTextRef.current = "";

    // Add a placeholder assistant message for streaming
    const placeholderMsg: Message = { role: "assistant", content: "", streaming: true };
    setMessages((prev) => [...prev, placeholderMsg]);

    const allMessages = [...messages, userMsg];

    await streamChatAPI(
      allMessages,
      // onDelta — append text to the last (streaming) message
      (delta) => {
        streamingTextRef.current += delta;
        const currentText = streamingTextRef.current;
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            content: currentText,
          };
          return updated;
        });
      },
      // onDone — finalize the message with sources
      (sources) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            sources,
            streaming: false,
          };
          return updated;
        });
        setLoading(false);

        if (mode === "avatar") {
          const finalText = streamingTextRef.current;
          setAvatarSpeaking(true);
          setSubtitleText(finalText);
          setTimeout(() => setAvatarSpeaking(false), finalText.length * 40);
        }
      },
      // onError
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
  }, [messages, loading, mode]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  const lastAssistantMsg = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");

  return (
    <div className="chat-page">
      {/* ── Header ── */}
      <div className="chat-header">
        <Link href="/" className="chat-back">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 3L5 8l5 5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          返回
        </Link>

        <div className="chat-mode-tabs">
          <button
            className={`chat-mode-tab${mode === "text" ? " chat-mode-tab--active" : ""}`}
            onClick={() => setMode("text")}
          >
            文字对话
          </button>
          <button
            className={`chat-mode-tab${mode === "avatar" ? " chat-mode-tab--active" : ""}`}
            onClick={() => setMode("avatar")}
          >
            数字人
            <span className="premium-badge">✦</span>
          </button>
        </div>

        <span className="chat-header-brand">Talk with Buffett</span>
      </div>

      {/* ── Body ── */}
      <div className="chat-body">
        {mode === "text" ? (
          <TextMode
            messages={messages}
            onStarter={send}
            onSourceNavigate={persistChatForWorkspace}
            messagesEndRef={messagesEndRef}
          />
        ) : (
          <AvatarMode
            speaking={avatarSpeaking}
            subtitle={subtitleText}
            loading={loading}
            lastMessage={lastAssistantMsg}
            onSourceNavigate={persistChatForWorkspace}
          />
        )}
      </div>

      {/* ── Input ── */}
      <div className="chat-input-wrap">
        <form className="chat-input-bar" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
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
              <path
                d="M3 9h12M10 4l5 5-5 5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
        <p className="chat-disclaimer">
          回答基于 1957–2025 年巴菲特致合伙人/股东信，仅供学习参考。
        </p>
      </div>
    </div>
  );
}

/* ── Text Mode ─────────────────────────────────────── */

function TextMode({
  messages,
  onStarter,
  onSourceNavigate,
  messagesEndRef,
}: {
  messages: Message[];
  onStarter: (t: string) => void;
  onSourceNavigate: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isEmpty = messages.length === 0;

  return (
    <div className="text-mode">
      {isEmpty ? (
        <EmptyState onStarter={onStarter} />
      ) : (
        <div className="messages">
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} onSourceNavigate={onSourceNavigate} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  );
}

function EmptyState({ onStarter }: { onStarter: (t: string) => void }) {
  return (
    <div className="empty-chat">
      <Image
        src="/buffett-avarta.png"
        alt="Warren Buffett"
        className="empty-chat-avatar"
        width={120}
        height={120}
      />
      <h2 className="empty-chat-title">与巴菲特对话</h2>
      <p className="empty-chat-sub">
        基于 1957–2025 年全部合伙人/股东信 · 每个回答标注来源
      </p>
      <div className="starter-grid">
        {STARTERS.map((s) => (
          <button key={s} className="starter-chip" onClick={() => onStarter(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  onSourceNavigate,
}: {
  msg: Message;
  onSourceNavigate: () => void;
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
        <Image src="/buffett-avarta.png" alt="Buffett" className="msg-avatar" width={34} height={34} />
        <div className="msg-body">
          <p className="msg-text">{limitMsg}</p>
          <WaitlistModal
            source="chat_limit"
            title="解锁无限对话"
            desc="留下邮箱或微信，付费版上线时第一时间通知你。"
            trigger={
              <button className="waitlist-btn waitlist-btn--inline">
                我想要更多 →
              </button>
            }
          />
        </div>
      </div>
    );
  }

  // Streaming placeholder with no content yet — show thinking dots
  if (msg.streaming && !msg.content) {
    return (
      <div className="msg msg--assistant">
        <Image src="/buffett-avarta.png" alt="Buffett" className="msg-avatar" width={34} height={34} />
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
      <Image
        src="/buffett-avarta.png"
        alt="Buffett"
        className="msg-avatar"
        width={34}
        height={34}
      />
      <div className="msg-body">
        <div className="msg-text msg-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={messageMarkdownComponents}>
            {msg.content}
          </ReactMarkdown>
        </div>
        {msg.sources && msg.sources.length > 0 && (
          <div className="sources">
            <p className="sources-label">相关原文</p>
            {msg.sources.map((s, i) => (
              <SourceCard key={i} source={s} onNavigate={onSourceNavigate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceCard({
  source,
  onNavigate,
}: {
  source: Source;
  onNavigate: () => void;
}) {
  const typeLabels: Record<string, string> = {
    shareholder: "股东信",
    partnership: "合伙人信",
    annual_meeting: "股东大会",
    article: "文章",
    interview: "采访",
  };
  const typeLabel = typeLabels[source.sourceType] ?? source.sourceType;
  return (
    <div className="source-card">
      <div className="source-header">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M2 2h8v8H2z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M4 5h4M4 7h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span className="source-year">
          {source.year} 年{typeLabel}
          {source.title ? ` · ${source.title}` : ""}
        </span>
        <Link
          href={`/workspace?source=${source.sourceType}&year=${source.year}`}
          className="source-link"
          onClick={onNavigate}
        >
          查看 →
        </Link>
      </div>
      <blockquote className="source-quote">{source.excerptZh || source.excerpt}</blockquote>
    </div>
  );
}

/* ── Avatar Mode ────────────────────────────────────── */

function AvatarMode({
  speaking,
  subtitle,
  loading,
  lastMessage,
  onSourceNavigate,
}: {
  speaking: boolean;
  subtitle: string;
  loading: boolean;
  lastMessage?: Message;
  onSourceNavigate: () => void;
}) {
  return (
    <div className="avatar-mode">
      {/* Video stage */}
      <div className={`avatar-stage${speaking ? " avatar-stage--speaking" : ""}`}>
        <Image
          src="/buffett-avarta.png"
          alt="Warren Buffett"
          className="avatar-stage-img"
          fill
          sizes="(max-width: 600px) 90vw, 420px"
        />
        {/* Speaking ring animation */}
        {speaking && <div className="avatar-ring" />}

        {/* Coming soon overlay when idle */}
        {!speaking && !loading && !subtitle && (
          <div className="avatar-overlay">
            <span className="avatar-overlay-badge">数字人功能开发中</span>
            <p>提问后将由巴菲特虚拟形象回答</p>
          </div>
        )}

        {/* Subtitle bar */}
        {(speaking || loading) && (
          <div className="avatar-subtitle-bar">
            {loading ? (
              <span className="avatar-subtitle-loading">思考中…</span>
            ) : (
              <TypedSubtitle text={subtitle} />
            )}
          </div>
        )}
      </div>

      {/* Source cards below stage */}
      {lastMessage?.sources && lastMessage.sources.length > 0 && (
        <div className="avatar-sources">
          <p className="avatar-sources-label">相关原文</p>
          {lastMessage.sources.map((s, i) => (
            <SourceCard key={i} source={s} onNavigate={onSourceNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

function TypedSubtitle({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState("");

  useEffect(() => {
    setDisplayed("");
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(timer);
    }, 40);
    return () => clearInterval(timer);
  }, [text]);

  return <span>{displayed}</span>;
}
