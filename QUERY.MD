# QUERY MVP Design

本文件仅保留当前可执行的 MVP 方案。
复杂设计（多层扩展、重型排序、非必要字段）全部移除。

## Phase 5: MVP Benchmark (30 Questions)

Use the following 30 questions as the current benchmark set for validation.

### A. Facts Retrieval (10)

1. 你最早在哪一年提到 GEICO？
2. 你最早什么时候明确讨论可口可乐投资？
3. 你在哪些年份重点谈过股票回购（share buyback）？
4. 你在哪一年正式收购了 BNSF？当时你怎么描述这笔交易？
5. 你在哪些年份详细解释过保险浮存金（float）？
6. 你最早哪一年公开承认过 IBM 投资失误？
7. 你在哪一年首次系统阐述“伯克希尔不会分红”的立场？
8. 你在哪些年份集中讨论过继任与管理层接班问题？
9. 你最早在哪一年提到对苹果的持仓逻辑？
10. 在 2008-2009 金融危机阶段，你在信里重点说了哪些具体动作？

### B. Principles / Methods / Evolution (10)

1. 你如何定义“能力圈（circle of competence）”？
2. 你怎么判断一家公司有没有“护城河（moat）”？
3. 你如何在“好公司合理价”和“普通公司便宜价”之间取舍？
4. 你对杠杆（leverage）的态度是什么？哪些情况绝不碰？
5. 你如何评估管理层的诚信、能力与股东导向？
6. 你如何看待市场择时（market timing）？
7. 你在资本配置上如何权衡回购、并购和持有现金？
8. 你对“分散投资 vs 集中投资”的观点是怎样的？
9. 你关于科技公司投资的态度，这些年发生了哪些变化？
10. 你如何把“安全边际”落实到实际买入决策里？

### C. Random Chat (10)

1. 如果我今天只能记住一句你的投资建议，你会选哪句？
2. 你现在还会每天读很多年报吗？怎么安排阅读节奏？
3. 芒格对你影响最大的一条思维习惯是什么？
4. 如果我是投资新手，你会让我先改掉哪三个坏习惯？
5. 你觉得普通人最容易误解你的哪条观点？
6. 面对连续下跌的市场，你会怎么让自己保持冷静？
7. 你会怎么向完全不懂投资的人解释“复利”？
8. 如果我总想追热门题材，你会怎么劝我？
9. 你今天还会建议年轻人长期持有指数基金吗？
10. 除了投资，你觉得一个人长期成功最重要的品质是什么？

## Phase 6: Final MVP Redesign (Priority-Driven)

Priority order for the 30-question benchmark:
- Facts Retrieval > Principles/Methods > Random Chat

### 6.1 MVP Goals

1. Find correct evidence for factual questions first.
2. Keep answers grounded and non-fabricated.
3. Keep implementation simple and stable.

### 6.2 Intent Recognition (Simplified)

Use 3 primary task types:
- `fact`
- `method`
- `chat`

Use 2 auxiliary modes:
- `timeline` (boolean/mode)
- `compare` (boolean/mode)

Minimum planner JSON fields:
- `task_type` (`fact|method|chat`)
- `temporal_mode`, `year_from`, `year_to`
- `entities` (open list)
- `keyword_query`, `semantic_query`
- `confidence`

Deferred in MVP:
- complex `themes`
- complex `evidence_target`

### 6.3 Retrieval Strategy (Reweighted)

1. For `fact`
- keyword-heavy retrieval as primary
- semantic retrieval as fallback/complement

2. For `method`
- balanced keyword + semantic retrieval
- semantic slightly favored

3. For `chat`
- minimal retrieval or no retrieval

4. If `timeline` mode is on
- enforce year constraints
- increase retrieval pool size

### 6.4 Ranking & Fusion (Lightweight)

1. Keep RRF as the main fusion/ranking mechanism.
2. Add only two hard post-filters:
- year range filter
- timeline year dedup + ascending sort
3. For compare mode:
- enforce minimal dual-side coverage only
- no heavy reranker in MVP

### 6.5 Answer Generation (Constrained)

Keep second LLM call for final answer synthesis.

Generation rules by task:
1. `fact`
- answer conclusion first
- then evidence-backed points

2. `method`
- principle first
- then practical method

3. `chat`
- short conversational response

Global constraints:
- no unsupported claims
- if evidence is insufficient, explicitly state insufficiency first
- keep low temperature for stability

### 6.6 MVP Validation & Gate

Weighted benchmark score:
- Facts Retrieval: 60%
- Principles/Methods: 30%
- Random Chat: 10%

Release gate (MVP):
1. Fact performance does not regress vs baseline.
2. Average latency does not worsen by more than 20%.
3. Insufficient-evidence behavior passes manual checks (no fabrication).

## Phase 7: Iteration Method (Benchmark-Driven)

### 7.1 Standard Loop (Must Follow)

1. Set/confirm baseline commit and baseline summary file.
2. Implement exactly one focused optimization (single-variable preferred).
3. Run benchmark with `npm run eval:mvp:benchmark`.
4. Compare results with `npm run eval:mvp:compare -- --base <baseline_or_last_kept_summary> --candidate tests/evals/mvp_benchmark_30_summary.json`.
5. Decision:
keep + commit if metrics materially improve and pass gate.
rollback if no substantial improvement or key metric regresses.
6. Archive summary/results into `tests/evals/history/` for next-round comparison.

### 7.2 Keep/Rollback Rules

Primary rule:
`Facts Retrieval` metrics are first priority.

Keep when all true:
1. `fact.avgHits` non-regression vs comparison base.
2. `avgLatencyMsAll` <= +20% vs comparison base.
3. weighted score has meaningful gain or fact zero-hit improves materially.
4. manual check confirms no fabrication increase.

Rollback when any true:
1. `fact.avgHits` regresses vs last kept round.
2. weighted score regresses with no compensating fact-quality gain.
3. latency worsens with no clear retrieval gain.

### 7.3 Today’s Iteration Log (2026-03-24)

Baseline snapshot:
commit `fe74056`.
summary `tests/evals/history/mvp_benchmark_30_summary_2026-03-24T12-43-59.080Z.json`.

Round A (kept):
commit `eec2cd6`.
change: strict token filter fix + keyword anchor enrichment + compare script.
result vs baseline: weightedAvgHits `6.11 -> 6.85`, fact.avgHits `6.1 -> 7.4`, latency `+2.11%`.

Round B (rejected, rolled back):
change: broader strict token relaxation + extra anchors.
result vs last kept (`6.85` round): weighted/fact regressed.
action: rollback.

Round C (rejected, rolled back):
change: entity synonym rewrite only.
result vs last kept: strong regression (weighted and fact down).
action: rollback.

Round D (kept, current best):
commit `76a69ce`.
single-variable change: in `mention + timeline`, keep semantic retrieval fallback (`semanticLimit >= 8`) instead of forcing `0`.
result vs last kept (`eec2cd6`): weightedAvgHits `6.85 -> 7.54`, fact.avgHits `7.4 -> 8.0`, fact.zeroHitCount `2 -> 0`, latency `+4.45%` (within gate).

Current recommended next target:
fix intent misclassification for investment-method queries currently falling into `chat` (notably `M006`, `M009`).
