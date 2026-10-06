import type { CredentialStore } from '../src/main/credential-store'
import {
  type PendingReceipt,
  type SettingsStore
} from '../src/main/settings-store'
import { parsePendingReceipt, type PendingReceiptLoadResult } from '../src/main/pending-receipt'
import type { SafeDeviceMetadata } from '../src/shared/contracts'

export class MemoryCredentialStore implements CredentialStore {
  credential: string | null = null
  readonly writes: string[] = []
  clearCount = 0
  failedWritesRemaining = 0

  async get(): Promise<string | null> { return this.credential }
  async set(value: string): Promise<void> {
    this.writes.push(value)
    if (this.failedWritesRemaining > 0) {
      this.failedWritesRemaining -= 1
      throw new Error('native keyring detail that must stay in Main')
    }
    this.credential = value
  }
  async clear(): Promise<void> { this.credential = null; this.clearCount += 1 }
}

export class MemorySettingsStore implements SettingsStore {
  startWithWindows = true
  metadata: SafeDeviceMetadata | null = null
  credential = undefined
  pendingReceipt: unknown = undefined
  pendingReceiptWrites: PendingReceipt[] = []
  pendingReceiptClearCount = 0
  pendingReceiptWriteFailuresRemaining = 0
  pendingReceiptClearFailuresRemaining = 0

  getStartWithWindows(): boolean { return this.startWithWindows }
  setStartWithWindows(enabled: boolean): void { this.startWithWindows = enabled }
  getDeviceMetadata(): SafeDeviceMetadata | null { return this.metadata }
  setDeviceMetadata(metadata: SafeDeviceMetadata): void { this.metadata = metadata }
  clearDeviceMetadata(): void { this.metadata = null }
  getPendingReceipt(): PendingReceiptLoadResult { return parsePendingReceipt(this.pendingReceipt) }
  setPendingReceipt(receipt: PendingReceipt): void {
    this.pendingReceiptWrites.push(receipt)
    if (this.pendingReceiptWriteFailuresRemaining > 0) {
      this.pendingReceiptWriteFailuresRemaining -= 1
      throw new Error('local settings store unavailable')
    }
    this.pendingReceipt = structuredClone(receipt)
  }
  clearPendingReceipt(): void {
    if (this.pendingReceiptClearFailuresRemaining > 0) {
      this.pendingReceiptClearFailuresRemaining -= 1
      throw new Error('local settings store unavailable')
    }
    this.pendingReceipt = undefined
    this.pendingReceiptClearCount += 1
  }
}
