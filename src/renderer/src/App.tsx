import { FormEvent, useEffect, useState } from 'react'
import type { AgentState, PrinterConfigurationStatus, PrinterDiscoveryResult, PrinterReadiness } from '../../shared/contracts'

interface PrinterData {
  discovery: PrinterDiscoveryResult
  configuration: PrinterConfigurationStatus
  readiness: PrinterReadiness
}

export function App(): React.JSX.Element {
  const [state, setState] = useState<AgentState | null>(null)
  const [pairingCode, setPairingCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [startWithWindows, setStartWithWindows] = useState(true)
  const [printerData, setPrinterData] = useState<PrinterData | null>(null)
  const [printerLoading, setPrinterLoading] = useState(true)
  const [printerError, setPrinterError] = useState<string | null>(null)
  const [printerAction, setPrinterAction] = useState<string | null>(null)
  const [selectionDialogOpen, setSelectionDialogOpen] = useState(false)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [dialogDiscovery, setDialogDiscovery] = useState<PrinterDiscoveryResult | null>(null)
  const [dialogLoading, setDialogLoading] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [candidate, setCandidate] = useState<string | null>(null)

  useEffect(() => {
    void window.notiventa.getState().then(setState)
    void window.notiventa.getStartWithWindows().then(setStartWithWindows)
    void refreshPrinters()
    const refreshOnFocus = () => void refreshPrinters()
    window.addEventListener('focus', refreshOnFocus)
    const unsubscribe = window.notiventa.subscribeToState(setState)
    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      unsubscribe()
    }
  }, [])

  async function refreshPrinters(): Promise<void> {
    setPrinterLoading(true)
    setPrinterError(null)
    try {
      const [discovery, configuration, readiness] = await Promise.all([
        window.notiventa.listInstalledPrinters(),
        window.notiventa.getPrinterConfiguration(),
        window.notiventa.getPrinterReadiness()
      ])
      setPrinterData({ discovery, configuration, readiness })
    } catch {
      setPrinterError('Printer settings are unavailable right now. Try again.')
    } finally {
      setPrinterLoading(false)
    }
  }

  async function submitPairing(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const next = await window.notiventa.pairDevice({ pairingCode, displayName })
    setState(next)
  }

  async function changeStartup(enabled: boolean): Promise<void> {
    setStartWithWindows(await window.notiventa.setStartWithWindows(enabled))
  }

  async function selectPrinter(systemName: string): Promise<void> {
    setPrinterAction(systemName)
    setPrinterError(null)
    try {
      await window.notiventa.selectPrinter(systemName)
      await refreshPrinters()
      setSelectionDialogOpen(false)
    } catch {
      setPrinterError('NotiVenta could not select that printer. Confirm it is still visible and try again.')
    } finally {
      setPrinterAction(null)
    }
  }

  async function clearPrinter(): Promise<void> {
    setPrinterAction('clear')
    setPrinterError(null)
    try {
      await window.notiventa.clearPrinterConfiguration()
      await refreshPrinters()
      setClearDialogOpen(false)
    } catch {
      setPrinterError('NotiVenta could not clear the printer selection. Try again.')
    } finally {
      setPrinterAction(null)
    }
  }

  async function openPrinterSelection(): Promise<void> {
    setSelectionDialogOpen(true)
    setCandidate(null)
    await refreshDialogPrinters()
  }

  async function refreshDialogPrinters(): Promise<void> {
    setDialogLoading(true)
    setDialogError(null)
    try {
      setDialogDiscovery(await window.notiventa.listInstalledPrinters())
    } catch {
      setDialogError('Printers could not be loaded right now. Try again.')
    } finally {
      setDialogLoading(false)
    }
  }

  if (!state) return <main className="shell"><p>Starting NotiVenta…</p></main>

  if (state.lifecycle === 'needs-pairing') {
    return (
      <main className="shell">
        <header>
          <span className="eyebrow">NotiVenta Agent</span>
          <h1>Connect this computer</h1>
          <p>Enter the six-digit code shown in your NotiVenta dashboard.</p>
        </header>
        <form onSubmit={(event) => void submitPairing(event)}>
          <label>
            Pairing code
            <input
              autoFocus
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={pairingCode}
              onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, ''))}
              required
            />
          </label>
          <label>
            Computer name
            <input
              maxLength={255}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Packing Station"
              required
            />
          </label>
          <div className="detected">
            <span>Detected system name</span>
            <strong>{state.systemName}</strong>
          </div>
          {state.error && <p role="alert" className="error">{state.error}</p>}
          <button type="submit">Pair computer</button>
        </form>
      </main>
    )
  }

  const deviceState = state.backend?.systemBlocked
    ? 'System Blocked'
    : state.backend?.isPaused
      ? 'Paused'
      : 'Running'

  return (
    <main className="shell">
      <header>
        <span className="eyebrow">NotiVenta Agent</span>
        <h1>{state.device?.displayName ?? state.systemName}</h1>
      </header>
      <section className="status-grid">
        <Status label="NotiVenta" value={connectionLabel(state.lifecycle)} tone={state.lifecycle === 'connected' ? 'good' : 'warn'} />
        <Status label="Device" value={deviceState} tone={deviceState === 'Running' ? 'good' : 'warn'} />
        <Status label="Mercado Libre" value={state.backend?.mercadoLibreStatus ?? 'Unknown'} />
        <Status label="Queued jobs" value={String(state.backend?.queueCount ?? '—')} />
        <Status label="Agent version" value={state.device?.agentVersion ?? '—'} />
        <Status label="Compatibility" value={state.backend?.updateStatus ?? 'Unknown'} />
      </section>
      {state.error && <p role="status" className="notice">{state.error}</p>}
      <label className="toggle">
        <input
          type="checkbox"
          checked={startWithWindows}
          onChange={(event) => void changeStartup(event.target.checked)}
        />
        Start with Windows
      </label>
      <p className="hint">Closing this window keeps NotiVenta running in the tray.</p>
      <PrinterSettings
        data={printerData}
        loading={printerLoading}
        error={printerError}
        action={printerAction}
        onChoose={() => void openPrinterSelection()}
        onClear={() => setClearDialogOpen(true)}
      />
      {selectionDialogOpen && (
        <PrinterSelectionDialog
          discovery={dialogDiscovery}
          loading={dialogLoading}
          error={dialogError}
          selectedName={printerData?.configuration.configuration?.systemName ?? printerData?.readiness.configuration?.systemName ?? null}
          candidate={candidate}
          selecting={printerAction !== null}
          onCandidate={setCandidate}
          onRetry={() => void refreshDialogPrinters()}
          onClose={() => setSelectionDialogOpen(false)}
          onSelect={() => candidate && void selectPrinter(candidate)}
        />
      )}
      {clearDialogOpen && (
        <ClearPrinterDialog
          clearing={printerAction === 'clear'}
          onCancel={() => setClearDialogOpen(false)}
          onConfirm={() => void clearPrinter()}
        />
      )}
    </main>
  )
}

interface PrinterSettingsProps {
  data: PrinterData | null
  loading: boolean
  error: string | null
  action: string | null
  onChoose(): void
  onClear(): void
}

function PrinterSettings({ data, loading, error, action, onChoose, onClear }: PrinterSettingsProps): React.JSX.Element {
  if (loading && !data) {
    return <section className="printer-section" aria-labelledby="printer-heading"><h2 id="printer-heading">Printer</h2><p>Loading printer settings…</p></section>
  }

  if (!data) {
    return (
      <section className="printer-section" aria-labelledby="printer-heading">
        <h2 id="printer-heading">Printer</h2>
        <p role="alert" className="error">{error ?? 'Printer settings are unavailable right now.'}</p>
        <button type="button" onClick={onChoose}>Choose Printer</button>
      </section>
    )
  }

  const { readiness, configuration } = data
  const selectedName = configuration.configuration?.systemName ?? readiness.configuration?.systemName ?? null
  const discoveryUnavailable = configuration.error === 'PRINTER_DISCOVERY_UNAVAILABLE'
  const configurationInvalid = configuration.error === 'PRINTER_CONFIGURATION_INVALID' || readiness.reason === 'PRINTER_CONFIGURATION_INVALID'

  return (
    <section className="printer-section" aria-labelledby="printer-heading">
      <div className="section-heading"><h2 id="printer-heading">Printer</h2></div>
      <Status label="Status" value={readiness.state.replace('_', ' ')} tone={readiness.state === 'READY' ? 'good' : 'warn'} />
      <p className="printer-explanation">{readinessMessage(readiness.state, discoveryUnavailable)}</p>
      <div className="printer-details">
        <span>Selected printer</span>
        <strong>{selectedName ?? 'No printer selected'}</strong>
        <span>Label profile</span>
        <strong>4 × 6 in · Shipping Label</strong>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {configurationInvalid && <p role="alert" className="notice">The saved printer selection cannot be used. Select a visible printer to continue.</p>}
      {discoveryUnavailable && <p role="alert" className="notice">Available printers cannot be checked right now. Your selection has not been changed.</p>}
      <div className="printer-actions">
        <button type="button" className="secondary" onClick={onChoose} disabled={loading}>{selectedName ? 'Change Printer' : 'Choose Printer'}</button>
        {selectedName && <button type="button" className="secondary" onClick={onClear} disabled={action === 'clear'}>Clear</button>}
      </div>
    </section>
  )
}

interface PrinterSelectionDialogProps {
  discovery: PrinterDiscoveryResult | null
  loading: boolean
  error: string | null
  selectedName: string | null
  candidate: string | null
  selecting: boolean
  onCandidate(systemName: string): void
  onRetry(): void
  onClose(): void
  onSelect(): void
}

function PrinterSelectionDialog({ discovery, loading, error, selectedName, candidate, selecting, onCandidate, onRetry, onClose, onSelect }: PrinterSelectionDialogProps): React.JSX.Element {
  const selectedIsVisible = selectedName !== null && discovery?.printers.some((printer) => sameQueue(printer.systemName, selectedName))
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="change-printer-title">
        <div className="section-heading"><h2 id="change-printer-title">Change Printer</h2><button type="button" className="secondary" onClick={onClose} disabled={selecting}>Close</button></div>
        <p>Select an installed Windows printer.</p>
        {selectedName && !selectedIsVisible && <div className="missing-printer"><strong>Current printer</strong><span>⚠ {selectedName}</span><small>Not currently visible</small></div>}
        {loading && <p>Loading installed printers…</p>}
        {error && <><p role="alert" className="error">{error}</p><button type="button" className="secondary" onClick={onRetry}>Retry</button></>}
        {!loading && !error && discovery?.error === 'PRINTER_DISCOVERY_UNAVAILABLE' && <><p role="alert" className="error">Printers could not be loaded right now. Try again.</p><button type="button" className="secondary" onClick={onRetry}>Retry</button></>}
        {!loading && !error && discovery?.error === null && discovery.printers.length === 0 && <p>No installed printers were found.</p>}
        {!loading && !error && discovery && discovery.error === null && discovery.printers.length > 0 && (
          <div className="printer-list" role="radiogroup" aria-label="Installed printers">
            {discovery.printers.map((printer) => (
              <label className="printer-option" key={printer.systemName}>
                <input type="radio" name="candidate-printer" checked={candidate === printer.systemName} disabled={selecting} onChange={() => onCandidate(printer.systemName)} />
                <span>{printer.systemName}{sameQueue(printer.systemName, selectedName) ? ' (Currently selected)' : ''}{printer.isDefault ? ' (Default printer)' : ''}</span>
              </label>
            ))}
          </div>
        )}
        <div className="dialog-actions"><button type="button" className="secondary" onClick={onClose} disabled={selecting}>Cancel</button><button type="button" onClick={onSelect} disabled={!candidate || selecting}>{selecting ? 'Selecting…' : 'Select'}</button></div>
      </section>
    </div>
  )
}

function ClearPrinterDialog({ clearing, onCancel, onConfirm }: { clearing: boolean, onCancel(): void, onConfirm(): void }): React.JSX.Element {
  return <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="clear-printer-title"><h2 id="clear-printer-title">Clear selected printer?</h2><p>NotiVenta will stop considering this Agent printer-ready until another printer is selected.</p><div className="dialog-actions"><button type="button" className="secondary" onClick={onCancel} disabled={clearing}>Cancel</button><button type="button" onClick={onConfirm} disabled={clearing}>{clearing ? 'Clearing…' : 'Clear Printer'}</button></div></section></div>
}

function Status(props: { label: string; value: string; tone?: 'good' | 'warn' }): React.JSX.Element {
  return (
    <div className="status-row">
      <span>{props.label}</span>
      <strong className={props.tone}>{props.value}</strong>
    </div>
  )
}

function connectionLabel(lifecycle: AgentState['lifecycle']): string {
  if (lifecycle === 'connected') return 'Connected'
  if (lifecycle === 'connecting') return 'Connecting'
  return 'Disconnected'
}

function readinessMessage(state: PrinterReadiness['state'], discoveryUnavailable: boolean): string {
  if (state === 'READY') return 'Configured and visible to NotiVenta. This does not confirm printer health, supplies, spooler health, or a successful print.'
  if (state === 'UNAVAILABLE' && !discoveryUnavailable) return 'Configured printer is not currently visible. NotiVenta will keep this selection and will not switch printers automatically.'
  if (state === 'UNAVAILABLE') return 'NotiVenta cannot currently check whether the selected printer is visible. It will not switch printers automatically.'
  return 'Choose a printer before printing can be enabled.'
}

function sameQueue(left: string, right: string | null): boolean {
  return right !== null && left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
}
