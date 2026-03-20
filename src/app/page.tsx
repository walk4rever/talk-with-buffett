import prisma from "@/lib/prisma";
import Link from "next/link";
import { HomeModeSelect } from "@/components/HomeModeSelect";

export default async function Home() {
  const letters = await prisma.letter.findMany({
    orderBy: { year: "desc" },
    include: { _count: { select: { sections: true } } },
  });

  return (
    <div className="home-wrap">
      {/* Hero */}
      <section className="hero">
        <p className="hero-eyebrow">基于网络公开的巴菲特致合伙人 / 股东信 / 股东大会视频等</p>
        <h1 className="hero-title">Talk with Buffett</h1>
        <p className="hero-tagline">
          不只是读信，而是与他坐在同一个房间里对话。
        </p>
        <HomeModeSelect />
      </section>

      {/* Archive */}
      {letters.length > 0 && (
        <section className="archive">
          <p className="archive-label">浏览原文</p>
          <div className="archive-grid">
            {letters.map((letter) => (
              <Link
                key={letter.id}
                href={`/letters/${letter.year}`}
                className="archive-item"
                title={letter.title ?? undefined}
              >
                {letter.year}
              </Link>
            ))}
          </div>
        </section>
      )}

      <footer className="home-footer">
        <p>© 2026 Talk with Buffett · 仅供学习研究使用</p>
      </footer>
    </div>
  );
}
