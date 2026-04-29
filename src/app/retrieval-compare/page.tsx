"use client";

import { useState, type FormEvent } from "react";

type CompareResponse = {
  keywords: string[];
  summary: {
    neo4jCount: number;
    pgCount: number;
    overlap: number;
    neoOnly: number;
    pgOnly: number;
  };
  neo4jHits: Array<{
    conceptId: string | null;
    conceptZh: string | null;
    year: number | null;
    paragraphId: string | null;
    quote: string | null;
  }>;
  pgHits: Array<{
    id: string;
    year: number;
    title: string;
    quote: string;
  }>;
};

export default function RetrievalComparePage() {
  const [question, setQuestion] = useState("2020 到 2025 巴菲特怎么看回购？");
  const [fromYear, setFromYear] = useState(2020);
  const [toYear, setToYear] = useState(2025);
  const [limit, setLimit] = useState(12);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<CompareResponse | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/retrieval-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, fromYear, toYear, limit, sourceType: "shareholder" }),
      });

      if (!res.ok) {
        throw new Error("请求失败");
      }

      const json = (await res.json()) as CompareResponse;
      setData(json);
    } catch {
      setError("查询失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Retrieval Compare</h1>
      <p style={{ color: "#666", marginBottom: 16 }}>输入问题，对比 Neo4j 与 PostgreSQL 命中的段落。</p>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          style={{ width: "100%", padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="number" value={fromYear} onChange={(e) => setFromYear(Number(e.target.value))} style={{ padding: 8 }} />
          <input type="number" value={toYear} onChange={(e) => setToYear(Number(e.target.value))} style={{ padding: 8 }} />
          <input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ padding: 8 }} />
          <button type="submit" disabled={loading} style={{ padding: "8px 14px", borderRadius: 8 }}>
            {loading ? "查询中..." : "开始对比"}
          </button>
        </div>
      </form>

      {error && <p style={{ color: "#b00020" }}>{error}</p>}

      {data && (
        <>
          <div style={{ marginBottom: 12, color: "#333" }}>
            <strong>keywords:</strong> {data.keywords.join(", ")}
            <br />
            <strong>summary:</strong> neo4j={data.summary.neo4jCount}, pg={data.summary.pgCount}, overlap={data.summary.overlap}, neoOnly={data.summary.neoOnly}, pgOnly={data.summary.pgOnly}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <section>
              <h2 style={{ fontSize: 18, marginBottom: 8 }}>Neo4j</h2>
              <div style={{ display: "grid", gap: 8 }}>
                {data.neo4jHits.map((hit, i) => (
                  <article key={`${hit.paragraphId ?? "x"}-${i}`} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                      {hit.year ?? "-"} · {hit.conceptZh ?? hit.conceptId ?? "(unknown)"} · {hit.paragraphId ?? "-"}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{hit.quote ?? ""}</div>
                  </article>
                ))}
              </div>
            </section>

            <section>
              <h2 style={{ fontSize: 18, marginBottom: 8 }}>PostgreSQL</h2>
              <div style={{ display: "grid", gap: 8 }}>
                {data.pgHits.map((hit) => (
                  <article key={hit.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                      {hit.year} · {hit.id}
                    </div>
                    <div style={{ fontSize: 13, marginBottom: 6 }}>{hit.title}</div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{hit.quote}</div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
