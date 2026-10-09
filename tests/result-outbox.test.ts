import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteResultOutbox, type PendingResultEvent } from '../src/main/result-outbox'

const event: PendingResultEvent = {
  version: 1,
  eventId: '33333333-3333-4333-8333-333333333333',
  jobId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
  type: 'PRINTED_SUCCESSFULLY',
  executionMode: 'SIMULATED',
  occurredAt: '2026-10-08T15:00:00.000Z',
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-10-08T15:00:00.000Z'
}

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

describe('SqliteResultOutbox', () => {
  it('persists the immutable PF1 payload across a process-style reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'notiventa-result-outbox-'))
    directories.push(directory)
    const path = join(directory, 'result-outbox.sqlite')
    const first = new SqliteResultOutbox(path)
    first.add(event)
    first.close()

    const second = new SqliteResultOutbox(path)
    expect(second.getPendingEvents()).toEqual({ kind: 'valid', events: [event] })
    second.remove(event.eventId)
    expect(second.getPendingEvents()).toEqual({ kind: 'valid', events: [] })
    second.close()
  })
})
