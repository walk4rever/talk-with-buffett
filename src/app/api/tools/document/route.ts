import { NextResponse } from "next/server";
import { toolGetDocument } from "@/lib/mcp-tools";

export const maxDuration = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sourceId = searchParams.get("sourceId") ?? undefined;
  const year = searchParams.get("year") ? Number(searchParams.get("year")) : undefined;
  const type = searchParams.get("type") ?? undefined;
  const page = searchParams.get("page") ? Number(searchParams.get("page")) : undefined;

  if (!sourceId && !year && !type) {
    return NextResponse.json(
      { error: "Provide sourceId, or year and/or type" },
      { status: 400 },
    );
  }

  const result = await toolGetDocument({ sourceId, year, type, page: page ?? 1 });
  return NextResponse.json(result);
}
