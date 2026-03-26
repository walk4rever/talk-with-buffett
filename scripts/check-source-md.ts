import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const directUrl = process.env.DIRECT_URL;
const prisma = directUrl ? new PrismaClient({ datasources: { db: { url: directUrl } } }) : new PrismaClient();

async function main() {
  // Check a few sources: compare DB contentMd length vs current file
  const checks = [
    { year: 1984, type: "shareholder", file: "data/shareholder/1984_Letter_to_Berkshire_Shareholders.md" },
    { year: 2024, type: "shareholder", file: "data/shareholder/2024_Letter_to_Berkshire_Shareholders.md" },
    { year: 2019, type: "shareholder", file: "data/shareholder/2019_Letter_to_Berkshire_Shareholders.md" },
  ];

  for (const c of checks) {
    const src = await prisma.source.findFirst({ where: { year: c.year, type: c.type } });
    const fileContent = fs.readFileSync(path.join("/Users/rafael/R129/talk-with-buffett", c.file), "utf-8");
    const dbLen = src?.contentMd?.length ?? 0;
    const fileLen = fileContent.length;
    const match = src?.contentMd === fileContent;
    console.log(`${c.year}: DB=${dbLen} chars, file=${fileLen} chars, match=${match}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
