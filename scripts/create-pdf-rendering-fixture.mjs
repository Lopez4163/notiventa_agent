import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const output = process.argv[2]
if (!output) {
  process.stderr.write('Usage: node scripts/create-pdf-rendering-fixture.mjs <new-output-path>\n')
  process.exit(1)
}

const document = await PDFDocument.create()
const page = document.addPage([288, 432])
const font = await document.embedFont(StandardFonts.HelveticaBold)
const regular = await document.embedFont(StandardFonts.Helvetica)

page.drawRectangle({ x: 0, y: 0, width: 288, height: 432, borderColor: rgb(0, 0, 0), borderWidth: 1 })
page.drawRectangle({ x: 12, y: 12, width: 264, height: 408, borderColor: rgb(0, 0, 0), borderWidth: 0.5 })
page.drawText('NOTIVENTA PDF RENDERING FIXTURE', { x: 25, y: 390, size: 12, font })
page.drawText('4 × 6 in · single page · portrait · no shipment', { x: 25, y: 370, size: 8, font: regular })
page.drawText('TOP LEFT', { x: 18, y: 405, size: 7, font })
page.drawText('TOP RIGHT', { x: 225, y: 405, size: 7, font })
page.drawText('BOTTOM LEFT', { x: 18, y: 20, size: 7, font })
page.drawText('BOTTOM RIGHT', { x: 205, y: 20, size: 7, font })
page.drawRectangle({ x: 36, y: 120, width: 216, height: 180, borderColor: rgb(0, 0, 0), borderWidth: 1 })
page.drawText('CENTER CONTENT', { x: 83, y: 210, size: 18, font })

const destination = resolve(output)
await mkdir(dirname(destination), { recursive: true })
await writeFile(destination, await document.save(), { flag: 'wx', mode: 0o600 })
process.stdout.write(`${destination}\n`)
