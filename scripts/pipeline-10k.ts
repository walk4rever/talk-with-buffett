import { spawn } from "node:child_process";

type CmdResult = { code: number; stdout: string; stderr: string };

function run(cmd: string, args: string[]): Promise<CmdResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["inherit", "pipe", "pipe"], env: process.env, cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(s);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function parseJsonTail(text: string): Record<string, unknown> | null {
  const start = text.lastIndexOf("{");
  if (start < 0) return null;
  const maybe = text.slice(start);
  try {
    return JSON.parse(maybe) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const importArgs = args.filter((a) => a !== "--strict");

  console.log("\\n[1/2] Import 10-K data");
  const importRes = await run(process.execPath, ["--env-file=.env.local", "./node_modules/.bin/tsx", "scripts/import-10k-from-13f.ts", ...importArgs]);
  if (importRes.code !== 0) process.exit(importRes.code);

  console.log("\\n[2/2] Check financial integrity");
  const checkRes = await run(process.execPath, ["--env-file=.env.local", "./node_modules/.bin/tsx", "scripts/check-financial-integrity.ts"]);
  if (checkRes.code !== 0) process.exit(checkRes.code);

  const report = parseJsonTail(checkRes.stdout);
  if (report) {
    const missing = Number(report.companiesMissingFY ?? 0);
    if (strict && missing > 0) {
      console.error(`strict mode failed: companiesMissingFY=${missing}`);
      process.exit(1);
    }
  }

  console.log("\\n10-K pipeline done.");
}

main().catch((err) => {
  console.error("[pipeline-10k] fatal", err);
  process.exit(1);
});
