import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import { LetterReadingArea } from "@/components/LetterReadingArea";

interface LetterPageProps {
  params: Promise<{ year: string }>;
}

export default async function LetterPage({ params }: LetterPageProps) {
  const { year: yearParam } = await params;
  const year = parseInt(yearParam, 10);

  if (isNaN(year)) notFound();

  const letter = await prisma.letter.findUnique({
    where: { year },
    select: { year: true, contentMd: true },
  });

  if (!letter || !letter.contentMd) notFound();

  return (
    <div className="letter-page">
      <LetterReadingArea
        year={letter.year}
        contentMd={letter.contentMd}
      />

      <footer className="letter-footer">
        <hr />
        <p>© 2026 Talk with Buffett · 仅供学习研究使用</p>
      </footer>
    </div>
  );
}
