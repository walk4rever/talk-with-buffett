"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
  streaming?: boolean;
}

const STARTERS = [
  "护城河这个概念，你怎么理解？",
  "1999年网络泡沫时你是怎么想的？",
  "什么样的生意你永远不会买？",
  "你怎么看现在的 AI 公司？",
];

// ── SSE streaming client ─────────────────────────────────────────────────

function stripCitationTags(text: string): string {
  return text.replace(/<citations>[\s\S]*?<\/citations>/, "").trim();
}

async function streamChatAPI(
  messages: Message[],
  onDelta: (text: string) => void,
  onDone: (citations: Citation[]) => void,
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // Keep the last (possibly incomplete) line in the buffer
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();

      // Empty line = end of SSE message (but we process event+data as they come)
      if (!trimmed) {
        currentEvent = "";
        continue;
      }

      if (trimmed.startsWith("event: ")) {
        currentEvent = trimmed.slice(7);
        continue;
      }

      if (trimmed.startsWith("data: ")) {
        const payload = trimmed.slice(6);

        if (currentEvent === "delta") {
          try {
            const delta: string = JSON.parse(payload);
            onDelta(delta);
          } catch {
            // skip malformed chunk
          }
        } else if (currentEvent === "done") {
          try {
            const data = JSON.parse(payload);
            onDone(data.citations ?? []);
          } catch {
            onDone([]);
          }
        } else if (currentEvent === "error") {
          onError("抱歉，服务暂时不可用，请稍后重试。");
        }
      }
    }
  }

  // If we never got a "done" event (e.g. stream closed unexpectedly),
  // finalize with no citations so the UI doesn't stay in loading state
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
            content: stripCitationTags(currentText),
          };
          return updated;
        });
      },
      // onDone — finalize the message with citations
      (citations) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            content: stripCitationTags(last.content),
            citations,
            streaming: false,
          };
          return updated;
        });
        setLoading(false);

        if (mode === "avatar") {
          const finalText = stripCitationTags(streamingTextRef.current);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Show thinking dots only while loading AND the last message has no content yet
  const lastMsg = messages[messages.length - 1];
  const showThinking = loading && (!lastMsg || lastMsg.role === "user" || lastMsg.content === "");

  return (
    <div className="text-mode">
      {isEmpty ? (
        <EmptyState onStarter={onStarter} />
      ) : (
        <div className="messages">
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}
          {showThinking && <ThinkingBubble />}
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
        <Link href={`/letters/${citation.year}`} className="citation-link">
          查看原文 →
        </Link>
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
