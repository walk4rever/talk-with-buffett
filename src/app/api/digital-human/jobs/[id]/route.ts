import { NextResponse } from "next/server";
import { getDigitalHumanJob } from "@/lib/digital-human-provider";

export const maxDuration = 30;

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getDigitalHumanJob(id);

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ job });
}
