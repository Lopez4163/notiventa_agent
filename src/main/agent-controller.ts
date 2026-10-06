import { EventEmitter } from 'node:events'
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
  private credentialWriteInFlight = false
  private receiptAcknowledgementInFlight = false
  private assignmentRecoveryInFlight = false
  private pendingReceiptPersistence: ReceivedPrintJob | null = null
  private pendingReceiptAcknowledgement: ReceivedPrintJob | null = null

  constructor(
    private readonly api: NotiVentaApiClient,
    private readonly credentials: CredentialStore,
    private readonly settings: SettingsStore,
    systemName: string
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
    const pendingReceipt = this.settings.getPendingReceipt()
    if (pendingReceipt.kind === 'invalid') {
      this.update({
        lifecycle: 'disconnected',
        error: 'Pending job receipt data is invalid. NotiVenta will not request more work.'
      })
      return
    }

    const credential = await this.credentials.get()
    if (!credential) {
      this.update({
        lifecycle: 'needs-pairing',
        device: null,
        backend: null,
        receivedJob: pendingReceipt.kind === 'valid' ? pendingReceipt.receipt.job : null,
        error: pendingReceipt.kind === 'valid'
          ? 'A pending job receipt requires this computer to be paired again.'
          : null
      })
      return
    }

    if (pendingReceipt.kind === 'valid') {
      this.pendingReceiptAcknowledgement = pendingReceipt.receipt.job
      this.update({
        lifecycle: 'connecting',
        receivedJob: pendingReceipt.receipt.job,
        error: 'Job receipt acknowledgement is pending.'
      })
      await this.acknowledgeReceivedJob()
      return
    }

    this.update({ lifecycle: 'connecting', error: null })
    await this.recoverCurrentAssignment()
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
    this.credentialRetryTimer = null
    this.receiptPersistenceRetryTimer = null
    this.receiptRetryTimer = null
    this.assignmentRecoveryRetryTimer = null
    this.pendingCredential = null
    this.pendingDevice = null
    this.pendingReceiptAcknowledgement = null
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
          this.settings.clearPendingReceipt()
        } catch {
          this.update({ error: 'Job receipt acknowledgement is pending.' })
          this.scheduleReceiptRetry()
          return
        }
        this.pendingReceiptAcknowledgement = null
        if (this.receiptRetryTimer) clearTimeout(this.receiptRetryTimer)
        this.receiptRetryTimer = null
        this.update({ error: null })
        this.scheduler.start(5_000)
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
      void this.acknowledgeReceivedJob()
      return
    }
    void this.recoverCurrentAssignment()
  }

  private async handleDefinitiveAuthenticationFailure(): Promise<void> {
    await this.credentials.clear()
    this.settings.clearDeviceMetadata()
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
