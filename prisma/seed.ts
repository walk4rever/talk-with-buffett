import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

async function importYear(year: number) {
  console.log(`--- Importing data for year: ${year} ---`)

  const yearDir = path.join(process.cwd(), 'data', 'parsed', year.toString())
  const englishPath = path.join(yearDir, 'sections.json')
  const chinesePath = path.join(yearDir, 'sections_zh.json')

  if (!fs.existsSync(englishPath) && !fs.existsSync(chinesePath)) {
    console.warn(`[SKIP] No parsed data found for ${year}`)
    return
  }

  const englishSections = fs.existsSync(englishPath)
    ? JSON.parse(fs.readFileSync(englishPath, 'utf-8'))
    : []
  const chineseSections = fs.existsSync(chinesePath)
    ? JSON.parse(fs.readFileSync(chinesePath, 'utf-8'))
    : []

  const translatedByOrder = new Map<number, string>()
  for (const section of chineseSections) {
    if (section.content_zh) {
      translatedByOrder.set(section.order, section.content_zh)
    }
  }

  const sections = englishSections.length > 0 ? englishSections : chineseSections

  // 1. Create or Update the Letter entry
  const letter = await prisma.letter.upsert({
    where: { year },
    update: {
      title: `${year} Shareholder Letter`,
      url: year <= 1999
        ? `https://www.berkshirehathaway.com/letters/${year}.html`
        : `https://www.berkshirehathaway.com/letters/${year}ltr.pdf`
    },
    create: {
      year,
      title: `${year} Shareholder Letter`,
      url: year <= 1999
        ? `https://www.berkshirehathaway.com/letters/${year}.html`
        : `https://www.berkshirehathaway.com/letters/${year}ltr.pdf`
    }
  })

  console.log(`Processing letter: ${letter.title}`)

  // 2. Clear existing sections to avoid duplicates during import
  // NOTE: This will delete associated highlights/notes if Cascade is on.
  await prisma.section.deleteMany({
    where: { letterId: letter.id }
  })

  // 3. Import sections
  for (const s of sections) {
    await prisma.section.create({
      data: {
        letterId: letter.id,
        order: s.order,
        contentEn: s.content_en,
        contentZh: translatedByOrder.get(s.order) ?? s.content_zh ?? null,
        hasTable: s.type === 'table',
        tableData: s.tableData || s.table_data ? JSON.stringify(s.tableData || s.table_data) : null,
      }
    })
  }

  console.log(`Successfully imported ${sections.length} sections for ${year}.`)
}

async function main() {
  // Add more years as they become available
  const yearsToImport = [2024, 2023, 2022, 2021, 2020]
  
  for (const year of yearsToImport) {
    await importYear(year)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
