import prisma from "@/lib/prisma";
import SectionCard from "@/components/SectionCard";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";

interface LetterPageProps {
  params: Promise<{ year: string }>;
}

export default async function LetterPage({ params }: LetterPageProps) {
  const { year: yearParam } = await params;
  const year = parseInt(yearParam, 10);

  if (isNaN(year)) {
    notFound();
  }

  const letter = await prisma.letter.findUnique({
    where: { year },
    include: {
      sections: {
        orderBy: { order: "asc" },
      },
    },
  });

  if (!letter) {
    notFound();
  }

  const session = await getServerSession(authOptions);
  const isPaid = !!session;

  return (
    <div>
      <nav className="letter-nav">
        <Link href="/" className="back-link">
          ← 返回年份列表
        </Link>
      </nav>

      <header className="letter-header">
        <h1 className="letter-title">{letter.year} 巴菲特致股东信</h1>
        <p className="letter-meta">
          共 {letter.sections.length} 段
        </p>
      </header>

      <div className="reading-list">
        {letter.sections.map((section) => (
          <SectionCard
            key={section.id}
            id={section.id}
            order={section.order}
            contentEn={section.contentEn}
            contentZh={section.contentZh || ""}
            isPaid={isPaid}
          />
        ))}
      </div>

      <footer className="letter-footer">
        <hr />
        <p>© 2026 Learn from Buffett. 仅供学习研究使用。</p>
        <p>数据源: Berkshire Hathaway Inc. 官方网站</p>
      </footer>
    </div>
  );
}
