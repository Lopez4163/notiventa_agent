import type { PairDeviceInput } from './contracts'

export function validatePairDeviceInput(value: unknown): PairDeviceInput {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid pairing request.')
  }
  const candidate = value as Record<string, unknown>
  if (typeof candidate.pairingCode !== 'string' || !/^\d{6}$/.test(candidate.pairingCode)) {
    throw new Error('Pairing code must contain six digits.')
  }
  if (typeof candidate.displayName !== 'string') {
    throw new Error('Display name is required.')
  }
  const displayName = candidate.displayName.trim()
  if (!displayName || displayName.length > 255) {
    throw new Error('Display name must be between 1 and 255 characters.')
  }
  return { pairingCode: candidate.pairingCode, displayName }
}

export function validateBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Expected a boolean value.')
  return value
}
