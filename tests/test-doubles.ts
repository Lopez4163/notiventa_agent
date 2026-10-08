import type { CredentialStore } from '../src/main/credential-store'
import {
  type PendingReceipt,
  type SettingsStore
} from '../src/main/settings-store'
import { parsePendingReceipt, type PendingReceiptLoadResult } from '../src/main/pending-receipt'
import { parseActiveAssignment, type ActiveAssignmentLoadResult } from '../src/main/active-assignment'
import type { ActiveAssignment } from '../src/main/settings-store'
import type { PendingResultEvent, ResultOutbox, ResultOutboxLoadResult } from '../src/main/result-outbox'
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
  activeAssignment: unknown = undefined
  activeAssignmentWrites: ActiveAssignment[] = []
  activeAssignmentClearCount = 0
  activeAssignmentWriteFailuresRemaining = 0
  activeAssignmentClearFailuresRemaining = 0

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
  getActiveAssignment(): ActiveAssignmentLoadResult { return parseActiveAssignment(this.activeAssignment) }
  setActiveAssignment(assignment: ActiveAssignment): void {
    this.activeAssignmentWrites.push(structuredClone(assignment))
    if (this.activeAssignmentWriteFailuresRemaining > 0) {
      this.activeAssignmentWriteFailuresRemaining -= 1
      throw new Error('local settings store unavailable')
    }
    this.activeAssignment = structuredClone(assignment)
  }
  clearActiveAssignment(): void {
    if (this.activeAssignmentClearFailuresRemaining > 0) {
      this.activeAssignmentClearFailuresRemaining -= 1
      throw new Error('local settings store unavailable')
    }
    this.activeAssignment = undefined
    this.activeAssignmentClearCount += 1
  }
}

export class MemoryResultOutbox implements ResultOutbox {
  events: PendingResultEvent[] = []
  invalid = false
  addFailuresRemaining = 0
  removeFailuresRemaining = 0
  readonly added: PendingResultEvent[] = []
  readonly removed: string[] = []

  getPendingEvents(): ResultOutboxLoadResult {
    return this.invalid ? { kind: 'invalid' } : { kind: 'valid', events: structuredClone(this.events) }
  }
  add(event: PendingResultEvent): void {
    this.added.push(structuredClone(event))
    if (this.addFailuresRemaining > 0) {
      this.addFailuresRemaining -= 1
      throw new Error('result outbox unavailable')
    }
    this.events.push(structuredClone(event))
  }
  remove(eventId: string): void {
    this.removed.push(eventId)
    if (this.removeFailuresRemaining > 0) {
      this.removeFailuresRemaining -= 1
      throw new Error('result outbox unavailable')
    }
    this.events = this.events.filter((event) => event.eventId !== eventId)
  }
}
