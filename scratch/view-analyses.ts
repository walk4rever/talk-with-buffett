import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const analyses = await db.companyAnalysis.findMany({
    include: {
      entity: {
        select: {
          canonicalName: true,
          ticker: true,
          cik: true,
        }
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  console.log(`Total analyzed companies: ${analyses.length}\n`);

  for (const analysis of analyses) {
    const entity = analysis.entity;
    console.log(`=== ${entity.canonicalName} (${entity.ticker ?? "N/A"}) ===`);
    console.log(`Updated At: ${analysis.updatedAt.toISOString()}`);
    console.log(`Model Source: ${analysis.source}`);
    interface Narrative {
      overview?: { content?: string };
      business?: { content?: string };
    }
    interface Moat {
      summary?: { type?: string; strength?: string; durability?: string; allocation?: string; thesis?: string; };
      dimensions?: Array<{ zhLabel?: string; key?: string; score?: number; verdict?: string; }>;
      notes?: Array<{ label?: string; value?: string; }>;
    }

    const narrative = analysis.narrative as unknown as Narrative;
    const moat = analysis.moat as unknown as Moat;
    
    console.log(`\n[Overview]`);
    console.log(narrative?.overview?.content || "No overview");
    
    console.log(`\n[Business]`);
    console.log(narrative?.business?.content || "No business details");
    
    console.log(`\n[Moat Summary]`);
    console.log(`Type: ${moat?.summary?.type || "N/A"}`);
    console.log(`Strength: ${moat?.summary?.strength || "N/A"}`);
    console.log(`Durability: ${moat?.summary?.durability || "N/A"}`);
    console.log(`Allocation: ${moat?.summary?.allocation || "N/A"}`);
    console.log(`Thesis: ${moat?.summary?.thesis || "N/A"}`);
    
    if (moat?.dimensions) {
      console.log(`\n[Moat Dimensions]`);
      for (const d of moat.dimensions) {
        console.log(`- ${d.zhLabel} (${d.key}): Score ${d.score}/10 | ${d.verdict}`);
      }
    }
    
    if (moat?.notes) {
      console.log(`\n[Notes]`);
      for (const n of moat.notes) {
        console.log(`- ${n.label}: ${n.value}`);
      }
    }
    
    console.log("\n" + "=".repeat(50) + "\n");
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
