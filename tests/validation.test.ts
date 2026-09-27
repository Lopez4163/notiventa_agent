import { describe, expect, it } from 'vitest'
import { validateBoolean, validatePairDeviceInput } from '../src/shared/validation'

describe('IPC validation', () => {
  it('normalizes a valid pairing request', () => {
    expect(validatePairDeviceInput({ pairingCode: '482193', displayName: ' Packing Station ' })).toEqual({
      pairingCode: '482193',
      displayName: 'Packing Station'
    })
  })

  it.each(['12345', '1234567', '12a456'])('rejects invalid pairing code %s', (pairingCode) => {
    expect(() => validatePairDeviceInput({ pairingCode, displayName: 'Station' })).toThrow()
  })

  it('rejects blank display names and non-boolean settings', () => {
    expect(() => validatePairDeviceInput({ pairingCode: '482193', displayName: '  ' })).toThrow()
    expect(() => validateBoolean('true')).toThrow()
  })
})
