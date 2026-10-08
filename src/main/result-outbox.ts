import { DatabaseSync } from 'node:sqlite'

export type AgentResultType = 'PRINTING' | 'PRINTED_SUCCESSFULLY' | 'PRINT_FAILED' | 'UNKNOWN'
export type AgentResultExecutionMode = 'SIMULATED' | 'PHYSICAL'

export interface PendingResultEvent {
  version: 1
  eventId: string
  jobId: string
  attemptId: string
  type: AgentResultType
  executionMode: AgentResultExecutionMode
  occurredAt: string
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
}

export type ResultOutboxLoadResult =
  | { kind: 'valid'; events: PendingResultEvent[] }
  | { kind: 'invalid' }

export interface ResultOutbox {
  getPendingEvents(): ResultOutboxLoadResult
  add(event: PendingResultEvent): void
  remove(eventId: string): void
  close?(): void
}

export class SqliteResultOutbox implements ResultOutbox {
  private readonly database: DatabaseSync

  constructor(path: string) {
    this.database = new DatabaseSync(path)
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pending_result_events (
        event_id TEXT PRIMARY KEY NOT NULL,
        job_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        type TEXT NOT NULL,
        execution_mode TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL
      )
    `)
  }

  getPendingEvents(): ResultOutboxLoadResult {
    try {
      const rows = this.database.prepare(`
        SELECT event_id, job_id, attempt_id, type, execution_mode, occurred_at,
               error_code, error_message, created_at
        FROM pending_result_events
        ORDER BY created_at ASC, event_id ASC
      `).all()
      const events = rows.map(parsePendingResultEvent)
      return events.every((event): event is PendingResultEvent => event !== null)
        ? { kind: 'valid', events }
        : { kind: 'invalid' }
    } catch {
      return { kind: 'invalid' }
    }
  }

  add(event: PendingResultEvent): void {
    if (!isPendingResultEvent(event)) throw new Error('Result outbox event is invalid.')
    this.database.prepare(`
      INSERT INTO pending_result_events (
        event_id, job_id, attempt_id, type, execution_mode, occurred_at,
        error_code, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.jobId,
      event.attemptId,
      event.type,
      event.executionMode,
      event.occurredAt,
      event.errorCode,
      event.errorMessage,
      event.createdAt
    )
  }

  remove(eventId: string): void {
    this.database.prepare('DELETE FROM pending_result_events WHERE event_id = ?').run(eventId)
  }

  close(): void {
    this.database.close()
  }
}

export function isTerminalResultType(type: AgentResultType): boolean {
  return type === 'PRINTED_SUCCESSFULLY' || type === 'PRINT_FAILED' || type === 'UNKNOWN'
}

function parsePendingResultEvent(value: unknown): PendingResultEvent | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const event = {
    version: 1 as const,
    eventId: row.event_id,
    jobId: row.job_id,
    attemptId: row.attempt_id,
    type: row.type,
    executionMode: row.execution_mode,
    occurredAt: row.occurred_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at
  }
  return isPendingResultEvent(event) ? event : null
}

function isPendingResultEvent(value: unknown): value is PendingResultEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  return event.version === 1 &&
    isUuid(event.eventId) &&
    isUuid(event.jobId) &&
    isUuid(event.attemptId) &&
    isResultType(event.type) &&
    isExecutionMode(event.executionMode) &&
    isIsoDate(event.occurredAt) &&
    isNullableShortText(event.errorCode, 100) &&
    isNullableShortText(event.errorMessage, 1000) &&
    isIsoDate(event.createdAt)
}

function isResultType(value: unknown): value is AgentResultType {
  return value === 'PRINTING' || value === 'PRINTED_SUCCESSFULLY' || value === 'PRINT_FAILED' || value === 'UNKNOWN'
}

function isExecutionMode(value: unknown): value is AgentResultExecutionMode {
  return value === 'SIMULATED' || value === 'PHYSICAL'
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isNullableShortText(value: unknown, maximum: number): boolean {
  return value === null || (typeof value === 'string' && value.length <= maximum)
}
