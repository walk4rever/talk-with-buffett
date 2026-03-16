import prisma from "@/lib/prisma";
import Link from "next/link";

export default async function Home() {
  const letters = await prisma.letter.findMany({
    orderBy: { year: "desc" },
    include: {
      _count: {
        select: { sections: true },
      },
    },
  });

  return (
    <div>
      <header className="home-header">
        <h1 className="home-title">Learn from Buffett</h1>
        <p className="home-subtitle">
          穿越式阅读巴菲特致股东信 — 回到那个时代，看见他做决策时的市场、持仓和世界。
        </p>
      </header>

      {letters.length === 0 ? (
        <div className="empty-state">
          <p>暂无信件数据</p>
          <p className="empty-hint">请先运行 <code>npx prisma db seed</code> 导入数据</p>
        </div>
      ) : (
        <div className="year-grid">
          {letters.map((letter) => (
            <Link
              key={letter.id}
              href={`/letters/${letter.year}`}
              className="year-card"
            >
              <span className="year-number">{letter.year}</span>
              <span className="year-title">{letter.title}</span>
              <span className="year-meta">{letter._count.sections} 段</span>
            </Link>
          ))}
        </div>
      )}

      <footer className="home-footer">
        <p>© 2026 Learn from Buffett. 仅供学习研究使用。</p>
        <p>数据源: Berkshire Hathaway Inc. 官方网站</p>
      </footer>
    </div>
  );
}
