import { NextResponse } from "next/server";
import { toolGraph } from "@/lib/mcp-tools";

export const maxDuration = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const entity = searchParams.get("entity")?.trim();
  if (!entity) {
    return NextResponse.json({ error: "entity is required" }, { status: 400 });
  }

  const yearFrom = searchParams.get("yearFrom") ? Number(searchParams.get("yearFrom")) : undefined;
  const yearTo = searchParams.get("yearTo") ? Number(searchParams.get("yearTo")) : undefined;
  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;

  const result = await toolGraph({ entity, yearFrom, yearTo, limit: limit ?? 12 });
  return NextResponse.json(result);
}
