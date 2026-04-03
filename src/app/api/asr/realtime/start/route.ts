import { NextResponse } from "next/server";
import { createRealtimeAsrSession } from "@/lib/speech/volcengine-asr-relay";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const relayUrl = process.env.ASR_RELAY_URL;
  if (relayUrl) {
    const body = await req.text();
    const upstream = await fetch(`${relayUrl}/asr/realtime/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  }

  const body = (await req.json().catch(() => null)) as { uid?: string } | null;
  const session = await createRealtimeAsrSession(body?.uid);
  return NextResponse.json(session);
}
