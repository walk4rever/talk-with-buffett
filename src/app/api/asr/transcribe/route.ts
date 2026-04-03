import { NextResponse } from "next/server";
import { transcribeWavWithVolcengine } from "@/lib/speech/volcengine-asr-client";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  audioBase64?: string;
  uid?: string;
  language?: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.audioBase64) {
    return NextResponse.json({ error: "audioBase64 is required" }, { status: 400 });
  }

  try {
    const audioBuffer = Buffer.from(body.audioBase64, "base64");
    const result = await transcribeWavWithVolcengine({
      audioBuffer,
      uid: body.uid,
      language: body.language,
    });

    return NextResponse.json({
      text: result.text,
      logId: result.logId,
      connectId: result.connectId,
      rawResponses: result.rawResponses,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ASR error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
