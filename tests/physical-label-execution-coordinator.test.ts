import { describe, expect, it, vi } from 'vitest'
import { PhysicalLabelExecutionCoordinator } from '../src/main/printing/physical-label-execution-coordinator'
import type { ReceivedPrintJob } from '../src/shared/contracts'
import type { AgentController } from '../src/main/agent-controller'
import type { ShippingLabelPreparationService } from '../src/main/labels/shipping-label-preparation-service'
import type { PrinterReadinessService } from '../src/main/printers/printer-readiness-service'
import type { WindowsPrinterAdapter } from '../src/main/printers/windows-printer-adapter'
import { MemorySettingsStore } from './test-doubles'

const job: ReceivedPrintJob = {
  jobId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
  printType: 'SHIPPING_LABEL',
  shipmentId: '200000001',
  orderId: '300000001'
}

const ready = {
  state: 'READY', ready: true, reason: null,
  configuration: { systemName: 'WHTP203e Exact Queue', profile: { printType: 'SHIPPING_LABEL', width: 4, height: 6, unit: 'INCH' } },
  discoveredPrinter: null
}

describe('PhysicalLabelExecutionCoordinator', () => {
  it('acknowledges durable physical PRINTING before one Windows submission', async () => {
    const harness = createHarness()
    const result = await harness.coordinator.submitWithOperatorAuthorization()

    expect(result).toMatchObject({ status: 'AWAITING_CONFIRMATION' })
    expect(harness.controller.recordPrintResultAndAwaitAcknowledgement).toHaveBeenCalledWith(expect.objectContaining({
      jobId: job.jobId, attemptId: job.attemptId, type: 'PRINTING', executionMode: 'PHYSICAL'
    }))
    expect(harness.windowsPrinter.print).toHaveBeenCalledWith({
      documentPath: '/private/label.pdf', expectedPrinterSystemName: 'WHTP203e Exact Queue'
    })
    expect(harness.controller.recordPrintResultAndAwaitAcknowledgement.mock.invocationCallOrder[0])
      .toBeLessThan(harness.windowsPrinter.print.mock.invocationCallOrder[0])
  })

  it('does not submit to Windows when PRINTING acknowledgement is lost or pending', async () => {
    const harness = createHarness({ printingAcknowledged: false })

    await expect(harness.coordinator.submitWithOperatorAuthorization()).resolves.toMatchObject({
      status: 'BLOCKED', code: 'PRINTING_NOT_ACKNOWLEDGED'
    })
    expect(harness.windowsPrinter.print).not.toHaveBeenCalled()
    expect(harness.controller.recordPrintResult).not.toHaveBeenCalled()
  })

  it('prevents duplicate operator submissions while confirmation is required', async () => {
    const harness = createHarness()
    await harness.coordinator.submitWithOperatorAuthorization()
    await expect(harness.coordinator.submitWithOperatorAuthorization()).resolves.toMatchObject({
      status: 'AWAITING_CONFIRMATION'
    })
    expect(harness.windowsPrinter.print).toHaveBeenCalledOnce()
  })

  it('does not submit if the durable assignment changes before the print boundary', async () => {
    const harness = createHarness()
    harness.controller.recordPrintResultAndAwaitAcknowledgement.mockImplementation(async () => {
      harness.settings.activeAssignment = { version: 1, job: { ...job, shipmentId: '200000002' } }
      return true
    })

    await expect(harness.coordinator.submitWithOperatorAuthorization()).resolves.toMatchObject({
      status: 'RECORDED_FAILURE'
    })
    expect(harness.windowsPrinter.print).not.toHaveBeenCalled()
    expect(harness.controller.recordPrintResult).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PRINT_FAILED', executionMode: 'PHYSICAL', errorCode: 'ASSIGNMENT_CHANGED_BEFORE_SUBMISSION'
    }))
  })

  it('does not submit if printer readiness changes after PRINTING acknowledgement', async () => {
    const harness = createHarness({ readiness: [ready, { ...ready, state: 'UNAVAILABLE', ready: false }] })

    await expect(harness.coordinator.submitWithOperatorAuthorization()).resolves.toMatchObject({
      status: 'RECORDED_FAILURE'
    })
    expect(harness.windowsPrinter.print).not.toHaveBeenCalled()
    expect(harness.controller.recordPrintResult).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PRINT_FAILED', errorCode: 'PRINTER_NOT_READY_BEFORE_SUBMISSION'
    }))
  })

  it('persists an observed Windows rejection as physical failure without retrying', async () => {
    const harness = createHarness({ submission: {
      status: 'FAILED', code: 'WINDOWS_PRINT_REJECTED', message: 'Windows did not accept the print request.'
    } })

    await expect(harness.coordinator.submitWithOperatorAuthorization()).resolves.toMatchObject({ status: 'RECORDED_FAILURE' })
    expect(harness.controller.recordPrintResult).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PRINT_FAILED', executionMode: 'PHYSICAL', errorCode: 'WINDOWS_PRINT_REJECTED'
    }))
    expect(harness.windowsPrinter.print).toHaveBeenCalledOnce()
  })

  it('contains indeterminate Windows submission as durable UNKNOWN', async () => {
    const harness = createHarness({ submission: {
      status: 'INDETERMINATE', code: 'WINDOWS_PRINT_SUBMISSION_TIMEOUT',
      message: 'Windows did not confirm whether the print request was submitted. Do not retry automatically.'
    } })

    await expect(harness.coordinator.submitWithOperatorAuthorization()).resolves.toMatchObject({ status: 'RECORDED_UNKNOWN' })
    expect(harness.controller.recordPrintResult).toHaveBeenCalledWith(expect.objectContaining({
      type: 'UNKNOWN', executionMode: 'PHYSICAL', errorCode: 'WINDOWS_PRINT_SUBMISSION_TIMEOUT'
    }))
  })

  it('contains an exception after the Windows boundary as durable UNKNOWN', async () => {
    const harness = createHarness()
    harness.windowsPrinter.print.mockRejectedValue(new Error('unexpected Electron failure'))

    await expect(harness.coordinator.submitWithOperatorAuthorization()).resolves.toMatchObject({ status: 'RECORDED_UNKNOWN' })
    expect(harness.controller.recordPrintResult).toHaveBeenCalledWith(expect.objectContaining({
      type: 'UNKNOWN', executionMode: 'PHYSICAL', errorCode: 'WINDOWS_SUBMISSION_EXCEPTION'
    }))
  })

  it('records physical success only after explicit operator confirmation', async () => {
    const harness = createHarness()
    await harness.coordinator.submitWithOperatorAuthorization()
    expect(harness.controller.recordPrintResult).not.toHaveBeenCalled()

    expect(harness.coordinator.confirmPhysicalSuccess()).toMatchObject({ status: 'RECORDED_SUCCESS' })
    expect(harness.controller.recordPrintResult).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PRINTED_SUCCESSFULLY', executionMode: 'PHYSICAL'
    }))
  })

  it('records an operator-observed physical failure only after explicit confirmation action', async () => {
    const harness = createHarness()
    await harness.coordinator.submitWithOperatorAuthorization()

    expect(harness.coordinator.reportObservedFailure()).toMatchObject({ status: 'RECORDED_FAILURE' })
    expect(harness.controller.recordPrintResult).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PRINT_FAILED', executionMode: 'PHYSICAL', errorCode: 'OPERATOR_OBSERVED_PRINT_FAILURE'
    }))
  })

  it('retains the submitted state when a terminal operator result cannot be persisted', async () => {
    const harness = createHarness()
    await harness.coordinator.submitWithOperatorAuthorization()
    harness.controller.recordPrintResult.mockReturnValue(false)

    expect(harness.coordinator.confirmPhysicalSuccess()).toMatchObject({
      status: 'BLOCKED', code: 'TERMINAL_RESULT_NOT_PERSISTED'
    })
    expect(harness.coordinator.reportObservedFailure()).toMatchObject({
      status: 'BLOCKED', code: 'TERMINAL_RESULT_NOT_PERSISTED'
    })
    expect(harness.windowsPrinter.print).toHaveBeenCalledOnce()
  })

  it('does not replay a submission when a new coordinator is created after a crash', () => {
    const harness = createHarness()
    new PhysicalLabelExecutionCoordinator(
      harness.settings,
      harness.printerReadiness as unknown as PrinterReadinessService,
      harness.preparation as unknown as ShippingLabelPreparationService,
      harness.windowsPrinter as unknown as WindowsPrinterAdapter,
      harness.controller as unknown as AgentController
    )
    expect(harness.windowsPrinter.print).not.toHaveBeenCalled()
    expect(harness.preparation.withPreparedCurrentLabel).not.toHaveBeenCalled()
  })
})

function createHarness(options: {
  printingAcknowledged?: boolean
  readiness?: object[]
  submission?: object
} = {}) {
  const settings = new MemorySettingsStore()
  settings.activeAssignment = { version: 1, job }
  const printerReadiness = {
    getReadiness: vi.fn()
  }
  for (const result of options.readiness ?? [ready, ready]) {
    printerReadiness.getReadiness.mockResolvedValueOnce(result)
  }
  printerReadiness.getReadiness.mockResolvedValue(ready)
  const preparation = {
    withPreparedCurrentLabel: vi.fn(async (consumer) => consumer({
      jobId: job.jobId, attemptId: job.attemptId, shipmentId: job.shipmentId, orderId: job.orderId,
      documentPath: '/private/label.pdf', pageCount: 1,
      geometry: { widthInches: 4, heightInches: 6, orientation: 'PORTRAIT', sourceRotationDegrees: 0, scale: 1 }
    }))
  }
  const windowsPrinter = {
    print: vi.fn().mockResolvedValue(options.submission ?? {
      status: 'SUBMITTED', code: 'SUBMITTED_TO_WINDOWS',
      message: 'Submitted to Windows. Verify that the label printed correctly.'
    })
  }
  const controller = {
    recordPrintResultAndAwaitAcknowledgement: vi.fn().mockResolvedValue(options.printingAcknowledged ?? true),
    recordPrintResult: vi.fn().mockReturnValue(true)
  }
  const coordinator = new PhysicalLabelExecutionCoordinator(
    settings,
    printerReadiness as unknown as PrinterReadinessService,
    preparation as unknown as ShippingLabelPreparationService,
    windowsPrinter as unknown as WindowsPrinterAdapter,
    controller as unknown as AgentController
  )
  return { coordinator, settings, printerReadiness, preparation, windowsPrinter, controller }
}
