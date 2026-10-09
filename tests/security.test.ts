import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../src/shared/contracts'
import { PRELOAD_OUTPUT_FILENAME } from '../src/shared/build-artifacts'

describe('Electron security boundary', () => {
  it('exposes only the intended Agent IPC channels', () => {
    expect(Object.keys(IPC_CHANNELS).sort()).toEqual([
      'clearPrinterConfiguration', 'getPrinterConfiguration', 'getPrinterReadiness', 'getStartWithWindows', 'getState',
      'listInstalledPrinters', 'pairDevice', 'selectPrinter', 'setStartWithWindows', 'stateChanged'
    ])
  })

  it('does not expose the credential or a generic invoke bridge from preload', () => {
    const source = readFileSync(resolve('src/preload/index.ts'), 'utf8')
    expect(source).not.toContain('deviceCredential')
    expect(source).not.toContain('invoke(channel')
    expect(source).not.toContain('require(')
  })

  it('locks down BrowserWindow web preferences and navigation', () => {
    const source = readFileSync(resolve('src/main/window.ts'), 'utf8')
    expect(source).toContain('contextIsolation: true')
    expect(source).toContain('nodeIntegration: false')
    expect(source).toContain('sandbox: true')
    expect(source).toContain("action: 'deny'")
    expect(source).toContain("'will-navigate'")
    expect(source).toContain("'Content-Security-Policy'")
    expect(source).toContain('contentSecurityPolicy(rendererUrl)')
  })

  it('builds and references a CommonJS preload artifact', () => {
    const config = readFileSync(resolve('electron.vite.config.ts'), 'utf8')
    const main = readFileSync(resolve('src/main/index.ts'), 'utf8')
    expect(PRELOAD_OUTPUT_FILENAME).toBe('index.cjs')
    expect(config).toContain("format: 'cjs'")
    expect(config).toContain('entryFileNames: PRELOAD_OUTPUT_FILENAME')
    expect(main).toContain('PRELOAD_OUTPUT_FILENAME')
    expect(main).not.toContain('index.mjs')
  })
})
