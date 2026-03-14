import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from './prisma'

describe('Prisma Schema - Letters and Sections', () => {
  const testYear = 9999

  beforeAll(async () => {
    // Clean up any existing test data
    await prisma.section.deleteMany({
      where: { letter: { year: testYear } }
    })
    await prisma.letter.deleteMany({
      where: { year: testYear }
    })
  })

  afterAll(async () => {
    // Clean up test data
    await prisma.section.deleteMany({
      where: { letter: { year: testYear } }
    })
    await prisma.letter.deleteMany({
      where: { year: testYear }
    })
  })

  it('should create and retrieve a letter with sections', async () => {
    const letter = await prisma.letter.create({
      data: {
        year: testYear,
        title: 'Test Letter 9999',
        url: 'https://berkshirehathaway.com/letters/9999.pdf',
        sections: {
          create: [
            {
              order: 1,
              contentEn: 'This is a test paragraph in English.',
              contentZh: '这是中文测试段落。',
            },
            {
              order: 2,
              contentEn: 'Another test paragraph.',
              contentZh: '另一个测试段落。',
            }
          ]
        }
      },
      include: {
        sections: true
      }
    })

    expect(letter).toBeDefined()
    expect(letter.year).toBe(testYear)
    expect(letter.sections).toHaveLength(2)
    expect(letter.sections[0].contentEn).toBe('This is a test paragraph in English.')
    expect(letter.sections[1].contentZh).toBe('另一个测试段落。')
  })

  it('should enforce unique year constraint on letters', async () => {
    // Letter with testYear already exists from previous test
    await expect(prisma.letter.create({
      data: {
        year: testYear,
        title: 'Duplicate Year Letter',
        url: 'https://berkshirehathaway.com/letters/duplicate.pdf',
      }
    })).rejects.toThrow()
  })

  it('should enforce unique order constraint on sections within a letter', async () => {
    const letter = await prisma.letter.findUnique({
      where: { year: testYear }
    })

    if (!letter) throw new Error('Test letter not found')

    await expect(prisma.section.create({
      data: {
        letterId: letter.id,
        order: 1, // Order 1 already exists
        contentEn: 'Conflicting order.',
      }
    })).rejects.toThrow()
  })
})
