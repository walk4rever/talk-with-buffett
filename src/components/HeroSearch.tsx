"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

const EXAMPLE_QUESTIONS = [
  "巴菲特为什么持有BAC这么久？",
  "李录重仓中国的逻辑是什么？",
  "段永平如何定义企业文化？",
  "护城河和定价权的关系？",
];

export function HeroSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  function submit() {
    if (query.trim()) {
      router.push(`/idea?ask=${encodeURIComponent(query.trim())}`);
    } else {
      router.push("/idea");
    }
  }

  function fillExample(text: string) {
    setQuery(text);
    inputRef.current?.focus();
  }

  return (
    <div className="hero-search">
      {/* Search input */}
      <div className="hero-input-wrap">
        <input
          ref={inputRef}
          className="hero-input"
          type="text"
          placeholder="研究一家公司，或向大师提问"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClick={submit}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button className="hero-input-btn" onClick={submit} aria-label="提问">
          <span className="hero-input-enter" aria-hidden="true">↵</span>
        </button>
      </div>

      {/* Example chips */}
      <div className="hero-examples">
        {EXAMPLE_QUESTIONS.map((q) => (
          <button key={q} className="hero-example" onClick={() => fillExample(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
