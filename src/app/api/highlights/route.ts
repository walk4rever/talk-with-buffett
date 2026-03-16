import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { sectionId, text, color } = await req.json();

  if (!sectionId || !text) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  try {
    const highlight = await prisma.highlight.create({
      data: {
        userId: (session.user as any).id,
        sectionId,
        text,
        color: color || "yellow",
      },
    });

    return NextResponse.json(highlight);
  } catch (error) {
    console.error("Failed to create highlight:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");

  if (!sectionId) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  try {
    const highlights = await prisma.highlight.findMany({
      where: {
        userId: (session.user as any).id,
        sectionId,
      },
    });

    return NextResponse.json(highlights);
  } catch (error) {
    console.error("Failed to fetch highlights:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
