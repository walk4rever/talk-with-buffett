"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const EXAMPLES = [
  "你怎么看 NVIDIA 这类科技公司？",
  "经济危机时你会怎么做？",
  "什么样的护城河最持久？",
];

export function HeroChatInput() {
  const [query, setQuery] = useState("");
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/chat?q=${encodeURIComponent(q)}`);
  }

  function handleExample(text: string) {
    setQuery(text);
  }

  return (
    <div className="hero-input-wrap">
      <form className="hero-form" onSubmit={handleSubmit}>
        <input
          className="hero-input"
          type="text"
          placeholder="问巴菲特任何关于投资的问题…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button className="hero-btn" type="submit" aria-label="开始对话">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M4 10h12M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </form>
      <div className="hero-examples">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            className="hero-example-chip"
            type="button"
            onClick={() => handleExample(ex)}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
