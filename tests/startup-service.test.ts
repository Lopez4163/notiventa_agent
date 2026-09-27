import { describe, expect, it, vi } from 'vitest'
import { StartupService } from '../src/main/startup-service'
import { MemorySettingsStore } from './test-doubles'

describe('Start with Windows', () => {
  it('defaults the non-secret preference to enabled', () => {
    expect(new MemorySettingsStore().getStartWithWindows()).toBe(true)
  })

  it('applies preference only for packaged Windows', () => {
    const setLoginItemSettings = vi.fn()
    new StartupService({ isPackaged: true, setLoginItemSettings }, 'win32').apply(false)
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false })
  })

  it('is a no-op for unpackaged development and non-Windows systems', () => {
    const development = vi.fn()
    const mac = vi.fn()
    new StartupService({ isPackaged: false, setLoginItemSettings: development }, 'win32').apply(true)
    new StartupService({ isPackaged: true, setLoginItemSettings: mac }, 'darwin').apply(true)
    expect(development).not.toHaveBeenCalled()
    expect(mac).not.toHaveBeenCalled()
  })
})
