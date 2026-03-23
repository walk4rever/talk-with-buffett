import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * GET /api/source?type=shareholder&year=2024
 * Returns source content for the workspace Canvas.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const yearStr = searchParams.get("year");

  if (!type || !yearStr) {
    return NextResponse.json({ error: "type and year are required" }, { status: 400 });
  }

  const year = parseInt(yearStr, 10);
  if (isNaN(year)) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 });
  }

  // Partnership: multiple sources per year, concatenate
  if (type === "partnership") {
    const sources = await prisma.source.findMany({
      where: { year, type: "partnership" },
      orderBy: { date: "asc" },
      select: { year: true, title: true, contentMd: true, videoUrl: true, videoSource: true },
    });

    if (sources.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const combinedMd = sources
      .map((s) => s.contentMd ?? "")
      .filter(Boolean)
      .join("\n\n---\n\n");

    return NextResponse.json({
      year,
      type,
      title: sources[0].title,
      contentMd: combinedMd,
      videoUrl: sources[0].videoUrl,
      videoSource: sources[0].videoSource,
    });
  }

  // Other types: one source per year
  const source = await prisma.source.findFirst({
    where: { year, type },
    select: { year: true, title: true, contentMd: true, videoUrl: true, videoSource: true },
  });

  if (!source || !source.contentMd) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    year: source.year,
    type,
    title: source.title,
    contentMd: source.contentMd,
    videoUrl: source.videoUrl,
    videoSource: source.videoSource,
  });
}
