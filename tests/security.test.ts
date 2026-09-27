import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../src/shared/contracts'

describe('Electron security boundary', () => {
  it('exposes only the intended Phase 4 IPC channels', () => {
    expect(Object.keys(IPC_CHANNELS).sort()).toEqual([
      'getStartWithWindows', 'getState', 'pairDevice', 'setStartWithWindows', 'stateChanged'
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
  })
})
