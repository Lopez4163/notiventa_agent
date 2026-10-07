import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackendError, DefinitiveDeviceAuthenticationError } from '../src/main/api-client'
import { PollScheduler } from '../src/main/poll-scheduler'

afterEach(() => vi.useRealTimers())

describe('PollScheduler', () => {
  it('polls immediately, never overlaps, and honors pollAfterSeconds', async () => {
    vi.useFakeTimers()
    let resolvePoll!: (value: { backend: never; job: null; pollAfterSeconds: number }) => void
    const poll = vi.fn(() => new Promise<{ backend: never; job: null; pollAfterSeconds: number }>((resolve) => { resolvePoll = resolve }))
    const scheduler = new PollScheduler({ poll, onSuccess: vi.fn(), onTemporaryFailure: vi.fn(), onDefinitiveAuthenticationFailure: vi.fn() })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(poll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(poll).toHaveBeenCalledTimes(1)
    resolvePoll({ backend: undefined as never, job: null, pollAfterSeconds: 7 })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(6_999)
    expect(poll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(poll).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('backs off at 5/10/20/30 seconds and resets after success', async () => {
    vi.useFakeTimers()
    const temporary = new BackendError('offline', null, null, true)
    const poll = vi.fn()
      .mockRejectedValueOnce(temporary)
      .mockRejectedValueOnce(temporary)
      .mockRejectedValueOnce(temporary)
      .mockRejectedValueOnce(temporary)
      .mockRejectedValueOnce(temporary)
      .mockResolvedValueOnce({ backend: {}, job: null, pollAfterSeconds: 5 })
      .mockRejectedValueOnce(temporary)
    const scheduler = new PollScheduler({ poll, onSuccess: vi.fn(), onTemporaryFailure: vi.fn(), onDefinitiveAuthenticationFailure: vi.fn() })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    for (const delay of [5_000, 10_000, 20_000, 30_000, 30_000, 5_000]) {
      await vi.advanceTimersByTimeAsync(delay)
    }
    expect(poll).toHaveBeenCalledTimes(7)
    scheduler.stop()
  })

  it('uses the five-second fallback when the backend interval is invalid', async () => {
    vi.useFakeTimers()
    const poll = vi.fn().mockResolvedValue({ backend: {}, job: null, pollAfterSeconds: 0 })
    const scheduler = new PollScheduler({ poll, onSuccess: vi.fn(), onTemporaryFailure: vi.fn(), onDefinitiveAuthenticationFailure: vi.fn() })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(poll).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(poll).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('honors a valid backend interval greater than the failure-backoff maximum', async () => {
    vi.useFakeTimers()
    const poll = vi.fn().mockResolvedValue({ backend: {}, job: null, pollAfterSeconds: 45 })
    const scheduler = new PollScheduler({ poll, onSuccess: vi.fn(), onTemporaryFailure: vi.fn(), onDefinitiveAuthenticationFailure: vi.fn() })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(44_999)
    expect(poll).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(poll).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('stops after definitive authentication failure', async () => {
    vi.useFakeTimers()
    const invalid = vi.fn()
    const poll = vi.fn().mockRejectedValue(new DefinitiveDeviceAuthenticationError())
    const scheduler = new PollScheduler({ poll, onSuccess: vi.fn(), onTemporaryFailure: vi.fn(), onDefinitiveAuthenticationFailure: invalid })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(invalid).toHaveBeenCalledOnce()
    expect(scheduler.isPolling()).toBe(false)
  })
})
