import { NextResponse } from "next/server";
import { Resend } from "resend";
import crypto from "crypto";
import prisma from "@/lib/prisma";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM ?? "onboarding@resend.dev";
const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const TOKEN_TTL_HOURS = 2;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = body?.email?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "请输入邮箱" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Always return success to avoid leaking whether email is registered
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await prisma.verificationToken.upsert({
    where: { identifier_token: { identifier: email, token } },
    update: { expires },
    create: { identifier: email, token, expires },
  });

  const resetUrl = `${BASE_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: "重置你的 Talk with Buffett 密码",
    html: `
      <p>你好，</p>
      <p>我们收到了你的密码重置请求。点击下方链接设置新密码（链接 ${TOKEN_TTL_HOURS} 小时内有效）：</p>
      <p><a href="${resetUrl}" style="color:#1a6b3c;font-weight:bold;">重置密码</a></p>
      <p>如果你没有发起此请求，请忽略这封邮件。</p>
      <p>— Talk with Buffett</p>
    `,
  });

  return NextResponse.json({ ok: true });
}
