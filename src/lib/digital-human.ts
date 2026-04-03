export const DEFAULT_DIGITAL_HUMAN_KEY = "warren-buffett-zh";

export type DigitalHumanJobStatus =
  | "queued"
  | "rendering"
  | "ready"
  | "failed";

export interface DigitalHumanSource {
  year: number;
  title: string | null;
  sourceType: string;
  excerpt: string;
  excerptZh?: string;
}

export interface DigitalHumanJobPayload {
  chatMessageId?: string;
  question: string;
  answer: string;
  sources?: DigitalHumanSource[];
}

export interface DigitalHumanJobSnapshot {
  id: string;
  status: DigitalHumanJobStatus;
  subtitle: string;
  audioUrl?: string | null;
  videoUrl?: string | null;
  errorMessage?: string | null;
  readyAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function buildDigitalHumanSubtitle(answer: string) {
  const cleaned = answer.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > 130 ? `${cleaned.slice(0, 130).trim()}…` : cleaned;
}

export function formatDigitalHumanSourceLabel(sourceType: string) {
  switch (sourceType) {
    case "shareholder":
      return "股东信";
    case "partnership":
      return "合伙人信";
    case "annual_meeting":
      return "股东大会";
    case "article":
      return "文章";
    case "interview":
      return "采访";
    default:
      return sourceType;
  }
}
