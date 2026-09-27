import { randomBytes, timingSafeEqual } from 'node:crypto'

const results = {
  SET: false,
  GET: false,
  DELETE: false,
  MISSING: false
}

let entry = null

try {
  const { Entry } = await import('@napi-rs/keyring')
  entry = new Entry('NotiVenta Phase 4 Validation', 'temporary-keyring-smoke')
  const secret = randomBytes(32).toString('base64url')

  try {
    entry.setPassword(secret)
    results.SET = true
  } catch {}

  if (results.SET) {
    try {
      const restored = entry.getPassword()
      results.GET =
        typeof restored === 'string' &&
        timingSafeEqual(Buffer.from(restored), Buffer.from(secret))
    } catch {}
  }

  try {
    results.DELETE = entry.deletePassword()
  } catch {}

  try {
    results.MISSING = entry.getPassword() === null
  } catch {}
} catch {
  // Results remain FAIL. Native error details and secret material are not printed.
} finally {
  if (entry && !results.MISSING) {
    try {
      entry.deletePassword()
    } catch {}
  }
}

for (const name of ['SET', 'GET', 'DELETE', 'MISSING']) {
  console.log(`${name} ${results[name] ? 'PASS' : 'FAIL'}`)
}

if (Object.values(results).some((passed) => !passed)) process.exitCode = 1
