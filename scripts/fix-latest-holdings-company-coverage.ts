import { execFileSync } from "node:child_process";
import path from "node:path";

type CoverageItem = {
  companyName: string;
  ticker: string | null;
  financeStatus: "ok" | "missing" | "short-history-assumed" | "no-company-link";
  analysisStatus: "ok" | "missing" | "short-history-assumed" | "no-company-link";
  missingFinancialYears: number[];
  import10kCommand: string | null;
  analysisCommand: string | null;
};

type CoverageReport = {
  summary: {
    fiscalWindow: {
      startYear: number;
      endYear: number;
      years: number[];
    };
    investors: Array<{
      investor: string;
      latestQuarter: string | null;
      totalCompanies: number;
      financeMissing: number;
      analysisMissing: number;
      shortHistoryAssumed: number;
    }>;
  };
  results: Array<{
    investor: string;
    latestQuarter: string | null;
    companies: CoverageItem[];
  }>;
};

const dryRun = process.argv.includes("--dry-run");
const skipFinance = process.argv.includes("--skip-finance");
const skipAnalysis = process.argv.includes("--skip-analysis");

function runTsxScript(scriptPath: string, args: string[]) {
  const tsxBin = path.resolve(process.cwd(), "node_modules/.bin/tsx");
  return execFileSync(process.execPath, [tsxBin, scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseCoverageReport() {
  const output = runTsxScript("scripts/check-latest-holdings-company-coverage.ts", ["--json"]);
  return JSON.parse(output) as CoverageReport;
}

function uniqueByTicker(items: CoverageItem[]) {
  const seen = new Set<string>();
  const result: CoverageItem[] = [];
  for (const item of items) {
    const key = item.ticker ?? item.companyName;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function runCommand(label: string, command: string) {
  console.log(`\n[${label}] ${command}`);
  if (dryRun) return;
  execFileSync("zsh", ["-lc", command], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
}

async function main() {
  const report = parseCoverageReport();
  const allCompanies = report.results.flatMap((r) => r.companies);

  const financeTargets = uniqueByTicker(
    allCompanies.filter((item) => item.financeStatus === "missing" && item.import10kCommand),
  );
  const analysisTargets = uniqueByTicker(
    allCompanies.filter((item) => item.analysisStatus === "missing" && item.analysisCommand),
  );

  console.log("Coverage remediation plan");
  console.log(`- finance targets: ${financeTargets.length}`);
  console.log(`- analysis targets: ${analysisTargets.length}`);

  if (!skipFinance) {
    for (const item of financeTargets) {
      runCommand(item.ticker ?? item.companyName, item.import10kCommand!);
    }
  }

  if (!skipAnalysis) {
    for (const item of analysisTargets) {
      runCommand(item.ticker ?? item.companyName, item.analysisCommand!);
    }
  }

  console.log("\nRe-running coverage check...");
  const after = parseCoverageReport();
  const remainingFinance = after.results.flatMap((r) => r.companies).filter((item) => item.financeStatus === "missing");
  const remainingAnalysis = after.results.flatMap((r) => r.companies).filter((item) => item.analysisStatus === "missing");

  console.log(
    JSON.stringify(
      {
        remainingFinance: uniqueByTicker(remainingFinance).map((x) => x.ticker ?? x.companyName),
        remainingAnalysis: uniqueByTicker(remainingAnalysis).map((x) => x.ticker ?? x.companyName),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[fix-latest-holdings-company-coverage] fatal", err);
  process.exit(1);
});
