import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { AgentState, PairDeviceInput, ReceivedPrintJob } from '../shared/contracts'
import { validatePairDeviceInput } from '../shared/validation'
import {
  BackendError,
  DefinitiveDeviceAuthenticationError,
  NotiVentaApiClient
} from './api-client'
import type { CredentialStore } from './credential-store'
import { PollScheduler } from './poll-scheduler'
import type { SettingsStore } from './settings-store'
import {
  isTerminalResultType,
  type AgentResultExecutionMode,
  type AgentResultType,
  type PendingResultEvent,
  type ResultOutbox
} from './result-outbox'
import type { PrintCoordinator } from './printing/print-coordinator'

export interface RecordPrintResultInput {
  jobId: string
  attemptId: string
  type: AgentResultType
  executionMode: AgentResultExecutionMode
  occurredAt?: string
  errorCode?: string | null
  errorMessage?: string | null
}

/**
 * Persists a result using the normal outbox, then waits for the backend to
 * acknowledge this exact event. Physical execution uses this only for PRINTING
 * so it never crosses the Windows boundary on a merely local write.
 */
export interface AwaitPrintResultAcknowledgementInput extends RecordPrintResultInput {}

export class AgentController {
  private readonly events = new EventEmitter()
  private readonly scheduler: PollScheduler
  private state: AgentState
  private pendingCredential: string | null = null
  private pendingDevice: AgentState['device'] = null
  private credentialRetryTimer: ReturnType<typeof setTimeout> | null = null
  private receiptPersistenceRetryTimer: ReturnType<typeof setTimeout> | null = null
  private receiptRetryTimer: ReturnType<typeof setTimeout> | null = null
  private assignmentRecoveryRetryTimer: ReturnType<typeof setTimeout> | null = null
  private resultDeliveryRetryTimer: ReturnType<typeof setTimeout> | null = null
  private credentialWriteInFlight = false
  private receiptAcknowledgementInFlight = false
  private assignmentRecoveryInFlight = false
  private resultDeliveryInFlight = false
  private pendingReceiptPersistence: ReceivedPrintJob | null = null
  private pendingReceiptAcknowledgement: ReceivedPrintJob | null = null

  constructor(
    private readonly api: NotiVentaApiClient,
    private readonly credentials: CredentialStore,
    private readonly settings: SettingsStore,
    systemName: string,
    private readonly resultOutbox: ResultOutbox
  ) {
    this.state = {
      lifecycle: 'needs-pairing',
      systemName,
      device: settings.getDeviceMetadata(),
      backend: null,
      receivedJob: null,
      error: null
    }
    this.scheduler = new PollScheduler({
      poll: async () => {
        const credential = await this.credentials.get()
        if (!credential) throw new Error('Device credential is unavailable.')
        return this.api.poll(credential)
      },
      onSuccess: (result) => {
        if (result.job) {
          this.scheduler.stop()
          this.persistPendingReceipt(result.job, result.backend)
          return
        }
        this.update({
          lifecycle: 'connected',
          backend: result.backend,
          receivedJob: this.state.receivedJob,
          error: null
        })
      },
      onTemporaryFailure: () => {
        this.update({ lifecycle: 'disconnected', error: 'NotiVenta is temporarily unreachable.' })
      },
      onDefinitiveAuthenticationFailure: async () => this.handleDefinitiveAuthenticationFailure()
    })
  }

  async initialize(): Promise<void> {
    const outbox = this.resultOutbox.getPendingEvents()
    if (outbox.kind === 'invalid') {
      this.holdForInvalidLocalState('Saved print-result delivery data is invalid. NotiVenta will not request more work.')
      return
    }
    const pendingReceipt = this.settings.getPendingReceipt()
    if (pendingReceipt.kind === 'invalid') {
      this.update({
        lifecycle: 'disconnected',
        error: 'Pending job receipt data is invalid. NotiVenta will not request more work.'
      })
      return
    }
    const activeAssignment = this.settings.getActiveAssignment()
    if (activeAssignment.kind === 'invalid') {
      this.holdForInvalidLocalState('Active job data is invalid. NotiVenta will not request more work.')
      return
    }

    const credential = await this.credentials.get()
    if (!credential) {
      console.info('[credentials] No secure Device credential is available; pairing is required.')
      this.update({
        lifecycle: 'needs-pairing',
        device: null,
        backend: null,
        receivedJob: activeAssignment.kind === 'valid' ? activeAssignment.assignment.job : pendingReceipt.kind === 'valid' ? pendingReceipt.receipt.job : null,
        error: outbox.events.length > 0 || pendingReceipt.kind === 'valid' || activeAssignment.kind === 'valid'
          ? 'Saved Agent work requires this computer to be paired again.' : null
      })
      return
    }

    console.info('[credentials] Secure Device credential restored.')
    this.update({ lifecycle: 'connecting', receivedJob: activeAssignment.kind === 'valid' ? activeAssignment.assignment.job : pendingReceipt.kind === 'valid' ? pendingReceipt.receipt.job : null, error: null })
    if (outbox.events.length > 0) {
      console.info(`[result-outbox] Restoring ${outbox.events.length} pending result event(s).`)
      await this.flushResultOutbox()
      return
    }
    await this.resumeAfterDurableWork()
  }

  async pair(input: PairDeviceInput): Promise<AgentState> {
    const validated = validatePairDeviceInput(input)
    if (this.pendingCredential) {
      await this.persistPendingCredential()
      return this.getState()
    }
    this.scheduler.stop()
    this.update({ lifecycle: 'connecting', error: null })
    try {
      const result = await this.api.pair({ ...validated, systemName: this.state.systemName })
      const safeDevice = {
        id: result.device.id,
        systemName: result.device.systemName,
        displayName: result.device.displayName,
        platform: result.device.platform,
        agentVersion: result.device.agentVersion
      }
      this.pendingCredential = result.deviceCredential
      this.pendingDevice = safeDevice
      await this.persistPendingCredential()
    } catch (error) {
      const message = error instanceof BackendError || error instanceof Error ? error.message : 'Pairing failed.'
      this.update({ lifecycle: 'needs-pairing', error: message })
    }
    return this.getState()
  }

  getState(): AgentState {
    return structuredClone(this.state)
  }

  onState(listener: (state: AgentState) => void): () => void {
    this.events.on('state', listener)
    return () => this.events.off('state', listener)
  }

  shutdown(): void {
    this.scheduler.stop()
    if (this.credentialRetryTimer) clearTimeout(this.credentialRetryTimer)
    if (this.receiptPersistenceRetryTimer) clearTimeout(this.receiptPersistenceRetryTimer)
    if (this.receiptRetryTimer) clearTimeout(this.receiptRetryTimer)
    if (this.assignmentRecoveryRetryTimer) clearTimeout(this.assignmentRecoveryRetryTimer)
    if (this.resultDeliveryRetryTimer) clearTimeout(this.resultDeliveryRetryTimer)
    this.credentialRetryTimer = null
    this.receiptPersistenceRetryTimer = null
    this.receiptRetryTimer = null
    this.assignmentRecoveryRetryTimer = null
    this.resultDeliveryRetryTimer = null
    this.pendingCredential = null
    this.pendingDevice = null
    this.pendingReceiptAcknowledgement = null
    this.resultOutbox.close?.()
  }

  recordPrintResult(input: RecordPrintResultInput): boolean {
    const event = this.persistPrintResult(input)
    if (!event) return false
    void this.flushResultOutbox()
    return true
  }

  async recordPrintResultAndAwaitAcknowledgement(
    input: AwaitPrintResultAcknowledgementInput
  ): Promise<boolean> {
    const event = this.persistPrintResult(input)
    if (!event) return false
    await this.flushResultOutbox()
    const pending = this.resultOutbox.getPendingEvents()
    if (pending.kind === 'invalid') {
      this.holdForInvalidLocalState('Saved print-result delivery data is invalid. NotiVenta will not request more work.')
      return false
    }
    return !pending.events.some((pendingEvent) => pendingEvent.eventId === event.eventId)
  }

  private persistPrintResult(input: RecordPrintResultInput): PendingResultEvent | null {
    const active = this.settings.getActiveAssignment()
    if (active.kind !== 'valid' || active.assignment.job.jobId !== input.jobId || active.assignment.job.attemptId !== input.attemptId) {
      this.holdForInvalidLocalState('A print result does not match the active job. NotiVenta will not request more work.')
      return null
    }
    const existing = this.resultOutbox.getPendingEvents()
    if (existing.kind === 'invalid') {
      this.holdForInvalidLocalState('Saved print-result delivery data is invalid. NotiVenta will not request more work.')
      return null
    }
    const existingEvent = existing.events.find((event) => event.attemptId === input.attemptId && event.type === input.type)
    if (existingEvent) {
      console.info(`[result-outbox] Existing ${input.type} result retained for attempt ${input.attemptId}.`)
      return existingEvent
    }
    const now = new Date().toISOString()
    const event: PendingResultEvent = {
      version: 1,
      eventId: randomUUID(),
      jobId: input.jobId,
      attemptId: input.attemptId,
      type: input.type,
      executionMode: input.executionMode,
      occurredAt: input.occurredAt ?? now,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      createdAt: now
    }
    try {
      this.resultOutbox.add(event)
    } catch {
      this.holdForInvalidLocalState('Print result could not be saved safely. NotiVenta will not request more work.')
      return null
    }
    console.info(`[result-outbox] Created ${event.eventId} for job ${event.jobId}.`)
    return event
  }

  async executeActiveAssignment(coordinator: PrintCoordinator): Promise<boolean> {
    const active = this.settings.getActiveAssignment()
    if (active.kind !== 'valid') {
      this.holdForInvalidLocalState('No valid active job is available for execution. NotiVenta will not request more work.')
      return false
    }
    const { job } = active.assignment
    return coordinator.execute({
      jobId: job.jobId,
      attemptId: job.attemptId,
      document: { kind: 'SYNTHETIC_TEST' }
    })
  }

  private async persistPendingCredential(): Promise<void> {
    if (!this.pendingCredential || !this.pendingDevice || this.credentialWriteInFlight) return
    this.credentialWriteInFlight = true
    try {
      await this.credentials.set(this.pendingCredential)
    } catch {
      this.update({
        lifecycle: 'credential-storage-retry-required',
        device: this.pendingDevice,
        backend: null,
        error: 'This computer was paired, but NotiVenta could not securely save its credential. Keep the app open while it retries.'
      })
      this.scheduleCredentialRetry()
      return
    } finally {
      this.credentialWriteInFlight = false
    }

    const device = this.pendingDevice
    this.pendingCredential = null
    this.pendingDevice = null
    this.settings.setDeviceMetadata(device)
    console.info('[credentials] Secure Device credential stored.')
    this.update({ device, lifecycle: 'connecting', error: null })
    this.resumeAfterCredentialPersistence()
  }

  private scheduleCredentialRetry(): void {
    if (this.credentialRetryTimer) return
    this.credentialRetryTimer = setTimeout(() => {
      this.credentialRetryTimer = null
      void this.persistPendingCredential()
    }, 5_000)
  }

  private async acknowledgeReceivedJob(): Promise<void> {
    const job = this.pendingReceiptAcknowledgement
    if (!job || this.receiptAcknowledgementInFlight) return
    this.receiptAcknowledgementInFlight = true
    try {
      const credential = await this.credentials.get()
      if (!credential) throw new Error('Device credential is unavailable.')
      await this.api.acknowledgeReceipt(credential, job.attemptId)
      if (this.pendingReceiptAcknowledgement?.attemptId === job.attemptId) {
        try {
          this.settings.setActiveAssignment({ version: 1, job })
          this.settings.clearPendingReceipt()
        } catch {
          this.update({ error: 'Job receipt acknowledgement is pending.' })
          this.scheduleReceiptRetry()
          return
        }
        this.pendingReceiptAcknowledgement = null
        if (this.receiptRetryTimer) clearTimeout(this.receiptRetryTimer)
        this.receiptRetryTimer = null
        this.update({ lifecycle: 'connected', receivedJob: job, error: 'This job is awaiting a durable print result.' })
        this.scheduler.stop()
      }
    } catch (error) {
      if (error instanceof DefinitiveDeviceAuthenticationError) {
        this.scheduler.stop()
        await this.handleDefinitiveAuthenticationFailure()
      } else if (error instanceof BackendError && !error.temporary) {
        this.update({
          lifecycle: 'disconnected',
          error: 'Job receipt acknowledgement could not be confirmed.'
        })
      } else {
        this.update({ error: 'Job receipt acknowledgement is pending.' })
        this.scheduleReceiptRetry()
      }
    } finally {
      this.receiptAcknowledgementInFlight = false
    }
  }

  private scheduleReceiptRetry(): void {
    if (this.receiptRetryTimer) return
    this.receiptRetryTimer = setTimeout(() => {
      this.receiptRetryTimer = null
      void this.acknowledgeReceivedJob()
    }, 5_000)
  }

  private async recoverCurrentAssignment(): Promise<void> {
    if (this.assignmentRecoveryInFlight) return
    this.assignmentRecoveryInFlight = true
    try {
      const credential = await this.credentials.get()
      if (!credential) throw new Error('Device credential is unavailable.')
      const assignment = await this.api.recoverCurrentAssignment(credential)
      if (assignment) {
        this.persistPendingReceipt(assignment, null)
        return
      }
      if (this.assignmentRecoveryRetryTimer) clearTimeout(this.assignmentRecoveryRetryTimer)
      this.assignmentRecoveryRetryTimer = null
      this.scheduler.start()
    } catch (error) {
      if (error instanceof DefinitiveDeviceAuthenticationError) {
        this.scheduler.stop()
        await this.handleDefinitiveAuthenticationFailure()
      } else if (error instanceof BackendError && !error.temporary) {
        this.update({
          lifecycle: 'disconnected',
          error: 'Current job assignment could not be recovered safely.'
        })
      } else {
        this.update({
          lifecycle: 'disconnected',
          error: 'Current job assignment recovery is pending.'
        })
        this.scheduleAssignmentRecoveryRetry()
      }
    } finally {
      this.assignmentRecoveryInFlight = false
    }
  }

  private scheduleAssignmentRecoveryRetry(): void {
    if (this.assignmentRecoveryRetryTimer) return
    this.assignmentRecoveryRetryTimer = setTimeout(() => {
      this.assignmentRecoveryRetryTimer = null
      void this.recoverCurrentAssignment()
    }, 5_000)
  }

  private persistPendingReceipt(
    job: ReceivedPrintJob,
    backend: AgentState['backend']
  ): void {
    try {
      this.settings.setPendingReceipt({ version: 1, job })
    } catch {
      this.pendingReceiptPersistence = job
      this.update({
        lifecycle: 'disconnected',
        backend,
        error: 'Job receipt could not be saved safely. NotiVenta will not request more work.'
      })
      this.scheduleReceiptPersistenceRetry()
      return
    }

    this.pendingReceiptPersistence = null
    this.pendingReceiptAcknowledgement = job
    this.update({
      lifecycle: 'connected',
      backend,
      receivedJob: job,
      error: 'Job receipt acknowledgement is pending.'
    })
    void this.acknowledgeReceivedJob()
  }

  private scheduleReceiptPersistenceRetry(): void {
    if (this.receiptPersistenceRetryTimer) return
    this.receiptPersistenceRetryTimer = setTimeout(() => {
      this.receiptPersistenceRetryTimer = null
      const job = this.pendingReceiptPersistence
      if (job) this.persistPendingReceipt(job, this.state.backend)
    }, 5_000)
  }

  private resumeAfterCredentialPersistence(): void {
    void this.resumeAfterDurableWork()
  }

  private async resumeAfterDurableWork(): Promise<void> {
    const outbox = this.resultOutbox.getPendingEvents()
    if (outbox.kind === 'invalid') {
      this.holdForInvalidLocalState('Saved print-result delivery data is invalid. NotiVenta will not request more work.')
      return
    }
    if (outbox.events.length > 0) {
      await this.flushResultOutbox()
      return
    }
    const activeAssignment = this.settings.getActiveAssignment()
    if (activeAssignment.kind === 'invalid') {
      this.holdForInvalidLocalState('Active job data is invalid. NotiVenta will not request more work.')
      return
    }
    if (activeAssignment.kind === 'valid') {
      this.scheduler.stop()
      this.update({
        lifecycle: 'connected',
        receivedJob: activeAssignment.assignment.job,
        error: 'This job is awaiting a durable print result.'
      })
      return
    }
    const pendingReceipt = this.settings.getPendingReceipt()
    if (pendingReceipt.kind === 'invalid') {
      this.update({
        lifecycle: 'disconnected',
        error: 'Pending job receipt data is invalid. NotiVenta will not request more work.'
      })
      return
    }
    if (pendingReceipt.kind === 'valid') {
      this.pendingReceiptAcknowledgement = pendingReceipt.receipt.job
      this.update({
        receivedJob: pendingReceipt.receipt.job,
        error: 'Job receipt acknowledgement is pending.'
      })
      await this.acknowledgeReceivedJob()
      return
    }
    await this.recoverCurrentAssignment()
  }

  private async flushResultOutbox(): Promise<void> {
    if (this.resultDeliveryInFlight) return
    const loaded = this.resultOutbox.getPendingEvents()
    if (loaded.kind === 'invalid') {
      this.holdForInvalidLocalState('Saved print-result delivery data is invalid. NotiVenta will not request more work.')
      return
    }
    const event = loaded.events[0]
    if (!event) {
      await this.resumeAfterDurableWork()
      return
    }
    this.scheduler.stop()
    this.resultDeliveryInFlight = true
    let delivered = false
    try {
      const credential = await this.credentials.get()
      if (!credential) throw new Error('Device credential is unavailable.')
      console.info(`[result-outbox] Sending ${event.eventId} for job ${event.jobId}.`)
      await this.api.submitPrintEvent(credential, event)
      if (isTerminalResultType(event.type)) {
        const active = this.settings.getActiveAssignment()
        if (active.kind !== 'valid' || active.assignment.job.attemptId !== event.attemptId) {
          throw new Error('Active job state could not be cleared safely.')
        }
        this.settings.clearActiveAssignment()
      }
      this.resultOutbox.remove(event.eventId)
      if (this.resultDeliveryRetryTimer) clearTimeout(this.resultDeliveryRetryTimer)
      this.resultDeliveryRetryTimer = null
      console.info(`[result-outbox] Acknowledged ${event.eventId}.`)
      delivered = true
    } catch (error) {
      if (error instanceof DefinitiveDeviceAuthenticationError) {
        await this.handleDefinitiveAuthenticationFailure()
      } else if (error instanceof BackendError && !error.temporary) {
        this.update({ lifecycle: 'disconnected', error: 'Saved print result was rejected. NotiVenta will not request more work.' })
      } else {
        this.update({ lifecycle: 'disconnected', error: 'Saved print result delivery is pending.' })
        this.scheduleResultDeliveryRetry()
      }
    } finally {
      this.resultDeliveryInFlight = false
    }
    if (delivered) await this.flushResultOutbox()
  }

  private scheduleResultDeliveryRetry(): void {
    if (this.resultDeliveryRetryTimer) return
    this.resultDeliveryRetryTimer = setTimeout(() => {
      this.resultDeliveryRetryTimer = null
      void this.flushResultOutbox()
    }, 5_000)
  }

  private holdForInvalidLocalState(error: string): void {
    this.scheduler.stop()
    this.update({ lifecycle: 'disconnected', error })
  }

  private async handleDefinitiveAuthenticationFailure(): Promise<void> {
    console.warn('[credentials] Backend rejected the Device credential; deleting it from secure storage.')
    await this.credentials.clear()
    this.settings.clearDeviceMetadata()
    console.info('[credentials] Secure Device credential deleted after backend rejection.')
    this.update({
      lifecycle: 'needs-pairing',
      device: null,
      backend: null,
      receivedJob: this.pendingReceiptAcknowledgement ?? this.state.receivedJob,
      error: 'This computer was disconnected. Pair it again.'
    })
  }

  private update(update: Partial<AgentState>): void {
    this.state = { ...this.state, ...update }
    this.events.emit('state', this.getState())
  }
}
