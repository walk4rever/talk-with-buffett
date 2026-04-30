import { NextResponse } from "next/server";
import { toolSearch } from "@/lib/mcp-tools";

export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  const yearFrom = searchParams.get("yearFrom") ? Number(searchParams.get("yearFrom")) : undefined;
  const yearTo = searchParams.get("yearTo") ? Number(searchParams.get("yearTo")) : undefined;
  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;

  const result = await toolSearch({ query: q, yearFrom, yearTo, limit: limit ?? 7 });
  return NextResponse.json(result);
}
