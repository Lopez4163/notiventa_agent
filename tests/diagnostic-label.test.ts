import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createDiagnosticLabelPrintRequest,
  PACKAGED_DIAGNOSTIC_LABEL_RELATIVE_PATH,
  resolveDiagnosticLabelPath
} from '../src/main/printers/diagnostic-label'

const sourcePath = resolve('resources/diagnostic-label.html')
const document = readFileSync(sourcePath, 'utf8')
const stagingBuilderConfig = readFileSync(resolve('electron-builder.staging.yml'), 'utf8')
const localBuilderConfig = readFileSync(resolve('electron-builder.local-validation.yml'), 'utf8')
const mainSource = readFileSync(resolve('src/main/index.ts'), 'utf8')

describe('bundled diagnostic label', () => {
  it('exists as a permanent Agent-owned resource', () => {
    expect(existsSync(sourcePath)).toBe(true)
    expect(document).toContain('NotiVenta')
    expect(document).toContain('TEST LABEL')
    expect(document).toContain('NOT FOR SHIPPING')
  })

  it('declares exact 4 x 6 inch portrait geometry with zero page margins', () => {
    expect(document).toMatch(/@page\s*{[^}]*size:\s*4in 6in;[^}]*margin:\s*0;/s)
    expect(document).toMatch(/html,\s*body\s*{[^}]*width:\s*4in;[^}]*height:\s*6in;/s)
    expect(document).toMatch(/\.label\s*{[^}]*width:\s*4in;[^}]*height:\s*6in;/s)
    expect(document).toContain('print-color-adjust: exact')
  })

  it('contains clipping, orientation, readability, and density diagnostics inside a safe inset', () => {
    expect(document).toContain('class="safe-area"')
    expect(document).toContain('border: 2px solid #000')
    expect(document).toContain('TOP / FEED DIRECTION')
    expect(document).toContain('BOTTOM / LABEL EXIT')
    expect(document).toContain('top-left')
    expect(document).toContain('top-right')
    expect(document).toContain('bottom-left')
    expect(document).toContain('bottom-right')
    expect(document).toContain('Text readability')
    expect(document).toContain('Thermal density bars')
    expect(document).toContain('density-100')
    expect(document).toContain('density-25')
  })

  it('is self-contained and blocks scripts, network access, external media, and fonts', () => {
    expect(document).toContain("default-src 'none'")
    expect(document).toContain("connect-src 'none'")
    expect(document).toContain("script-src 'none'")
    expect(document).not.toMatch(/<script\b/i)
    expect(document).not.toMatch(/<(?:img|iframe|object|embed|link)\b/i)
    expect(document).not.toMatch(/\b(?:src|href)\s*=/i)
    expect(document).not.toMatch(/url\s*\(/i)
    expect(document).not.toMatch(/https?:\/\//i)
  })

  it('resolves an absolute source path in development and uses the P0.1 request contract', () => {
    const appPath = resolve('/workspace/notiventa-agent')
    const request = createDiagnosticLabelPrintRequest({
      isPackaged: false,
      appPath,
      resourcesPath: resolve('/unused')
    })
    expect(request).toEqual({
      documentPath: resolve(appPath, 'resources', 'diagnostic-label.html')
    })
    expect(isAbsolute(request.documentPath)).toBe(true)
  })

  it('resolves the installed extraResource path in packaged Electron', () => {
    const resourcesPath = resolve('/installed-agent/resources')
    const result = resolveDiagnosticLabelPath({
      isPackaged: true,
      appPath: resolve('/unused/app.asar'),
      resourcesPath
    })
    expect(result).toBe(resolve(resourcesPath, PACKAGED_DIAGNOSTIC_LABEL_RELATIVE_PATH))
    expect(isAbsolute(result)).toBe(true)
  })

  it.each([
    ['staging', stagingBuilderConfig],
    ['local validation', localBuilderConfig]
  ])('copies the asset outside ASAR in the %s package', (_name, config) => {
    expect(config).toContain('extraResources:')
    expect(config).toContain('from: resources/diagnostic-label.html')
    expect(config).toContain('to: diagnostic/diagnostic-label.html')
  })

  it('wires the fixed resolved request into the P0.1 adapter in Electron Main', () => {
    expect(mainSource).toContain('createDiagnosticLabelPrintRequest({')
    expect(mainSource).toContain('appPath: app.getAppPath()')
    expect(mainSource).toContain('resourcesPath: process.resourcesPath')
    expect(mainSource).toContain('windowsPrinter.print(diagnosticLabelRequest)')
  })
})
