import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const supportedArchitectures = new Set(['x64', 'arm64'])
const architecture = process.argv[2]

if (!supportedArchitectures.has(architecture)) {
  fail('Choose exactly one supported Windows architecture: x64 or arm64.')
}
if (process.platform !== 'win32') {
  fail('Official Windows staging packages must be built from Windows.')
}
if (process.arch !== architecture) {
  fail(
    `The ${architecture} package requires ${architecture} Node/npm dependencies from a clean Windows install. Current Node architecture: ${process.arch}.`
  )
}

const keyringPackageName = `keyring-win32-${architecture}-msvc`
const keyringBinary = resolve(
  'node_modules',
  '@napi-rs',
  keyringPackageName,
  `keyring.win32-${architecture}-msvc.node`
)
if (!existsSync(keyringBinary)) {
  fail(
    `Missing @napi-rs/${keyringPackageName}. Run npm ci from matching Windows/Node ${architecture} before packaging.`
  )
}

const rawBackendUrl = process.env.NOTIVENTA_AGENT_STAGING_BACKEND_URL?.trim()
if (!rawBackendUrl) {
  fail('NOTIVENTA_AGENT_STAGING_BACKEND_URL is required for a staging package.')
}

let backendUrl
try {
  backendUrl = new URL(rawBackendUrl)
} catch {
  fail('NOTIVENTA_AGENT_STAGING_BACKEND_URL must be a valid URL.')
}

if (
  backendUrl.protocol !== 'https:' ||
  backendUrl.username ||
  backendUrl.password ||
  backendUrl.search ||
  backendUrl.hash ||
  ['localhost', '127.0.0.1', '::1'].includes(backendUrl.hostname)
) {
  fail('The staging backend URL must be a credential-free, non-local HTTPS origin.')
}

const buildEnvironment = {
  ...process.env,
  NOTIVENTA_AGENT_PACKAGE_ENV: 'staging',
  NOTIVENTA_AGENT_PACKAGE_BACKEND_URL: backendUrl.origin
}

run('npm.cmd', ['run', 'build'], buildEnvironment)
run(
  resolve('node_modules', '.bin', 'electron-builder.cmd'),
  ['--config', 'electron-builder.staging.yml', '--win', 'nsis', `--${architecture}`],
  buildEnvironment
)

function run(command, args, env) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' })
  if (result.error) fail(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
