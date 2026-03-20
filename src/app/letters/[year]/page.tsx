import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
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
    include: { sections: { orderBy: { order: "asc" } } },
  });

  if (!letter) notFound();

  const session = await getServerSession(authOptions);
  const isPaid = !!session;

  return (
    <div className="letter-page">
      <LetterReadingArea
        year={letter.year}
        sections={letter.sections}
        isPaid={isPaid}
      />

      <footer className="letter-footer">
        <hr />
        <p>© 2026 Talk with Buffett · 仅供学习研究使用</p>
      </footer>
    </div>
  );
}
