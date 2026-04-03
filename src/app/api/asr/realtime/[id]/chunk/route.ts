import { NextResponse } from "next/server";
import { sendRealtimeAsrChunk } from "@/lib/speech/volcengine-asr-relay";

export const runtime = "nodejs";

type Body = { audioBase64?: string; isLast?: boolean };

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const relayUrl = process.env.ASR_RELAY_URL;
  if (relayUrl) {
    const body = await req.text();
    const upstream = await fetch(`${relayUrl}/asr/realtime/${id}/chunk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.audioBase64) {
    return NextResponse.json({ error: "audioBase64 is required" }, { status: 400 });
  }

  try {
    sendRealtimeAsrChunk(id, Buffer.from(body.audioBase64, "base64"), Boolean(body.isLast));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "chunk_failed";
    if (/session not found/i.test(message)) {
      return NextResponse.json({ ok: true, ignored: true, reason: "session_closed" });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
