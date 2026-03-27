/**
 * Shared chat types and SSE streaming client.
 * Used by ChatPage, ChatDrawer, and Workspace.
 */

export interface ChatSource {
  year: number;
  title: string | null;
  sourceType: string;
  excerpt: string;
  excerptZh?: string;
  chunkId?: string;
  retrieval?: "keyword" | "semantic" | "both";
  semanticScore?: number | null;
  keywordScore?: number | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  streaming?: boolean;
  chatMessageId?: string;
  rating?: 1 | -1 | null;
  /** The user question that preceded this assistant message (for share image). */
  question?: string;
}

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  shareholder: "股东信",
  partnership: "合伙人信",
  annual_meeting: "股东大会",
  article: "文章",
  interview: "采访",
};

export function getSourceTypeLabel(type: string): string {
  return SOURCE_TYPE_LABELS[type] ?? type;
}

/**
 * Stream chat response from /api/chat via SSE.
 */
export async function streamChatAPI(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  onDone: (sources: ChatSource[], chatMessageId?: string) => void,
  onError: (msg: string) => void,
) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (res.status === 429) {
    const data = await res.json().catch(() => null);
    onError("__LIMIT__" + (data?.error ?? "今日免费次数已用完，请明天再来。"));
    return;
  }

  if (!res.ok) {
    onError("抱歉，服务暂时不可用，请稍后重试。");
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let gotDone = false;

  function processLines(lines: string[]) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { currentEvent = ""; continue; }
      if (trimmed.startsWith("event: ")) { currentEvent = trimmed.slice(7); continue; }
      if (trimmed.startsWith("data: ")) {
        const payload = trimmed.slice(6);
        if (currentEvent === "delta") {
          try { onDelta(JSON.parse(payload)); } catch { /* skip */ }
        } else if (currentEvent === "sources") {
          // Sources arrive first, before AI streaming starts.
          try {
            const data = JSON.parse(payload);
            onDone(data.sources ?? [], data.chatMessageId);
          } catch {
            onDone([]);
          }
          gotDone = true;
        } else if (currentEvent === "done") {
          // End-of-stream signal — sources already delivered via "sources" event.
          gotDone = true;
        } else if (currentEvent === "error") {
          onError("抱歉，服务暂时不可用，请稍后重试。");
        }
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      processLines(lines);
    }
    if (done) {
      if (buffer.trim()) {
        processLines([buffer]);
      }
      break;
    }
  }

  if (!gotDone) {
    onDone([]);
  }
}
