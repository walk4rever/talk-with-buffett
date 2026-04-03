import Link from "next/link";

export const metadata = {
  title: "视频对话模式 — Talk with Buffett",
  description: "进入 Live Room，使用语音输入并获得数字人播报。",
};

export default function LiveModePage() {
  return (
    <main className="home-wrap">
      <section className="hero">
        <p className="hero-eyebrow">Live Mode</p>
        <h1 className="hero-title">视频对话模式</h1>
        <p className="hero-tagline">用语音提问，触发同一条 LLM 对话链路，再进行数字人播报。</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Link href="/live/room" className="btn-primary">
            进入 Live Room
          </Link>
          <Link href="/" className="btn-outline">
            返回首页
          </Link>
        </div>
      </section>
    </main>
  );
}
