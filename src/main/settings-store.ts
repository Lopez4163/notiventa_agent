import Store from 'electron-store'
import type { SafeDeviceMetadata } from '../shared/contracts'

export interface LocalSettings {
  startWithWindows: boolean
  deviceMetadata?: SafeDeviceMetadata
}

export interface SettingsStore {
  getStartWithWindows(): boolean
  setStartWithWindows(enabled: boolean): void
  getDeviceMetadata(): SafeDeviceMetadata | null
  setDeviceMetadata(metadata: SafeDeviceMetadata): void
  clearDeviceMetadata(): void
}

export class ElectronSettingsStore implements SettingsStore {
  private readonly store = new Store<LocalSettings>({
    name: 'settings',
    defaults: { startWithWindows: true }
  })

  getStartWithWindows(): boolean {
    return this.store.get('startWithWindows')
  }

  setStartWithWindows(enabled: boolean): void {
    this.store.set('startWithWindows', enabled)
  }

  getDeviceMetadata(): SafeDeviceMetadata | null {
    return this.store.get('deviceMetadata') ?? null
  }

  setDeviceMetadata(metadata: SafeDeviceMetadata): void {
    this.store.set('deviceMetadata', metadata)
  }

  clearDeviceMetadata(): void {
    this.store.delete('deviceMetadata')
  }
}
