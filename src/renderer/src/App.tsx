import { FormEvent, useEffect, useState } from 'react'
import type { AgentState } from '../../shared/contracts'

export function App(): React.JSX.Element {
  const [state, setState] = useState<AgentState | null>(null)
  const [pairingCode, setPairingCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [startWithWindows, setStartWithWindows] = useState(true)

  useEffect(() => {
    void window.notiventa.getState().then(setState)
    void window.notiventa.getStartWithWindows().then(setStartWithWindows)
    return window.notiventa.subscribeToState(setState)
  }, [])

  async function submitPairing(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const next = await window.notiventa.pairDevice({ pairingCode, displayName })
    setState(next)
  }

  async function changeStartup(enabled: boolean): Promise<void> {
    setStartWithWindows(await window.notiventa.setStartWithWindows(enabled))
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
    </main>
  )
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
