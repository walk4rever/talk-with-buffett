import Link from "next/link";

export const metadata = {
  title: "文字对话模式 — Talk with Buffett",
  description: "进入 Text Room，与巴菲特进行文字对话并查看原文索引。",
};

export default function TextModePage() {
  return (
    <main className="home-wrap">
      <section className="hero">
        <p className="hero-eyebrow">Text Mode</p>
        <h1 className="hero-title">文字对话模式</h1>
        <p className="hero-tagline">先提出问题，再基于原文证据逐步追问。</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Link href="/text/room" className="btn-primary">
            进入 Text Room
          </Link>
          <Link href="/" className="btn-outline">
            返回首页
          </Link>
        </div>
      </section>
    </main>
  );
}
