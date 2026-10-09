import type { AgentResultExecutionMode, AgentResultType } from '../result-outbox'
import type { PrinterAdapter, PrinterRequest, PrinterResult } from '../printers/printer-adapter'

export interface ResultRecorder {
  (input: {
    jobId: string
    attemptId: string
    type: AgentResultType
    executionMode: AgentResultExecutionMode
    errorCode?: string | null
    errorMessage?: string | null
  }): boolean | Promise<boolean>
}

export class PrintCoordinator {
  private readonly executedAttempts = new Set<string>()

  constructor(
    private readonly adapter: PrinterAdapter,
    private readonly recordResult: ResultRecorder
  ) {}

  async execute(request: PrinterRequest): Promise<boolean> {
    const key = `${request.jobId}:${request.attemptId}`
    if (this.executedAttempts.has(key)) {
      console.info(`[print-coordinator] Existing execution retained for attempt ${request.attemptId}.`)
      return false
    }
    this.executedAttempts.add(key)

    let result: PrinterResult
    try {
      result = await this.adapter.print(request)
    } catch {
      // No physical boundary exists in PF3. Treat unexpected fake failures as
      // uncertain so the future physical path cannot learn an unsafe retry habit.
      result = { status: 'UNKNOWN', code: 'FAKE_PRINTER_EXCEPTION', message: 'Fake printer execution ended unexpectedly.' }
    }
    const event = toSimulatedResultEvent(request, result)
    const persisted = await this.recordResult(event)
    if (!persisted) {
      console.error(`[print-coordinator] Result for attempt ${request.attemptId} could not be persisted.`)
      return false
    }
    console.info(`[print-coordinator] Persisted simulated ${result.status} result for attempt ${request.attemptId}.`)
    return true
  }
}

function toSimulatedResultEvent(request: PrinterRequest, result: PrinterResult): Parameters<ResultRecorder>[0] {
  if (result.status === 'SUCCESS') {
    return {
      jobId: request.jobId,
      attemptId: request.attemptId,
      type: 'PRINTED_SUCCESSFULLY',
      executionMode: 'SIMULATED'
    }
  }
  return {
    jobId: request.jobId,
    attemptId: request.attemptId,
    type: result.status === 'FAILURE' ? 'PRINT_FAILED' : 'UNKNOWN',
    executionMode: 'SIMULATED',
    errorCode: result.code,
    errorMessage: result.message ?? null
  }
}
