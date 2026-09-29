import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  version: string
  scripts: Record<string, string>
  devDependencies: Record<string, string>
}
const builderConfig = readFileSync(resolve('electron-builder.staging.yml'), 'utf8')
const packagingScript = readFileSync(resolve('scripts/package-windows-staging.mjs'), 'utf8')
const mainSource = readFileSync(resolve('src/main/index.ts'), 'utf8')

describe('Windows staging packaging foundation', () => {
  it('uses electron-builder and explicit x64 and ARM64 scripts without IA32', () => {
    expect(packageJson.devDependencies['electron-builder']).toBe('26.15.6')
    expect(packageJson.scripts['package:staging:win:x64']).toContain('x64')
    expect(packageJson.scripts['package:staging:win:arm64']).toContain('arm64')
    expect(builderConfig).toContain('- x64')
    expect(builderConfig).toContain('- arm64')
    expect(builderConfig).not.toMatch(/ia32/i)
  })

  it('defines a clearly identified NSIS staging application and architecture-specific artifact', () => {
    expect(builderConfig).toContain('appId: com.notiventa.agent.staging')
    expect(builderConfig).toContain('productName: NotiVenta Agent Staging')
    expect(builderConfig).toContain('target: nsis')
    expect(builderConfig).toContain('NotiVenta-Staging-Setup-${version}-${arch}.${ext}')
    expect(builderConfig).toContain('output: dist/staging')
  })

  it('keeps ASAR enabled and narrowly unpacks keyring native binaries', () => {
    expect(builderConfig).toContain('asar: true')
    expect(builderConfig).toContain('node_modules/@napi-rs/keyring*/**/*.node')
    expect(builderConfig).not.toContain('asar: false')
  })

  it('requires an HTTPS staging URL and compiles staging identity without secrets', () => {
    expect(packagingScript).toContain('NOTIVENTA_AGENT_STAGING_BACKEND_URL')
    expect(packagingScript).toContain("NOTIVENTA_AGENT_PACKAGE_ENV: 'staging'")
    expect(packagingScript).toContain("backendUrl.protocol !== 'https:'")
    expect(packagingScript).toContain('process.arch !== architecture')
    expect(packagingScript).toContain('keyring-win32-${architecture}-msvc')
    expect(packagingScript).toContain('existsSync(keyringBinary)')
    expect(packagingScript).not.toMatch(/TOKEN|PASSWORD|SECRET|API_KEY/)
    expect(packagingScript).not.toContain("NOTIVENTA_AGENT_PACKAGE_ENV: 'production'")
    expect(builderConfig).not.toMatch(/production/i)
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(mainSource).toContain('version: app.getVersion()')
  })

  it('runs Windows command shims through cmd.exe without constructing a shell string', () => {
    expect(packagingScript).toContain("spawnSync('cmd.exe', ['/d', '/s', '/c', command, ...args]")
    expect(packagingScript).not.toContain('spawnSync(command, args')
    expect(packagingScript).not.toContain('shell: true')
  })
})
