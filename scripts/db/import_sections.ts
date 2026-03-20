import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

// 从命令行参数获取年份，默认 2024
const args = process.argv.slice(2)
const years = args.length > 0 ? args.map(a => parseInt(a, 10)) : [2024]

async function importYear(year: number) {
  // 优先使用 sections.json（英文原文），如果没有则用 sections_zh.json
  let inputPath = path.join(process.cwd(), 'data', 'parsed', year.toString(), 'sections.json')
  let useTranslation = false
  
  if (!fs.existsSync(inputPath)) {
    inputPath = path.join(process.cwd(), 'data', 'parsed', year.toString(), 'sections_zh.json')
    if (!fs.existsSync(inputPath)) {
      console.error(`[SKIP] No data found for ${year}`)
      return false
    }
    useTranslation = true
  }

  const sections = JSON.parse(fs.readFileSync(inputPath, 'utf-8'))

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
        contentEn: s.content_en,
        contentZh: useTranslation ? s.content_zh : null,
        hasTable: s.type === 'table',
        // 支持 tableData (结构化表格) 和 table_data (旧格式)
        tableData: s.tableData || s.table_data ? JSON.stringify(s.tableData || s.table_data) : null,
      }
    })
  }

  console.log(`Imported ${sections.length} sections for ${year}${useTranslation ? ' (translated)' : ' (English only)'}`)
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
