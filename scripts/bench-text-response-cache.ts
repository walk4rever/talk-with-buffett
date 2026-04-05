/**
 * Text mode response latency benchmark - demonstrates cache effect.
 * 
 * Run with: npx tsx scripts/bench-text-response-cache.ts
 */

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";

interface BenchmarkResult {
  totalMs: number;
  searchMs: number;
  aiFirstTokenMs: number;
  tokensReceived: number;
  error?: string;
}

async function runBenchmark(query: string): Promise<BenchmarkResult> {
  const startTime = Date.now();
  
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: query }],
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
  console.log("Text mode response latency - Cache effect demo");
  console.log("================================================\n");
  
  // Different queries to test cache
  const queries = [
    "护城河这个概念，你怎么理解的？",
    "你怎么看现在的AI公司？",
    "什么样的生意你永远不会买？",
  ];
  
  // First pass - cold cache
  console.log("=== PASS 1: Cold cache (first time each query) ===\n");
  const coldResults: BenchmarkResult[] = [];
  
  for (const query of queries) {
    console.log(`Query: "${query.slice(0, 20)}..."`);
    const result = await runBenchmark(query);
    coldResults.push(result);
    if (result.error) {
      console.log(`  ERROR: ${result.error}`);
    } else {
      console.log(`  total: ${result.totalMs}ms | search: ${result.searchMs}ms | ai_first_token: ${result.aiFirstTokenMs}ms`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  
  console.log("\n=== PASS 2: Warm cache (same queries repeated) ===\n");
  const warmResults: BenchmarkResult[] = [];
  
  for (const query of queries) {
    console.log(`Query: "${query.slice(0, 20)}..."`);
    const result = await runBenchmark(query);
    warmResults.push(result);
    if (result.error) {
      console.log(`  ERROR: ${result.error}`);
    } else {
      console.log(`  total: ${result.totalMs}ms | search: ${result.searchMs}ms | ai_first_token: ${result.aiFirstTokenMs}ms`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  
  // Calculate improvements
  console.log("\n================================================");
  console.log("Summary (median across queries):");
  
  const validCold = coldResults.filter(r => !r.error);
  const validWarm = warmResults.filter(r => !r.error);
  
  if (validCold.length > 0 && validWarm.length > 0) {
    validCold.sort((a, b) => a.totalMs - b.totalMs);
    validWarm.sort((a, b) => a.totalMs - b.totalMs);
    
    const coldMedian = validCold[Math.floor(validCold.length / 2)];
    const warmMedian = validWarm[Math.floor(validWarm.length / 2)];
    
    const improvement = ((coldMedian.totalMs - warmMedian.totalMs) / coldMedian.totalMs * 100).toFixed(1);
    
    console.log(`  Cold cache median: ${coldMedian.totalMs}ms`);
    console.log(`  Warm cache median: ${warmMedian.totalMs}ms`);
    console.log(`  Improvement: ${improvement}%`);
    
    console.log(`\nMETRIC total_ms=${warmMedian.totalMs}`);
    console.log(`METRIC search_ms=${warmMedian.searchMs}`);
    console.log(`METRIC ai_first_token_ms=${warmMedian.aiFirstTokenMs}`);
    console.log(`METRIC improvement_percent=${improvement}`);
  }
}

main().catch(console.error);