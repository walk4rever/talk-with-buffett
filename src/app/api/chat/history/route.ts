import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import type { ChatMessage } from "@/lib/chat";

const HISTORY_LIMIT = 10;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const records = await prisma.chatMessage.findMany({
    where: {
      userId: session.user.id,
      answer: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { id: true, question: true, answer: true, rating: true, sourcesJson: true },
  });

  // Reverse to chronological order, then build message pairs
  const messages: ChatMessage[] = records.reverse().flatMap((r) => [
    { role: "user" as const, content: r.question },
    {
      role: "assistant" as const,
      content: r.answer!,
      chatMessageId: r.id,
      rating: r.rating as 1 | -1 | null | undefined,
      sources: Array.isArray(r.sourcesJson) ? (r.sourcesJson as unknown as ChatMessage["sources"]) : undefined,
      question: r.question,
    },
  ]);

  return NextResponse.json({ messages });
}
