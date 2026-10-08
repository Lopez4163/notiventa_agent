import type { ReceivedPrintJob } from '../shared/contracts'
import { isReceivedPrintJob } from './pending-receipt'

export interface ActiveAssignment {
  version: 1
  job: ReceivedPrintJob
}

export type ActiveAssignmentLoadResult =
  | { kind: 'none' }
  | { kind: 'valid'; assignment: ActiveAssignment }
  | { kind: 'invalid' }

export function parseActiveAssignment(value: unknown): ActiveAssignmentLoadResult {
  if (value === undefined || value === null) return { kind: 'none' }
  if (!value || typeof value !== 'object') return { kind: 'invalid' }
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1 || !isReceivedPrintJob(candidate.job)) return { kind: 'invalid' }
  return { kind: 'valid', assignment: { version: 1, job: candidate.job } }
}
