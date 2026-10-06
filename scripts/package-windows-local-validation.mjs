import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const architecture = process.argv[2]
const localValidationBackendUrl = 'http://192.168.64.1:8000'

if (architecture !== 'arm64') {
  fail('The local Windows VM validation package supports ARM64 only.')
}
if (process.platform !== 'win32') {
  fail('Local Windows VM validation packages must be built from Windows.')
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

const buildEnvironment = {
  ...process.env,
  NOTIVENTA_AGENT_PACKAGE_ENV: 'local-validation',
  NOTIVENTA_AGENT_PACKAGE_BACKEND_URL: localValidationBackendUrl
}

run('npm.cmd', ['run', 'build'], buildEnvironment)
run(
  resolve('node_modules', '.bin', 'electron-builder.cmd'),
  ['--config', 'electron-builder.local-validation.yml', '--win', 'nsis', '--arm64'],
  buildEnvironment
)

function run(command, args, env) {
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', command, ...args], {
    env,
    stdio: 'inherit'
  })
  if (result.error) fail(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
