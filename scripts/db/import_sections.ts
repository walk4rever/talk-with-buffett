import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

type ParsedSection = {
  order: number
  type: string
  content_en?: string
  content_zh?: string | null
  tableData?: unknown
  table_data?: unknown
}

// 从命令行参数获取年份，默认 2024
const args = process.argv.slice(2)
const years = args.length > 0 ? args.map(a => parseInt(a, 10)) : [2024]

async function importYear(year: number) {
  const yearDir = path.join(process.cwd(), 'data', 'parsed', year.toString())
  const englishPath = path.join(yearDir, 'sections.json')
  const chinesePath = path.join(yearDir, 'sections_zh.json')

  if (!fs.existsSync(englishPath) && !fs.existsSync(chinesePath)) {
    console.error(`[SKIP] No data found for ${year}`)
    return false
  }

  const englishSections: ParsedSection[] = fs.existsSync(englishPath)
    ? JSON.parse(fs.readFileSync(englishPath, 'utf-8'))
    : []
  const chineseSections: ParsedSection[] = fs.existsSync(chinesePath)
    ? JSON.parse(fs.readFileSync(chinesePath, 'utf-8'))
    : []

  const translatedByOrder = new Map<number, string>()
  for (const section of chineseSections) {
    if (section.content_zh) {
      translatedByOrder.set(section.order, section.content_zh)
    }
  }

  const sections = englishSections.length > 0 ? englishSections : chineseSections
  const translatedCount = sections.filter((section) => {
    const zh = translatedByOrder.get(section.order) ?? section.content_zh
    if (!zh) return false
    if (section.type === 'table') return true
    return zh !== section.content_en
  }).length

  // 确定 URL
  let url = `https://www.berkshirehathaway.com/letters/${year}ltr.pdf`
  if (year <= 1999) {
    url = `https://www.berkshirehathaway.com/letters/${year}.html`
  }

  // 1. Create or Update the Letter entry
  const letter = await prisma.letter.upsert({
    where: { year },
    update: {
      title: `${year} Shareholder Letter`,
      url
    },
    create: {
      year,
      title: `${year} Shareholder Letter`,
      url
    }
  })

  console.log(`Processing letter: ${letter.title}`)

  // 2. Clear existing sections to avoid duplicates
  await prisma.section.deleteMany({
    where: { letterId: letter.id }
  })

  // 3. Import sections
  for (const s of sections) {
    await prisma.section.create({
      data: {
        letterId: letter.id,
        order: s.order,
        contentEn: s.content_en ?? '',
        contentZh: translatedByOrder.get(s.order) ?? s.content_zh ?? null,
        hasTable: s.type === 'table',
        // 支持 tableData (结构化表格) 和 table_data (旧格式)
        tableData: s.tableData || s.table_data ? JSON.stringify(s.tableData || s.table_data) : null,
      }
    })
  }

  console.log(`Imported ${sections.length} sections for ${year}${translatedCount > 0 ? ` (${translatedCount} translated)` : ' (English only)'}`)
  return true
}

async function main() {
  console.log(`Importing years: ${years.join(', ')}\n`)
  
  for (const year of years) {
    await importYear(year)
  }
  
  console.log('\nAll done!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
