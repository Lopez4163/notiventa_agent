// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/renderer/src/App'
import type { AgentRendererApi, AgentState, DiagnosticPrintResult, PrinterConfigurationStatus, PrinterDiscoveryResult, PrinterReadiness } from '../src/shared/contracts'

afterEach(cleanup)
const unpaired: AgentState = { lifecycle: 'needs-pairing', systemName: 'DESKTOP-ABC123', device: null, backend: null, receivedJob: null, error: null }
const label = { systemName: 'WHTP203e', displayName: 'WHTP203e', description: null, isDefault: false, available: true }
const pdf = { systemName: 'Microsoft Print to PDF', displayName: 'Microsoft Print to PDF', description: null, isDefault: true, available: true }
const copy = { systemName: 'LabelPrinter Copy', displayName: 'LabelPrinter Copy', description: null, isDefault: false, available: true }
const discovery: PrinterDiscoveryResult = { printers: [label], error: null }
const none: PrinterConfigurationStatus = { configured: false, configuration: null, available: false, discoveredPrinter: null, error: null }
const config: PrinterConfigurationStatus = { configured: true, configuration: { systemName: 'WHTP203e', profile: { printType: 'SHIPPING_LABEL', width: 4, height: 6, unit: 'INCH' } }, available: true, discoveredPrinter: label, error: null }
const unavailableConfig: PrinterConfigurationStatus = { ...config, available: false, discoveredPrinter: null }
const notConfigured: PrinterReadiness = { state: 'NOT_CONFIGURED', ready: false, reason: 'NO_PRINTER_CONFIGURATION', configuration: null, discoveredPrinter: null }
const ready: PrinterReadiness = { state: 'READY', ready: true, reason: null, configuration: config.configuration, discoveredPrinter: label }
const unavailable: PrinterReadiness = { state: 'UNAVAILABLE', ready: false, reason: 'CONFIGURED_PRINTER_UNAVAILABLE', configuration: config.configuration, discoveredPrinter: null }

describe('Agent UI', () => {
  it('shows NOT CONFIGURED, correct wording, fixed profile, and Choose Printer', async () => {
    install({ getState: connected() }); render(<App />)
    expect(await screen.findByText('NOT CONFIGURED')).toBeInTheDocument()
    expect(screen.getByText('Choose a printer before printing can be enabled.')).toBeInTheDocument()
    expect(screen.getByText('4 × 6 in · Shipping Label')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose Printer' })).toBeInTheDocument()
  })
  it('shows a loading state before printer state is known', async () => {
    let resolve: ((value: PrinterDiscoveryResult) => void) | undefined
    install({ getState: connected(), listInstalledPrinters: vi.fn().mockReturnValue(new Promise<PrinterDiscoveryResult>((done) => { resolve = done })) }); render(<App />)
    expect(await screen.findByText('Loading printer settings…')).toBeInTheDocument(); expect(screen.queryByText('NOT CONFIGURED')).not.toBeInTheDocument()
    resolve?.(discovery); expect(await screen.findByText('NOT CONFIGURED')).toBeInTheDocument()
  })
  it('keeps Agent connection separate and shows READY configuration', async () => {
    install({ getState: connected(), getPrinterConfiguration: vi.fn().mockResolvedValue(config), getPrinterReadiness: vi.fn().mockResolvedValue(ready) }); render(<App />)
    expect(await screen.findByText('Connected')).toBeInTheDocument(); expect(screen.getByText('READY')).toBeInTheDocument()
    expect(screen.getByText('Configured and visible to NotiVenta. This does not confirm printer health, supplies, spooler health, or a successful print.')).toBeInTheDocument(); expect(screen.getByText('WHTP203e')).toBeInTheDocument()
  })
  it('retains an unavailable configured queue without fallback', async () => {
    install({ getState: connected(), getPrinterConfiguration: vi.fn().mockResolvedValue(unavailableConfig), getPrinterReadiness: vi.fn().mockResolvedValue(unavailable) }); render(<App />)
    expect(await screen.findByText('UNAVAILABLE')).toBeInTheDocument(); expect(screen.getByText('Configured printer is not currently visible. NotiVenta will keep this selection and will not switch printers automatically.')).toBeInTheDocument(); expect(screen.getByText('WHTP203e')).toBeInTheDocument()
  })
  it('opens Change Printer, refreshes queues, and marks current selection without mutation', async () => {
    const selectPrinter = vi.fn(); const listInstalledPrinters = vi.fn().mockResolvedValue({ printers: [label, pdf], error: null })
    install({ getState: connected(), listInstalledPrinters, getPrinterConfiguration: vi.fn().mockResolvedValue(config), getPrinterReadiness: vi.fn().mockResolvedValue(ready), selectPrinter }); render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Change Printer' }))
    expect(await screen.findByRole('dialog', { name: 'Change Printer' })).toBeInTheDocument(); expect(screen.getByText('WHTP203e (Currently selected)')).toBeInTheDocument(); expect(screen.getByText('Microsoft Print to PDF (Default printer)')).toBeInTheDocument(); expect(selectPrinter).not.toHaveBeenCalled(); expect(listInstalledPrinters).toHaveBeenCalledTimes(2)
  })
  it('keeps candidate selection temporary and selects its exact identity only after Select', async () => {
    const selectPrinter = vi.fn().mockResolvedValue(config)
    install({ getState: connected(), listInstalledPrinters: vi.fn().mockResolvedValue({ printers: [label, copy], error: null }), selectPrinter }); render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Printer' })); fireEvent.click(await screen.findByRole('radio', { name: 'LabelPrinter Copy' })); expect(selectPrinter).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Select' })); await vi.waitFor(() => expect(selectPrinter).toHaveBeenCalledWith('LabelPrinter Copy'))
  })
  it('shows a missing current printer separately from replacements', async () => {
    install({ getState: connected(), listInstalledPrinters: vi.fn().mockResolvedValue({ printers: [pdf], error: null }), getPrinterConfiguration: vi.fn().mockResolvedValue(unavailableConfig), getPrinterReadiness: vi.fn().mockResolvedValue(unavailable) }); render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Change Printer' })); expect(await screen.findByText('Current printer')).toBeInTheDocument(); expect(screen.getByText('⚠ WHTP203e')).toBeInTheDocument(); expect(screen.getByRole('radio', { name: 'Microsoft Print to PDF (Default printer)' })).toBeInTheDocument()
  })
  it('handles empty and failing discovery safely', async () => {
    const listInstalledPrinters = vi.fn().mockResolvedValueOnce(discovery).mockResolvedValueOnce({ printers: [], error: null }).mockRejectedValueOnce(new Error('native details'))
    install({ getState: connected(), listInstalledPrinters }); render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Printer' })); expect(await screen.findByText('No installed printers were found.')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Close' })); fireEvent.click(screen.getByRole('button', { name: 'Choose Printer' })); expect(await screen.findByRole('alert')).toHaveTextContent('Printers could not be loaded right now. Try again.'); expect(screen.queryByText('native details')).not.toBeInTheDocument()
  })
  it('requires clear confirmation; cancel does nothing and confirmation refreshes state', async () => {
    const clearPrinterConfiguration = vi.fn().mockResolvedValue(none); const readiness = vi.fn().mockResolvedValueOnce(ready).mockResolvedValue(notConfigured)
    install({ getState: connected(), clearPrinterConfiguration, getPrinterConfiguration: vi.fn().mockResolvedValueOnce(config).mockResolvedValue(none), getPrinterReadiness: readiness }); render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' })); expect(await screen.findByRole('dialog', { name: 'Clear selected printer?' })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(clearPrinterConfiguration).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Clear' })); fireEvent.click(screen.getByRole('button', { name: 'Clear Printer' })); await vi.waitFor(() => expect(clearPrinterConfiguration).toHaveBeenCalledTimes(1)); expect(await screen.findByText('NOT CONFIGURED')).toBeInTheDocument()
  })
  it('enables test printing only when printer readiness is READY', async () => {
    const printTestLabel = vi.fn()
    install({ getState: connected(), printTestLabel }); render(<App />)
    expect(await screen.findByRole('button', { name: 'Print Test Label' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Print Test Label' }))
    expect(printTestLabel).not.toHaveBeenCalled()
  })
  it('shows submission wording that requires physical verification', async () => {
    const printTestLabel = vi.fn().mockResolvedValue({
      status: 'SUBMITTED', code: 'SUBMITTED_TO_WINDOWS',
      message: 'Submitted to Windows. Verify that the label printed correctly.'
    } satisfies DiagnosticPrintResult)
    install({
      getState: connected(),
      getPrinterConfiguration: vi.fn().mockResolvedValue(config),
      getPrinterReadiness: vi.fn().mockResolvedValue(ready),
      printTestLabel
    }); render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Print Test Label' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Submitted to Windows — verify the physical label.')
    expect(screen.queryByText(/printed successfully/i)).not.toBeInTheDocument()
  })
  it('shows safe failed and indeterminate outcomes', async () => {
    const printTestLabel = vi.fn()
      .mockResolvedValueOnce({
        status: 'FAILED', code: 'PRINTER_NOT_READY',
        message: 'The selected printer is not currently ready in NotiVenta.'
      } satisfies DiagnosticPrintResult)
      .mockResolvedValueOnce({
        status: 'INDETERMINATE', code: 'WINDOWS_PRINT_SUBMISSION_TIMEOUT',
        message: 'Windows did not confirm whether the print request was submitted. Do not retry automatically.'
      } satisfies DiagnosticPrintResult)
    install({
      getState: connected(),
      getPrinterConfiguration: vi.fn().mockResolvedValue(config),
      getPrinterReadiness: vi.fn().mockResolvedValue(ready),
      printTestLabel
    }); render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Print Test Label' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The selected printer is not currently ready in NotiVenta.')
    fireEvent.click(screen.getByRole('button', { name: 'Print Test Label' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Submission uncertain — do not retry without checking the printer.')
  })
  it('blocks repeated clicks while a test label submission is pending', async () => {
    let finish: ((result: DiagnosticPrintResult) => void) | undefined
    const printTestLabel = vi.fn().mockReturnValue(new Promise<DiagnosticPrintResult>((resolve) => { finish = resolve }))
    install({
      getState: connected(),
      getPrinterConfiguration: vi.fn().mockResolvedValue(config),
      getPrinterReadiness: vi.fn().mockResolvedValue(ready),
      printTestLabel
    }); render(<App />)
    const button = await screen.findByRole('button', { name: 'Print Test Label' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(printTestLabel).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Submitting Test Label…' })).toBeDisabled()
    finish?.({
      status: 'SUBMITTED', code: 'SUBMITTED_TO_WINDOWS',
      message: 'Submitted to Windows. Verify that the label printed correctly.'
    })
    expect(await screen.findByRole('button', { name: 'Print Test Label' })).toBeEnabled()
  })
  it('never invokes a print boundary', async () => {
    const printTestLabel = vi.fn(); install({ getState: connected(), printTestLabel }); render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Printer' })); fireEvent.click(await screen.findByRole('radio', { name: 'WHTP203e' })); fireEvent.click(screen.getByRole('button', { name: 'Select' })); await vi.waitFor(() => expect(window.notiventa.selectPrinter).toHaveBeenCalledWith('WHTP203e')); expect(printTestLabel).not.toHaveBeenCalled()
  })
})
function connected(): ReturnType<typeof vi.fn> { return vi.fn().mockResolvedValue({ ...unpaired, lifecycle: 'connected', device: { id: '1', systemName: 'DESKTOP-ABC123', displayName: 'Packing Station', platform: 'windows', agentVersion: '1.0.0' }, backend: { isPaused: false, systemBlocked: false, mercadoLibreStatus: 'CONNECTED', queueCount: 0, updateStatus: 'CURRENT' } }) }
function install(overrides: Partial<AgentRendererApi>, forbidden: Record<string, unknown> = {}): void {
  const api: AgentRendererApi = { getState: vi.fn().mockResolvedValue(unpaired), pairDevice: vi.fn(), subscribeToState: vi.fn().mockReturnValue(() => undefined), getStartWithWindows: vi.fn().mockResolvedValue(true), setStartWithWindows: vi.fn(), listInstalledPrinters: vi.fn().mockResolvedValue(discovery), getPrinterConfiguration: vi.fn().mockResolvedValue(none), getPrinterReadiness: vi.fn().mockResolvedValue(notConfigured), selectPrinter: vi.fn().mockResolvedValue(none), clearPrinterConfiguration: vi.fn().mockResolvedValue(none), printTestLabel: vi.fn(), ...overrides }
  Object.defineProperty(window, 'notiventa', { configurable: true, value: { ...api, ...forbidden } })
}
