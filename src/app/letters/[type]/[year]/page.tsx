import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import { LetterReadingArea } from "@/components/LetterReadingArea";

export const dynamic = "force-dynamic";

interface LetterPageProps {
  params: Promise<{ type: string; year: string }>;
}

export default async function LetterPage({ params }: LetterPageProps) {
  const { type, year: yearParam } = await params;
  const year = parseInt(yearParam, 10);

  const validTypes = ["shareholder", "partnership", "annual_meeting"];
  if (isNaN(year) || !validTypes.includes(type)) {
    notFound();
  }

  if (type === "partnership") {
    // Partnership: multiple letters per year, concatenate in date order
    const letters = await prisma.source.findMany({
      where: { year, type: "partnership" },
      orderBy: { date: "asc" },
      select: { year: true, date: true, title: true, contentMd: true },
    });

    if (letters.length === 0) notFound();

    const combinedMd = letters
      .map((l) => l.contentMd ?? "")
      .filter(Boolean)
      .join("\n\n---\n\n");

    return (
      <div className="letter-page">
        <LetterReadingArea
          year={year}
          contentMd={combinedMd}
          sourceType="partnership"
        />
        <footer className="letter-footer">
          <hr />
          <p>© 2026 Talk with Buffett · 仅供学习研究使用</p>
        </footer>
      </div>
    );
  }

  // Shareholder / annual_meeting: one source per year
  const source = await prisma.source.findFirst({
    where: { year, type },
    select: { year: true, contentMd: true },
  });

  if (!source || !source.contentMd) notFound();

  return (
    <div className="letter-page">
      <LetterReadingArea
        year={source.year}
        contentMd={source.contentMd}
        sourceType={type}
      />
      <footer className="letter-footer">
        <hr />
        <p>© 2026 Talk with Buffett · 仅供学习研究使用</p>
      </footer>
    </div>
  );
}
