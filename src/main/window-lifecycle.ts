export interface HideableWindow {
  hide(): void
  show(): void
  focus(): void
}

export function handleWindowClose(
  event: { preventDefault(): void },
  window: HideableWindow,
  quitting: boolean
): void {
  if (quitting) return
  event.preventDefault()
  window.hide()
}

export function reopenWindow(window: HideableWindow): void {
  window.show()
  window.focus()
}
