import prisma from "@/lib/prisma";
import Link from "next/link";
import { HomeModeSelect } from "@/components/HomeModeSelect";
import { WaitlistModal } from "@/components/WaitlistModal";

export default async function Home() {
  const shareholderLetters = await prisma.source.findMany({
    where: { type: "shareholder" },
    orderBy: { year: "desc" },
    select: { id: true, year: true, title: true },
  });

  // Partnership: group by year (multiple letters per year)
  const partnershipLetters = await prisma.source.findMany({
    where: { type: "partnership" },
    orderBy: { year: "desc" },
    select: { id: true, year: true, title: true },
  });

  const partnershipYears = [...new Set(partnershipLetters.map((l) => l.year))];

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

      {/* Shareholder Letters */}
      {shareholderLetters.length > 0 && (
        <section className="archive">
          <p className="archive-label">致股东信 1965–2025</p>
          <div className="archive-grid">
            {shareholderLetters.map((letter) => (
              <Link
                key={letter.id}
                href={`/letters/shareholder/${letter.year}`}
                className="archive-item"
                title={letter.title ?? undefined}
              >
                {letter.year}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Partnership Letters */}
      {partnershipYears.length > 0 && (
        <section className="archive">
          <p className="archive-label">致合伙人信 1957–1970</p>
          <div className="archive-grid">
            {partnershipYears.map((year) => (
              <Link
                key={year}
                href={`/letters/partnership/${year}`}
                className="archive-item"
              >
                {year}
              </Link>
            ))}
          </div>
        </section>
      )}

      <footer className="home-footer">
        <WaitlistModal
          source="homepage"
          title="想要更多？"
          desc="留下邮箱或微信，付费版上线时第一时间通知你。"
          trigger={<span className="home-footer-waitlist">加入候补名单 →</span>}
        />
        <p>© 2026 Talk with Buffett · 仅供学习研究使用</p>
      </footer>
    </div>
  );
}
