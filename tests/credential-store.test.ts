import { beforeEach, describe, expect, it, vi } from 'vitest'

const keyring = vi.hoisted(() => ({
  password: null as string | null,
  setPassword: vi.fn((value: string) => { keyring.password = value }),
  getPassword: vi.fn(() => {
    return keyring.password
  }),
  deletePassword: vi.fn(() => {
    if (keyring.password === null) return false
    keyring.password = null
    return true
  })
}))

vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    setPassword = keyring.setPassword
    getPassword = keyring.getPassword
    deletePassword = keyring.deletePassword
  }
}))

import { WindowsCredentialStore } from '../src/main/credential-store'

describe('Windows CredentialStore adapter', () => {
  beforeEach(() => {
    keyring.password = null
    vi.clearAllMocks()
  })

  it('implements get, set, and clear through the native keyring entry', async () => {
    const store = new WindowsCredentialStore()
    expect(await store.get()).toBeNull()
    await store.set('device-secret')
    expect(await store.get()).toBe('device-secret')
    await store.clear()
    expect(await store.get()).toBeNull()
    expect(keyring.setPassword).toHaveBeenCalledWith('device-secret')
    expect(keyring.deletePassword).toHaveBeenCalledOnce()
  })

  it('does not hide real keyring failures', async () => {
    keyring.getPassword.mockImplementationOnce(() => { throw new Error('credential store unavailable') })
    await expect(new WindowsCredentialStore().get()).rejects.toThrow('credential store unavailable')
  })
})
