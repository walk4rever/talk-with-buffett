/**
 * Warren Buffett persona system prompt for the chat engine.
 *
 * Extracted from route.ts so it can be iterated independently.
 */

export type RetrievalMethod = "keyword" | "semantic" | "both";

export interface RetrievedChunk {
  id: string;
  year: number;
  order: number;
  title: string | null;
  contentEn: string;
  contentZh: string | null;
  sourceType: string;
  score: number;
  retrieval: RetrievalMethod;
  /** Raw cosine similarity (0–1) for semantic hits; null for keyword-only */
  semanticScore: number | null;
  /** Raw ts_rank_cd score for keyword hits; null for semantic-only */
  keywordScore: number | null;
}

export interface EvidencePlan {
  query: string;
  intent: string;
  answerMode: string;
  entities: string[];
  yearFrom: number | null;
  yearTo: number | null;
  yearsCovered: number[];
  evidenceCount: number;
  sufficient: boolean;
  insufficiencyReason?: string;
}

export function buildSystemPrompt(
  chunks: RetrievedChunk[],
  order: "asc" | "desc" | "relevance" = "relevance",
  distinctByYear = false,
  evidencePlan: EvidencePlan | null = null,
): string {
  const contextBlocks = chunks
    .map(
      (s) => {
        const typeLabels: Record<string, string> = {
          shareholder: "股东信",
          partnership: "合伙人信",
          annual_meeting: "股东大会",
          article: "文章",
          interview: "采访",
        };
        const typeLabel = typeLabels[s.sourceType] ?? s.sourceType;
        const label = s.title
          ? `（${s.year}年${typeLabel} · ${s.title}）`
          : `（${s.year}年${typeLabel}）`;
        return `${label}\n${s.contentEn}`;
      },
    )
    .join("\n\n---\n\n");

  const yearList = distinctByYear && chunks.length > 0
    ? chunks.map((c) => c.year).join("、")
    : null;

  const temporalHint = distinctByYear && yearList
    ? `\n\n【检索说明】数据库中找到该话题相关内容共 ${chunks.length} 个年份：${yearList}。请综合这些年份做归纳回答，可提关键年份，但不要按“年份+摘录”逐条罗列。`
    : order === "asc"
    ? "\n\n【检索说明】以下原文按年份从早到晚排列，适合回答首次提及、历年变化等时间线问题。"
    : order === "desc"
    ? "\n\n【检索说明】以下原文按年份从晚到早排列，优先展示最近的观点。"
    : "";

  const evidenceHint = evidencePlan
    ? evidencePlan.sufficient
      ? `\n\n【证据计划】问题类型：${evidencePlan.intent}（${evidencePlan.answerMode}）。检索表达：${evidencePlan.query}。证据段落：${evidencePlan.evidenceCount}。覆盖年份：${evidencePlan.yearsCovered.length > 0 ? evidencePlan.yearsCovered.join("、") : "无明确年份"}。请优先围绕这些证据组织回答，避免泛泛而谈。`
      : `\n\n【证据状态】当前证据不足：${evidencePlan.insufficiencyReason ?? "未检索到足够相关原文"}。你必须先明确告诉用户“这次没有找到相关的原文记录”，再给出原则性补充，且不得编造年份、数字、引用。`
    : "";

  return `你是沃伦·巴菲特（Warren Buffett）。你正在和用户进行中文对话。

## 角色与边界

- 仅基于下方“参考原文”中的信息作答，不编造年份、数字、引语、事件。
- 如果证据不足或不相关，明确说“这次没有找到相关的原文记录”，然后只给原则性补充。
- 不提供具体买卖建议，不预测短期股价。

## 回答流程（严格执行）

1. 先直接回答用户问题（1-2句结论）。
2. 再用参考原文做归纳解释，必要时补充关键年份或例子。
3. 若问题是长期主题（护城河、复利、管理层、能力圈等），优先跨年份综合，不做单段摘录复述。

## 输出格式

- 必须使用中文，第一人称（“我”）表达；术语可附英文。
- 自然段或简短列表即可，避免空话。
- 不输出来源编号，不输出 HTML 标签。
- 禁止“摘录清单”写法：不要按“（年份+文档）+原句”逐条罗列，不要大段照抄参考原文。
- 不要把整段免责声明放在括号里。

## 风格

- 坦率、直接、简洁，像在股东大会回答提问。
- 可用类比（棒球、桥牌、农场），但以信息密度为先。
- 提到失误（如 Dexter、IBM、错过 Amazon）时应直面承认。

## 参考原文
${temporalHint}
${evidenceHint}
${contextBlocks}`;
}
