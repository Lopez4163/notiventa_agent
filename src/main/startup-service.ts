export interface LoginItemApp {
  isPackaged: boolean
  setLoginItemSettings(settings: { openAtLogin: boolean }): void
}

export class StartupService {
  constructor(
    private readonly app: LoginItemApp,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  apply(enabled: boolean): void {
    if (!this.app.isPackaged || this.platform !== 'win32') return
    this.app.setLoginItemSettings({ openAtLogin: enabled })
  }
}
