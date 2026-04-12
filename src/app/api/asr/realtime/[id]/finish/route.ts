import { NextResponse } from "next/server";
import { finishRealtimeAsrSession } from "@/lib/speech/volcengine-asr-relay";

export const runtime = "nodejs";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const relayUrl = process.env.VOICE_RELAY_URL;
  if (relayUrl) {
    const upstream = await fetch(`${relayUrl}/asr/realtime/${id}/finish`, { method: "POST" });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  }

  finishRealtimeAsrSession(id);
  return NextResponse.json({ ok: true });
}
