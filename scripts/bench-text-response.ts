/**
 * Text mode response latency benchmark.
 * 
 * Measures the full text chat flow:
 * - total_response_time: from POST to /api/chat to first delta token received
 * - search_time: time spent in understandQuery + retrieval (sources event)
 * - ai_first_token: time from sources event to first delta token
 * 
 * Run with: npx tsx scripts/bench-text-response.ts
 */

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";
const TEST_QUERY = "护城河这个概念，你怎么理解的？";

interface BenchmarkResult {
  totalMs: number;
  searchMs: number;
  aiFirstTokenMs: number;
  tokensReceived: number;
  error?: string;
}

async function runBenchmark(): Promise<BenchmarkResult> {
  const startTime = Date.now();
  
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: TEST_QUERY }],
      mode: "text"
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    return {
      totalMs: Date.now() - startTime,
      searchMs: 0,
      aiFirstTokenMs: 0,
      tokensReceived: 0,
      error: `HTTP ${res.status}: ${errorText.slice(0, 200)}`
    };
  }

  if (!res.body) {
    return {
      totalMs: Date.now() - startTime,
      searchMs: 0,
      aiFirstTokenMs: 0,
      tokensReceived: 0,
      error: "No response body"
    };
  }
  
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let searchMs = 0;
  let aiFirstTokenMs = 0;
  let tokensReceived = 0;
  let sourcesTime = 0;
  let firstDeltaTime = 0;
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith("event:")) {
        currentEvent = trimmed.slice(6).trim();
        continue;
      }
      
      if (trimmed.startsWith("data:")) {
        const payload = trimmed.slice(5).trim();
        
        if (currentEvent === "sources") {
          // Sources arrive after search completes, before AI streaming starts
          sourcesTime = Date.now() - startTime;
          searchMs = sourcesTime;
        } else if (currentEvent === "delta") {
          if (!firstDeltaTime) {
            firstDeltaTime = Date.now();
            aiFirstTokenMs = firstDeltaTime - startTime;
          }
          try {
            const delta = JSON.parse(payload);
            if (typeof delta === "string" && delta.length > 0) {
              tokensReceived++;
            }
          } catch {}
        } else if (currentEvent === "done" || currentEvent === "error") {
          break;
        }
      }
      
      if (!trimmed) {
        currentEvent = "";
      }
    }
  }

  return {
    totalMs: Date.now() - startTime,
    searchMs,
    aiFirstTokenMs,
    tokensReceived
  };
}

async function main() {
  console.log("Text mode response latency benchmark");
  console.log("=====================================");
  console.log(`API: ${API_BASE}`);
  console.log(`Test query: ${TEST_QUERY}`);
  console.log("");
  
  const runs: BenchmarkResult[] = [];
  const numRuns = 3;
  
  for (let i = 0; i < numRuns; i++) {
    console.log(`Run ${i + 1}/${numRuns}...`);
    const result = await runBenchmark();
    runs.push(result);
    
    if (result.error) {
      console.log(`  ERROR: ${result.error}`);
      if (result.error.includes("429") || result.error.includes("次数已用完")) {
        console.log("  Rate limited, stopping runs");
        break;
      }
    } else {
      console.log(`  total: ${result.totalMs}ms | search: ${result.searchMs}ms | ai_first_token: ${result.aiFirstTokenMs}ms | tokens: ${result.tokensReceived}`);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  const validRuns = runs.filter(r => !r.error && r.totalMs > 0);
  if (validRuns.length === 0) {
    console.log("\nNo valid runs completed");
    process.exit(1);
  }
  
  validRuns.sort((a, b) => a.totalMs - b.totalMs);
  const median = validRuns[Math.floor(validRuns.length / 2)];
  
  console.log("\n=====================================");
  console.log("Results (ms):");
  console.log(`  Total median: ${median.totalMs}`);
  console.log(`  Search median: ${median.searchMs}`);
  console.log(`  AI first token median: ${median.aiFirstTokenMs}`);
  console.log(`  Tokens received median: ${median.tokensReceived}`);
  
  console.log(`\nMETRIC total_ms=${median.totalMs}`);
  console.log(`METRIC search_ms=${median.searchMs}`);
  console.log(`METRIC ai_first_token_ms=${median.aiFirstTokenMs}`);
}

main().catch(console.error);