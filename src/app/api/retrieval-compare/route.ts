import { NextResponse } from "next/server";
import { runRetrievalCompare } from "@/lib/retrieval-compare";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.question !== "string") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const fromYear = Number(body.fromYear ?? 2020);
  const toYear = Number(body.toYear ?? 2025);
  const limit = Math.min(Math.max(Number(body.limit ?? 12), 1), 30);
  const sourceType = typeof body.sourceType === "string" ? body.sourceType : "shareholder";

  try {
    const data = await runRetrievalCompare({
      question: body.question,
      fromYear: Number.isFinite(fromYear) ? fromYear : 2020,
      toYear: Number.isFinite(toYear) ? toYear : 2025,
      limit,
      sourceType,
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("[retrieval-compare] error", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
