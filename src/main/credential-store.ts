import { Entry } from '@napi-rs/keyring'

export interface CredentialStore {
  get(): Promise<string | null>
  set(credential: string): Promise<void>
  clear(): Promise<void>
}

export class WindowsCredentialStore implements CredentialStore {
  private readonly entry: Entry

  constructor(service = 'NotiVenta', account = 'deviceCredential') {
    this.entry = new Entry(service, account)
  }

  async get(): Promise<string | null> {
    return this.entry.getPassword()
  }

  async set(credential: string): Promise<void> {
    this.entry.setPassword(credential)
  }

  async clear(): Promise<void> {
    this.entry.deletePassword()
  }
}
