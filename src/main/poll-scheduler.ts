import { DefinitiveDeviceAuthenticationError, type PollResult } from './api-client'

const DEFAULT_POLL_DELAY_MS = 5_000
const BACKOFF_DELAYS_MS = [5_000, 10_000, 20_000, 30_000] as const

export interface PollSchedulerCallbacks {
  poll(): Promise<PollResult>
  onSuccess(result: PollResult): void
  onTemporaryFailure(error: unknown): void
  onDefinitiveAuthenticationFailure(error: DefinitiveDeviceAuthenticationError): Promise<void> | void
}

export class PollScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private inFlight = false
  private failureIndex = 0

  constructor(private readonly callbacks: PollSchedulerCallbacks) {}

  start(initialDelayMs = 0): void {
    if (this.running) return
    this.running = true
    this.schedule(initialDelayMs)
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  isPolling(): boolean {
    return this.running
  }

  private schedule(delayMs: number): void {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick(), delayMs)
  }

  private async tick(): Promise<void> {
    if (!this.running || this.inFlight) return
    this.inFlight = true
    try {
      const result = await this.callbacks.poll()
      this.failureIndex = 0
      this.callbacks.onSuccess(result)
      this.schedule(normalDelay(result.pollAfterSeconds))
    } catch (error) {
      if (error instanceof DefinitiveDeviceAuthenticationError) {
        this.stop()
        await this.callbacks.onDefinitiveAuthenticationFailure(error)
      } else {
        this.callbacks.onTemporaryFailure(error)
        const delay = BACKOFF_DELAYS_MS[Math.min(this.failureIndex, BACKOFF_DELAYS_MS.length - 1)]
        this.failureIndex += 1
        this.schedule(delay)
      }
    } finally {
      this.inFlight = false
    }
  }
}

function normalDelay(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_POLL_DELAY_MS
  return seconds * 1_000
}
