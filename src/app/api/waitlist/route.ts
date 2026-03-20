import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const contact = body?.contact?.trim();
  const source = body?.source ?? "unknown";

  if (!contact || contact.length < 3) {
    return NextResponse.json({ error: "请输入有效的联系方式" }, { status: 400 });
  }

  await prisma.waitlistEntry.create({ data: { contact, source } });

  return NextResponse.json({ ok: true });
}
