import type { ReceivedPrintJob, ShippingLabelPrintResult } from '../../shared/contracts'
import type { AgentController } from '../agent-controller'
import type { ShippingLabelPreparationService } from '../labels/shipping-label-preparation-service'
import type { PrinterReadinessService } from '../printers/printer-readiness-service'
import type { WindowsPrinterAdapter } from '../printers/windows-printer-adapter'
import type { SettingsStore } from '../settings-store'

export type PhysicalLabelExecutionResult = ShippingLabelPrintResult

interface SubmissionAwaitingConfirmation {
  job: ReceivedPrintJob
}

/**
 * The sole real-label print path. It is invoked only by a narrow, explicit
 * operator action; it never runs from polling, startup, or outbox recovery.
 */
export class PhysicalLabelExecutionCoordinator {
  private executionInProgress = false
  private submitted: SubmissionAwaitingConfirmation | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly printerReadiness: PrinterReadinessService,
    private readonly preparation: ShippingLabelPreparationService,
    private readonly windowsPrinter: WindowsPrinterAdapter,
    private readonly controller: AgentController
  ) {}

  async submitWithOperatorAuthorization(): Promise<PhysicalLabelExecutionResult> {
    if (this.executionInProgress) return blocked('PRINT_IN_PROGRESS', 'A shipping-label print action is already in progress.')
    if (this.submitted) {
      return {
        status: 'AWAITING_CONFIRMATION',
        message: 'Submitted to Windows. Confirm the physical shipping label before continuing.'
      }
    }

    const job = this.currentReceivedAssignment()
    if (!job) return blocked('NO_RECEIVED_ASSIGNMENT', 'No received shipping-label assignment is available.')
    const authorizedPrinterSystemName = await this.readyPrinterSystemName()
    if (!authorizedPrinterSystemName) return blocked('PRINTER_NOT_READY', 'The selected printer is not currently ready in NotiVenta.')

    this.executionInProgress = true
    let submissionMayHaveOccurred = false
    try {
      return await this.preparation.withPreparedCurrentLabel(async (prepared) => {
        if (!sameJob(this.currentReceivedAssignment(), job) || prepared.attemptId !== job.attemptId || prepared.shipmentId !== job.shipmentId) {
          return blocked('ASSIGNMENT_CHANGED', 'The current shipping-label assignment changed before submission.')
        }

        const printingAcknowledged = await this.controller.recordPrintResultAndAwaitAcknowledgement({
          jobId: job.jobId,
          attemptId: job.attemptId,
          type: 'PRINTING',
          executionMode: 'PHYSICAL'
        })
        if (!printingAcknowledged) {
          return blocked(
            'PRINTING_NOT_ACKNOWLEDGED',
            'NotiVenta could not confirm printing with the server. The label was not submitted to Windows.'
          )
        }

        // Do not rely only on the download-time validation. The assignment and
        // printer must still be exact immediately before the print boundary.
        if (!sameJob(this.currentReceivedAssignment(), job)) {
          return await this.recordKnownFailure(job, 'ASSIGNMENT_CHANGED_BEFORE_SUBMISSION', 'The assignment changed before Windows submission.')
        }
        const currentPrinterSystemName = await this.readyPrinterSystemName()
        if (!currentPrinterSystemName || currentPrinterSystemName !== authorizedPrinterSystemName) {
          return await this.recordKnownFailure(job, 'PRINTER_NOT_READY_BEFORE_SUBMISSION', 'The selected printer was not ready before Windows submission.')
        }

        // Treat an exception after this point as ambiguous: Electron may have
        // crossed the spooler boundary even if it did not return a result.
        submissionMayHaveOccurred = true
        const submission = await this.windowsPrinter.print({
          documentPath: prepared.documentPath,
          expectedPrinterSystemName: authorizedPrinterSystemName
        })
        if (submission.status === 'SUBMITTED') {
          this.submitted = { job }
          return {
            status: 'AWAITING_CONFIRMATION',
            message: 'Submitted to Windows. Confirm the physical shipping label before continuing.'
          }
        }
        if (submission.status === 'INDETERMINATE') {
          return await this.recordUnknown(job, submission.code, submission.message)
        }
        return await this.recordKnownFailure(job, submission.code, submission.message)
      })
    } catch {
      if (submissionMayHaveOccurred) {
        return this.recordUnknown(
          job,
          'WINDOWS_SUBMISSION_EXCEPTION',
          'Windows did not confirm the physical submission outcome. Do not print again.'
        )
      }
      // Preparation/download failures happen before Windows submission and
      // intentionally leave the existing RECEIVED assignment unchanged.
      return blocked('PRINTING_NOT_ACKNOWLEDGED', 'The shipping label could not be prepared safely. It was not submitted to Windows.')
    } finally {
      this.executionInProgress = false
    }
  }

  confirmPhysicalSuccess(): PhysicalLabelExecutionResult {
    const submitted = this.submitted
    if (!submitted) return blocked('NO_SUBMISSION_AWAITING_CONFIRMATION', 'There is no submitted shipping label awaiting confirmation.')
    const persisted = this.controller.recordPrintResult({
      jobId: submitted.job.jobId,
      attemptId: submitted.job.attemptId,
      type: 'PRINTED_SUCCESSFULLY',
      executionMode: 'PHYSICAL'
    })
    if (!persisted) return blocked('TERMINAL_RESULT_NOT_PERSISTED', 'The physical outcome could not be saved safely. Do not print again.')
    this.submitted = null
    return { status: 'RECORDED_SUCCESS', message: 'Physical success was saved and will be delivered to NotiVenta.' }
  }

  reportObservedFailure(): PhysicalLabelExecutionResult {
    const submitted = this.submitted
    if (!submitted) return blocked('NO_SUBMISSION_AWAITING_CONFIRMATION', 'There is no submitted shipping label awaiting confirmation.')
    const result = this.recordTerminalWithoutAwaiting(
      submitted.job,
      'PRINT_FAILED',
      'OPERATOR_OBSERVED_PRINT_FAILURE',
      'The observed print failure was saved and will be delivered to NotiVenta.'
    )
    if (result.status !== 'BLOCKED') this.submitted = null
    return result
  }

  private recordKnownFailure(
    job: ReceivedPrintJob,
    code: string,
    message: string
  ): PhysicalLabelExecutionResult {
    return this.recordTerminalWithoutAwaiting(job, 'PRINT_FAILED', code, message)
  }

  private recordUnknown(
    job: ReceivedPrintJob,
    code: string,
    message: string
  ): PhysicalLabelExecutionResult {
    return this.recordTerminalWithoutAwaiting(job, 'UNKNOWN', code, message, true)
  }

  private recordTerminalWithoutAwaiting(
    job: ReceivedPrintJob,
    type: 'PRINT_FAILED' | 'UNKNOWN',
    code: string,
    message: string,
    unknown = false
  ): PhysicalLabelExecutionResult {
    const persisted = this.controller.recordPrintResult({
      jobId: job.jobId,
      attemptId: job.attemptId,
      type,
      executionMode: 'PHYSICAL',
      errorCode: code,
      errorMessage: message
    })
    if (!persisted) {
      return blocked('TERMINAL_RESULT_NOT_PERSISTED', 'The physical outcome could not be saved safely. Do not print again.')
    }
    return unknown
      ? { status: 'RECORDED_UNKNOWN', message: 'The print outcome is uncertain and has been saved for NotiVenta.' }
      : { status: 'RECORDED_FAILURE', message }
  }

  private currentReceivedAssignment(): ReceivedPrintJob | null {
    const active = this.settings.getActiveAssignment()
    return active.kind === 'valid' ? active.assignment.job : null
  }

  private async readyPrinterSystemName(): Promise<string | null> {
    try {
      const readiness = await this.printerReadiness.getReadiness()
      const systemName = readiness.configuration?.systemName
      return readiness.ready === true && readiness.state === 'READY' && typeof systemName === 'string' && systemName.length > 0
        ? systemName
        : null
    } catch {
      return null
    }
  }
}

function sameJob(left: ReceivedPrintJob | null, right: ReceivedPrintJob): boolean {
  return left !== null &&
    left.jobId === right.jobId &&
    left.attemptId === right.attemptId &&
    left.printType === right.printType &&
    left.shipmentId === right.shipmentId &&
    left.orderId === right.orderId
}

function blocked(
  code: string,
  message: string
): PhysicalLabelExecutionResult {
  return { status: 'BLOCKED', code, message }
}
