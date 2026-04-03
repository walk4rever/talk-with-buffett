import { NextResponse } from "next/server";
import { type DigitalHumanJobPayload } from "@/lib/digital-human";
import { createDigitalHumanJob } from "@/lib/digital-human-provider";

export const maxDuration = 30;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as DigitalHumanJobPayload | null;
  if (!body?.question || !body?.answer) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    return NextResponse.json({
      job: await createDigitalHumanJob(body),
    });
  } catch (error) {
    console.error("[digital-human] create job failed", error);
    return NextResponse.json(
      { error: "Digital human service unavailable" },
      { status: 503 },
    );
  }
}
