/*
 * Local Windows VM acceptance harness only. It deliberately has no Agent IPC,
 * backend access, or lifecycle calls, and will print only to Microsoft Print
 * to PDF. It exercises the same PDF.js raster -> local HTML -> Electron print
 * technique as ShippingLabelPreparationService and WindowsPrinterAdapter.
 */
const { mkdir, readFile, writeFile } = require('node:fs/promises')
const { dirname, join, resolve } = require('node:path')
const { app, BrowserWindow } = require('electron')
const { createCanvas } = require('@napi-rs/canvas')

const [pdfArgument, outputArgument] = process.argv.slice(2)
if (!pdfArgument || !outputArgument) {
  process.stderr.write('Usage: npx electron scripts/validate-pdf-rendering-boundary.cjs <fixture.pdf> <new-output-directory>\n')
  process.exit(1)
}

const RASTER_DPI = 300
const WIDTH_PIXELS = 1200
const HEIGHT_PIXELS = 1800
const PDF_PRINTER = 'Microsoft Print to PDF'

async function main() {
  const sourcePdf = resolve(pdfArgument)
  const outputDirectory = resolve(outputArgument)
  await mkdir(outputDirectory, { recursive: false, mode: 0o700 })

  const pngPath = join(outputDirectory, 'shipping-label.png')
  const htmlPath = join(outputDirectory, 'shipping-label.html')
  const bytes = await readFile(sourcePdf)
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const standardFontDataUrl = `${dirname(require.resolve('pdfjs-dist/standard_fonts/FoxitSerif.pfb'))}/`
  const task = getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl,
    disableFontFace: true,
    isEvalSupported: false,
    stopAtErrors: true,
    useSystemFonts: false
  })

  try {
    const document = await task.promise
    if (document.numPages !== 1) throw new Error('Expected exactly one PDF page.')
    const page = await document.getPage(1)
    const viewport = page.getViewport({ scale: RASTER_DPI / 72 })
    if (Math.round(viewport.width) !== WIDTH_PIXELS || Math.round(viewport.height) !== HEIGHT_PIXELS) {
      throw new Error('Expected an exact 4 x 6 inch portrait PDF.')
    }
    const canvas = createCanvas(WIDTH_PIXELS, HEIGHT_PIXELS)
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise
    await writeFile(pngPath, canvas.toBuffer('image/png'), { flag: 'wx', mode: 0o600 })
    await writeFile(htmlPath, printDocumentHtml(), { flag: 'wx', mode: 0o600 })
  } finally {
    bytes.fill(0)
    await task.destroy().catch(() => undefined)
  }

  await app.whenReady()
  const window = new BrowserWindow({
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      javascript: false,
      webSecurity: true,
      backgroundThrottling: false
    }
  })
  try {
    await window.loadFile(htmlPath)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000))
    await new Promise((resolvePrint, rejectPrint) => {
      window.webContents.print({
        silent: true,
        printBackground: true,
        color: true,
        margins: { marginType: 'none' },
        landscape: false,
        scaleFactor: 100,
        pagesPerSheet: 1,
        collate: false,
        copies: 1,
        pageSize: { width: 101600, height: 152400 },
        deviceName: PDF_PRINTER
      }, (success, reason) => success ? resolvePrint() : rejectPrint(new Error(reason)))
    })
    process.stdout.write(`Rendered ${htmlPath} and submitted one virtual-printer page.\n`)
  } finally {
    if (!window.isDestroyed()) window.destroy()
    app.exit()
  }
}

function printDocumentHtml() {
  return '<!doctype html><html><head><meta charset="utf-8"><style>@page { size: 4in 6in; margin: 0; } html, body { width: 4in; height: 6in; margin: 0; padding: 0; overflow: hidden; background: white; } img { display: block; width: 4in; height: 6in; }</style></head><body><img src="shipping-label.png" alt=""></body></html>'
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  app.exit(1)
})
