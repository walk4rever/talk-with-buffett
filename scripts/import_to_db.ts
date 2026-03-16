import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

async function main() {
  const year = 2024
  const inputPath = path.join(process.cwd(), 'data', 'parsed', year.toString(), 'sections_zh.json')
  
  if (!fs.existsSync(inputPath)) {
    console.error(`No translated data found for ${year}`)
    return
  }

  const sections = JSON.parse(fs.readFileSync(inputPath, 'utf-8'))

  // 1. Create or Update the Letter entry
  const letter = await prisma.letter.upsert({
    where: { year },
    update: {
      title: `${year} Shareholder Letter`,
      url: `https://www.berkshirehathaway.com/letters/${year}ltr.pdf`
    },
    create: {
      year,
      title: `${year} Shareholder Letter`,
      url: `https://www.berkshirehathaway.com/letters/${year}ltr.pdf`
    }
  })

  console.log(`Processing letter: ${letter.title}`)

  // 2. Clear existing sections to avoid duplicates during import
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
        contentZh: s.content_zh,
        hasTable: s.type === 'table',
        tableData: s.table_data ? JSON.stringify(s.table_data) : null,
      }
    })
  }

  console.log(`Successfully imported ${sections.length} sections for ${year}.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
