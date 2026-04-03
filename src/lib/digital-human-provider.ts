import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  DEFAULT_DIGITAL_HUMAN_KEY,
  buildDigitalHumanSubtitle,
  type DigitalHumanJobPayload,
} from "@/lib/digital-human";

export type DigitalHumanProviderName = "mock" | "volcengine";

export interface DigitalHumanProviderJob {
  id: string;
  status: "queued" | "rendering" | "ready" | "failed";
  subtitle: string;
  audioUrl: string | null;
  videoUrl: string | null;
  errorMessage: string | null;
  readyAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const DIGITAL_HUMAN_PROVIDER = (process.env.DIGITAL_HUMAN_PROVIDER ?? "mock") as DigitalHumanProviderName;

function jobToJson(job: {
  id: string;
  status: string;
  subtitle: string;
  audioUrl: string | null;
  videoUrl: string | null;
  errorMessage: string | null;
  readyAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): DigitalHumanProviderJob {
  return {
    id: job.id,
    status: job.status as DigitalHumanProviderJob["status"],
    subtitle: job.subtitle,
    audioUrl: job.audioUrl,
    videoUrl: job.videoUrl,
    errorMessage: job.errorMessage,
    readyAt: job.readyAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export async function ensureDefaultDigitalHumanProfile() {
  return prisma.digitalHumanProfile.upsert({
    where: { key: DEFAULT_DIGITAL_HUMAN_KEY },
    update: {},
    create: {
      key: DEFAULT_DIGITAL_HUMAN_KEY,
      name: "巴菲特中文数字人",
      provider: DIGITAL_HUMAN_PROVIDER,
      status: "active",
      faceImageUrl: "/buffett-avarta.jpg",
      voiceProfile: "zh-cn-default",
    },
  });
}

export async function createDigitalHumanJob(payload: DigitalHumanJobPayload) {
  try {
    const avatar = await ensureDefaultDigitalHumanProfile();
    const readyAt = new Date(Date.now() + 2500);

    const job = await prisma.digitalHumanJob.create({
      data: {
        avatarProfileId: avatar.id,
        chatMessageId: payload.chatMessageId,
        question: payload.question,
        answer: payload.answer,
        status: "rendering",
        provider: avatar.provider,
        subtitle: buildDigitalHumanSubtitle(payload.answer),
        readyAt,
        metadata: (payload.sources ?? []) as unknown as Prisma.InputJsonValue,
      },
    });

    return jobToJson(job);
  } catch (error) {
    const now = new Date();
    console.error("[digital-human] persistence unavailable, fallback to voice-only", error);
    return {
      id: `voice-only-${Date.now()}`,
      status: "ready",
      subtitle: buildDigitalHumanSubtitle(payload.answer),
      audioUrl: null,
      videoUrl: null,
      errorMessage: "voice-only-fallback",
      readyAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }
}

export async function getDigitalHumanJob(id: string) {
  const job = await prisma.digitalHumanJob.findUnique({ where: { id } });
  if (!job) return null;

  if (
    (job.status === "rendering" || job.status === "queued") &&
    job.readyAt &&
    job.readyAt.getTime() <= Date.now()
  ) {
    const readyJob = await prisma.digitalHumanJob.update({
      where: { id },
      data: {
        status: "ready",
        audioUrl: job.audioUrl ?? null,
        videoUrl: job.videoUrl ?? null,
      },
    });
    return jobToJson(readyJob);
  }

  return jobToJson(job);
}
