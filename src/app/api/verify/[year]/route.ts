import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  const { year: yearParam } = await params;
  const year = parseInt(yearParam, 10);

  if (isNaN(year) || year < 1900 || year > 2100) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }

  try {
    // 读取源 HTML 文件
    const htmlPath = path.join(process.cwd(), "data/letters", `${year}.html`);
    let html = "";
    if (fs.existsSync(htmlPath)) {
      html = fs.readFileSync(htmlPath, "utf-8");
    }

    // 读取 parsed sections.json
    const sectionsPath = path.join(
      process.cwd(),
      "data/parsed",
      String(year),
      "sections.json"
    );
    let sections: any[] = [];
    if (fs.existsSync(sectionsPath)) {
      const sectionsData = fs.readFileSync(sectionsPath, "utf-8");
      sections = JSON.parse(sectionsData);
    }

    return NextResponse.json({
      year,
      html,
      sections,
    });
  } catch (error) {
    console.error("Error loading verification data:", error);
    return NextResponse.json(
      { error: "Failed to load data" },
      { status: 500 }
    );
  }
}