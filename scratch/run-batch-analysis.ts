import { execSync } from "child_process";

const currentTickers = [
  "ALLY", "CB", "COF", "DVA", "JEF", "KHC", "KR", "LEN", "LLYVK", "LPX", "NUE", "NVR", "NYT", "SIRI", "STZ", "VRSN"
];

const soldOutTickers = [
  "V", "HEI", "DEO", "LILAK", "UNH", "AON", "POOL", "ALLE", "FWONK", "LAMR", "DPZ", "BATRK", "MA", "CHTR", "DHI", "TMUS"
];

const allTickers = [...currentTickers, ...soldOutTickers];

async function main() {
  console.log(`Starting batch analysis for ${allTickers.length} companies...`);
  console.log(`Current holdings (${currentTickers.length}): ${currentTickers.join(", ")}`);
  console.log(`Recently sold-out (${soldOutTickers.length}): ${soldOutTickers.join(", ")}`);
  console.log("=========================================\n");

  for (let i = 0; i < allTickers.length; i++) {
    const ticker = allTickers[i];
    console.log(`[${i + 1}/${allTickers.length}] Running analysis for ticker: ${ticker}`);
    try {
      // Execute the existing analysis script
      const output = execSync(`node --env-file=.env.local ./node_modules/.bin/tsx scripts/run-company-analysis.ts --company ${ticker}`, {
        encoding: "utf-8"
      });
      console.log(output);
    } catch (error: unknown) {
      const err = error as { message?: string; stdout?: string; stderr?: string };
      console.error(`[${ticker}] Analysis failed:`, err.message);
      if (err.stdout) console.error("Stdout:", err.stdout);
      if (err.stderr) console.error("Stderr:", err.stderr);
    }
  }

  console.log("\n=========================================");
  console.log("Batch analysis completed!");
}

main().catch(console.error);
