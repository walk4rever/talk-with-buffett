"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { CanvasState, ValueFrameworkCard } from "@/types/canvas";

const LENS_META: Record<string, { subtitle: string; accent: string; accentBg: string }> = {
  "Right Business": { subtitle: "对的生意 · 好生意", accent: "#b86a20", accentBg: "#fff7ee" },
  "Right People":   { subtitle: "对的人 · 好文化",   accent: "#2b6cb0", accentBg: "#eff6ff" },
  "Right Price":    { subtitle: "对的价格 · 好估值",  accent: "#276749", accentBg: "#f0faf4" },
};

const THINKER_META = [
  { key: "buffett",     name: "Warren Buffett", initial: "W", bg: "#fef3e0", color: "#92400e" },
  { key: "lilu",        name: "李录",           initial: "录", bg: "#dbeafe", color: "#1e40af" },
  { key: "duanYongping",name: "段永平",          initial: "平", bg: "#d1fae5", color: "#065f46" },
] as const;

function FrameworkCard({ card }: { card: ValueFrameworkCard }) {
  const [activeDim, setActiveDim] = useState(0);

  if (card.status !== "done") {
    return (
      <div className="cc-fw-skeleton">
        <div className="cc-skeleton cc-skeleton--line" style={{ marginBottom: 10 }} />
        <div className="cc-skeleton cc-skeleton--line cc-skeleton--short" />
      </div>
    );
  }

  const lens = card.lenses[activeDim];
  const meta = LENS_META[lens.title] ?? { subtitle: "", accent: "#c7a66a", accentBg: "#fffbf0" };
  const views = [lens.buffett, lens.liLu, lens.duanYongping] as const;

  return (
    <div className="cc-fw">
      {/* Dimension tabs */}
      <div className="cc-fw-tabs">
        {card.lenses.map((l, i) => (
          <button
            key={l.title}
            className={`cc-fw-tab${i === activeDim ? " cc-fw-tab--active" : ""}`}
            onClick={() => setActiveDim(i)}
          >
            {l.title.split(" ").slice(1).join(" ")}
          </button>
        ))}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeDim}
          className="cc-fw-body"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16 }}
        >
          {/* Dimension heading */}
          <div className="cc-fw-dim-head" style={{ background: meta.accentBg }}>
            <span className="cc-fw-dim-en" style={{ color: meta.accent }}>{lens.title}</span>
            <span className="cc-fw-dim-sep">·</span>
            <span className="cc-fw-dim-zh">{meta.subtitle}</span>
          </div>

          {/* Consensus callout */}
          <div className="cc-fw-consensus" style={{ borderLeftColor: meta.accent }}>
            <span className="cc-fw-consensus-label">三者共识</span>
            <p className="cc-fw-consensus-text">{lens.consensus}</p>
          </div>

          {/* Thinker views */}
          <div className="cc-fw-thinkers">
            {THINKER_META.map((t, idx) => (
              <div key={t.key} className="cc-fw-thinker">
                <div className="cc-fw-thinker-head">
                  <span className="cc-fw-avatar" style={{ background: t.bg, color: t.color }}>
                    {t.initial}
                  </span>
                  <span className="cc-fw-thinker-name">{t.name}</span>
                </div>
                <p className="cc-fw-thinker-text">{views[idx]}</p>
              </div>
            ))}
          </div>

          {/* Key questions */}
          <div className="cc-fw-questions">
            <p className="cc-fw-questions-label">核心检验</p>
            <ul className="cc-fw-q-list">
              {lens.keyQuestions.map((q, i) => (
                <li key={i} className="cc-fw-q-item">{q}</li>
              ))}
            </ul>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}


export function CompanyCanvas({ state }: { state: CanvasState }) {
  const framework = state.cards.find((c) => c.type === "value_framework") as
    | ValueFrameworkCard
    | undefined;

  return (
    <div className="company-canvas">
      <div className="cc-tab-content">
        {framework ? <FrameworkCard card={framework} /> : null}
      </div>
    </div>
  );
}
