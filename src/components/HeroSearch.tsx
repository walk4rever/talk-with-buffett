"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { TRIBE_MEMBERS, type TribeMember } from "@/lib/tribe";

const EXAMPLE_QUESTIONS = [
  "巴菲特为什么持有BAC这么久？",
  "李录重仓中国的逻辑是什么？",
  "段永平如何定义企业文化？",
  "护城河和定价权的关系？",
];

export function HeroSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState("buffett");
  const [query, setQuery] = useState("");

  function submit() {
    const q = query.trim();
    if (!q) return;
    const params = new URLSearchParams({ ask: q, person: selectedId });
    router.push(`/text/room?${params.toString()}`);
  }

  function fillExample(text: string) {
    setQuery(text);
    inputRef.current?.focus();
  }

  return (
    <div className="hero-search">
      {/* Person selector */}
      <div className="hero-persons">
        {TRIBE_MEMBERS.map((m) => (
          <PersonChip
            key={m.id}
            member={m}
            selected={selectedId === m.id}
            onClick={() => setSelectedId(m.id)}
          />
        ))}
      </div>

      {/* Search input */}
      <div className="hero-input-wrap">
        <input
          ref={inputRef}
          className="hero-input"
          type="text"
          placeholder="问巴菲特部落任何投资问题..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button className="hero-input-btn" onClick={submit} aria-label="提问">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="4" y1="10" x2="16" y2="10" />
            <polyline points="11,5 16,10 11,15" />
          </svg>
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

function PersonChip({ member, selected, onClick }: {
  member: TribeMember;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`person-chip${selected ? " person-chip--selected" : ""}`}
      style={{ "--person-color": member.color } as React.CSSProperties}
      onClick={onClick}
    >
      <span className="person-chip-avatar" style={{ background: member.color }}>
        <span className="person-chip-initials">{member.initials}</span>
      </span>
      <span className="person-chip-name">{member.nameZh}</span>
    </button>
  );
}
