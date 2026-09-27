import { EventEmitter } from 'node:events'
import type { AgentState, PairDeviceInput } from '../shared/contracts'
import { validatePairDeviceInput } from '../shared/validation'
import { BackendError, NotiVentaApiClient } from './api-client'
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
  private credentialWriteInFlight = false

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
      error: null
    }
    this.scheduler = new PollScheduler({
      poll: async () => {
        const credential = await this.credentials.get()
        if (!credential) throw new Error('Device credential is unavailable.')
        return this.api.poll(credential)
      },
      onSuccess: (result) => {
        this.update({ lifecycle: 'connected', backend: result.backend, error: null })
      },
      onTemporaryFailure: () => {
        this.update({ lifecycle: 'disconnected', error: 'NotiVenta is temporarily unreachable.' })
      },
      onDefinitiveAuthenticationFailure: async () => {
        await this.credentials.clear()
        this.settings.clearDeviceMetadata()
        this.update({ lifecycle: 'needs-pairing', device: null, backend: null, error: 'This computer was disconnected. Pair it again.' })
      }
    })
  }

  async initialize(): Promise<void> {
    const credential = await this.credentials.get()
    if (!credential) {
      this.update({ lifecycle: 'needs-pairing', device: null, backend: null, error: null })
      return
    }
    this.update({ lifecycle: 'connecting', error: null })
    this.scheduler.start()
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
    this.credentialRetryTimer = null
    this.pendingCredential = null
    this.pendingDevice = null
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
    this.scheduler.start()
  }

  private scheduleCredentialRetry(): void {
    if (this.credentialRetryTimer) return
    this.credentialRetryTimer = setTimeout(() => {
      this.credentialRetryTimer = null
      void this.persistPendingCredential()
    }, 5_000)
  }

  private update(update: Partial<AgentState>): void {
    this.state = { ...this.state, ...update }
    this.events.emit('state', this.getState())
  }
}
