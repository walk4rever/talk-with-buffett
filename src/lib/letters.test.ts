import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "./prisma";

/**
 * Phase 1 测试：年份导航的数据层
 *
 * 验证：
 * - 年份列表查询（降序、含段落数）
 * - 单封信查询（按 year、含 sections）
 * - 不存在的年份返回 null
 * - 空数据库返回空数组
 */

const TEST_YEARS = [8881, 8882, 8883];

describe("Phase 1: Year Navigation Data Layer", () => {
  beforeAll(async () => {
    // 清理测试数据
    for (const year of TEST_YEARS) {
      await prisma.section.deleteMany({ where: { letter: { year } } });
      await prisma.letter.deleteMany({ where: { year } });
    }

    // 创建测试信件
    await prisma.letter.create({
      data: {
        year: 8881,
        title: "8881 Shareholder Letter",
        url: "https://example.com/8881.pdf",
        sections: {
          create: [
            { order: 1, contentEn: "Section one", contentZh: "第一段" },
            { order: 2, contentEn: "Section two", contentZh: "第二段" },
          ],
        },
      },
    });

    await prisma.letter.create({
      data: {
        year: 8882,
        title: "8882 Shareholder Letter",
        url: "https://example.com/8882.pdf",
        sections: {
          create: [
            { order: 1, contentEn: "Only section", contentZh: "唯一段落" },
          ],
        },
      },
    });

    await prisma.letter.create({
      data: {
        year: 8883,
        title: "8883 Shareholder Letter",
        url: "https://example.com/8883.pdf",
        // 无段落
      },
    });
  });

  afterAll(async () => {
    for (const year of TEST_YEARS) {
      await prisma.section.deleteMany({ where: { letter: { year } } });
      await prisma.letter.deleteMany({ where: { year } });
    }
  });

  // --- Task 1.1: 年份列表 ---

  it("should list letters ordered by year descending with section count", async () => {
    const letters = await prisma.letter.findMany({
      where: { year: { in: TEST_YEARS } },
      orderBy: { year: "desc" },
      include: { _count: { select: { sections: true } } },
    });

    expect(letters).toHaveLength(3);
    expect(letters[0].year).toBe(8883);
    expect(letters[1].year).toBe(8882);
    expect(letters[2].year).toBe(8881);

    expect(letters[0]._count.sections).toBe(0);
    expect(letters[1]._count.sections).toBe(1);
    expect(letters[2]._count.sections).toBe(2);
  });

  it("should return empty array when no letters exist for given filter", async () => {
    const letters = await prisma.letter.findMany({
      where: { year: { in: [7777] } },
    });

    expect(letters).toHaveLength(0);
  });

  // --- Task 1.2: 单封信页面 ---

  it("should find letter by year with sections ordered by order", async () => {
    const letter = await prisma.letter.findUnique({
      where: { year: 8881 },
      include: { sections: { orderBy: { order: "asc" } } },
    });

    expect(letter).not.toBeNull();
    expect(letter!.year).toBe(8881);
    expect(letter!.sections).toHaveLength(2);
    expect(letter!.sections[0].order).toBe(1);
    expect(letter!.sections[0].contentEn).toBe("Section one");
    expect(letter!.sections[0].contentZh).toBe("第一段");
    expect(letter!.sections[1].order).toBe(2);
  });

  it("should return null for non-existent year", async () => {
    const letter = await prisma.letter.findUnique({
      where: { year: 1234 },
    });

    expect(letter).toBeNull();
  });

  it("should return letter with empty sections array when letter has no sections", async () => {
    const letter = await prisma.letter.findUnique({
      where: { year: 8883 },
      include: { sections: true },
    });

    expect(letter).not.toBeNull();
    expect(letter!.sections).toHaveLength(0);
  });
});
