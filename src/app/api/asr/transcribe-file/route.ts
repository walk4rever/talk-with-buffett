import { NextResponse } from "next/server";
import { transcribeWavWithVolcengine } from "@/lib/speech/volcengine-asr-client";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const uid = formData.get("uid")?.toString();
    const language = formData.get("language")?.toString() || "zh-CN";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await transcribeWavWithVolcengine({
      audioBuffer: Buffer.from(arrayBuffer),
      uid,
      language,
    });

    return NextResponse.json({
      ok: true,
      filename: file.name,
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
