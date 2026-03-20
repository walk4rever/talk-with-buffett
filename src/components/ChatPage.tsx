"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { WaitlistModal } from "@/components/WaitlistModal";

type Mode = "text" | "avatar";

interface Citation {
  year: number;
  excerpt: string;
  sectionId?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

const STARTERS = [
  "护城河这个概念，你怎么理解？",
  "1999年网络泡沫时你是怎么想的？",
  "什么样的生意你永远不会买？",
  "你怎么看现在的 AI 公司？",
];

async function callChatAPI(messages: Message[]): Promise<Message> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (res.status === 429) {
    return { role: "assistant", content: "__LIMIT_REACHED__" };
  }

  if (!res.ok) {
    return { role: "assistant", content: "抱歉，服务暂时不可用，请稍后重试。" };
  }

  const data = await res.json();
  return {
    role: "assistant",
    content: data.reply,
    citations: data.citations ?? [],
  };
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

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    const allMessages = [...messages, userMsg];
    const reply = await callChatAPI(allMessages);

    setLoading(false);
    setMessages((prev) => [...prev, reply]);

    if (mode === "avatar") {
      setAvatarSpeaking(true);
      setSubtitleText(reply.content);
      await new Promise((r) => setTimeout(r, reply.content.length * 40));
      setAvatarSpeaking(false);
    }
  }

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
            loading={loading}
            onStarter={send}
            messagesEndRef={messagesEndRef}
          />
        ) : (
          <AvatarMode
            speaking={avatarSpeaking}
            subtitle={subtitleText}
            loading={loading}
            lastMessage={lastAssistantMsg}
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
          回答基于 1965–2024 年巴菲特股东信，仅供学习参考。
        </p>
      </div>
    </div>
  );
}

/* ── Text Mode ─────────────────────────────────────── */

function TextMode({
  messages,
  loading,
  onStarter,
  messagesEndRef,
}: {
  messages: Message[];
  loading: boolean;
  onStarter: (t: string) => void;
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
            <MessageBubble key={i} msg={msg} />
          ))}
          {loading && <ThinkingBubble />}
          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  );
}

function EmptyState({ onStarter }: { onStarter: (t: string) => void }) {
  return (
    <div className="empty-chat">
      <img
        src="/buffett-avarta.png"
        alt="Warren Buffett"
        className="empty-chat-avatar"
      />
      <h2 className="empty-chat-title">与巴菲特对话</h2>
      <p className="empty-chat-sub">
        基于 1965–2024 年全部股东信 · 每个回答标注来源
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

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return (
      <div className="msg msg--user">
        <p className="msg-text">{msg.content}</p>
      </div>
    );
  }

  if (msg.content === "__LIMIT_REACHED__") {
    return (
      <div className="msg msg--assistant">
        <img src="/buffett-avarta.png" alt="Buffett" className="msg-avatar" />
        <div className="msg-body">
          <p className="msg-text">今天的 5 次免费对话已用完。</p>
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

  return (
    <div className="msg msg--assistant">
      <img
        src="/buffett-avarta.png"
        alt="Buffett"
        className="msg-avatar"
      />
      <div className="msg-body">
        <p className="msg-text">{msg.content}</p>
        {msg.citations && msg.citations.length > 0 && (
          <div className="citations">
            {msg.citations.map((c, i) => (
              <CitationCard key={i} citation={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CitationCard({ citation }: { citation: Citation }) {
  return (
    <div className="citation-card">
      <div className="citation-header">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M2 2h8v8H2z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M4 5h4M4 7h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span className="citation-year">{citation.year} 年股东信</span>
        {citation.sectionId && (
          <Link
            href={`/letters/${citation.year}`}
            className="citation-link"
          >
            查看原文 →
          </Link>
        )}
        {!citation.sectionId && (
          <Link href={`/letters/${citation.year}`} className="citation-link">
            查看原文 →
          </Link>
        )}
      </div>
      <blockquote className="citation-quote">"{citation.excerpt}"</blockquote>
    </div>
  );
}

function ThinkingBubble() {
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

/* ── Avatar Mode ────────────────────────────────────── */

function AvatarMode({
  speaking,
  subtitle,
  loading,
  lastMessage,
}: {
  speaking: boolean;
  subtitle: string;
  loading: boolean;
  lastMessage?: Message;
}) {
  return (
    <div className="avatar-mode">
      {/* Video stage */}
      <div className={`avatar-stage${speaking ? " avatar-stage--speaking" : ""}`}>
        <img
          src="/buffett-avarta.png"
          alt="Warren Buffett"
          className="avatar-stage-img"
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

      {/* Citation cards below stage */}
      {lastMessage?.citations && lastMessage.citations.length > 0 && (
        <div className="avatar-citations">
          <p className="avatar-citations-label">引用来源</p>
          {lastMessage.citations.map((c, i) => (
            <CitationCard key={i} citation={c} />
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
