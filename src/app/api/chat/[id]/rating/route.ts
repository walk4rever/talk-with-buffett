import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);

  if (body?.rating !== 1 && body?.rating !== -1) {
    return NextResponse.json({ error: "rating must be 1 or -1" }, { status: 400 });
  }

  const record = await prisma.chatMessage.findUnique({ where: { id }, select: { id: true } });
  if (!record) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.chatMessage.update({
    where: { id },
    data: { rating: body.rating },
  });

  return NextResponse.json({ ok: true });
}
