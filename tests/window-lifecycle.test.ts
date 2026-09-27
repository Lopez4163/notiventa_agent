import { describe, expect, it, vi } from 'vitest'
import { handleWindowClose, reopenWindow } from '../src/main/window-lifecycle'

describe('tray window lifecycle', () => {
  it('hides instead of quitting on ordinary close', () => {
    const preventDefault = vi.fn()
    const window = { hide: vi.fn(), show: vi.fn(), focus: vi.fn() }
    handleWindowClose({ preventDefault }, window, false)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(window.hide).toHaveBeenCalledOnce()
  })

  it('allows explicit Quit and can reopen/focus the window', () => {
    const preventDefault = vi.fn()
    const window = { hide: vi.fn(), show: vi.fn(), focus: vi.fn() }
    handleWindowClose({ preventDefault }, window, true)
    expect(preventDefault).not.toHaveBeenCalled()
    reopenWindow(window)
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })
})
