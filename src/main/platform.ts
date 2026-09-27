import os from 'node:os'

export function platformIdentifier(nodePlatform: NodeJS.Platform = process.platform): string {
  if (nodePlatform === 'win32') return 'windows'
  if (nodePlatform === 'darwin') return 'macos'
  return nodePlatform
}

export function detectSystemName(): string {
  return os.hostname().trim()
}
