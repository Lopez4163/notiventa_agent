# NotiVenta Agent

Windows-first Electron foundation that pairs a computer with NotiVenta and keeps
its backend-authoritative operational state synchronized. This is a standalone
application and repository; it is not part of the backend or web frontend.

The NotiVenta Agent is installed on the seller's Windows computer. It is never a
Railway service. A Railway background service needed for Mercado Libre webhook
processing is the **Celery worker**, built from the `notiventa_be` backend
repository; it is not this Electron Agent.

## Setup

Requirements: a current Node.js release with npm and a reachable NotiVenta V2
development backend.

```bash
cp .env.example .env
npm install
npm run dev
```

Set `NOTIVENTA_AGENT_BACKEND_URL` to the development, staging, or production
backend that matches the build. `NOTIVENTA_AGENT_ENV` accepts `development`,
`staging`, or `production`. Only local development may use HTTP. End users do
not choose an environment in the UI.

For an unpackaged Windows VM development session that reaches a private or
link-local Mac-host backend, explicitly opt in for that PowerShell session:

```powershell
$env:NOTIVENTA_AGENT_ENV = "development"
$env:NOTIVENTA_AGENT_BACKEND_URL = "http://<MAC_VM_HOST>:8000"
$env:NOTIVENTA_AGENT_ALLOW_INSECURE_LOCAL_NETWORK = "true"
npm.cmd run dev
```

The installed staging/production `.exe` cannot use these variables: its HTTPS
backend destination is embedded at package time. If PowerShell blocks
`npm.ps1`, use `npm.cmd`; it changes no execution policy.

Useful commands:

```bash
npm run dev
npm test
npm run typecheck
npm run build
```

## Windows staging packaging

Phase 5 packaging uses electron-builder and an NSIS `.exe` installer. Official
artifacts must be created on Windows with Node/npm matching the requested
architecture. Set the non-secret staging backend URL in the current PowerShell
session, then build one architecture:

```powershell
$env:NOTIVENTA_AGENT_STAGING_BACKEND_URL = "https://<STAGING_BACKEND_URL>"
npm ci
npm run package:staging:win:x64
# or, with Windows/Node ARM64:
npm run package:staging:win:arm64
```

Installers appear under `dist/staging` with names such as
`NotiVenta-Staging-Setup-1.0.0-x64.exe`. The package embeds only the staging
environment and backend URL; installed users do not configure shell variables
or select an environment.

Detailed build and validation instructions are in
[`docs/windows-phase5-packaging-validation.md`](docs/windows-phase5-packaging-validation.md).

### Interactive Windows package helper

From a clean Windows checkout, the helper selects one of the supported package
identities, updates the matching branch, runs the focused Agent checks, builds
the installer, and asks before installing it:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-validation\package-agent.ps1
```

Choose **Staging** for the HTTPS Railway staging package. It checks out
`staging` and embeds `https://notiventabe-staging.up.railway.app`. Choose
**Local VM validation** only in the ARM64 Windows VM; it checks out `dev` and
uses the separate, fixed `http://192.168.64.1:8000` local-validation identity.
The helper refuses a checkout with local changes and does not reset, stash, or
overwrite work.

### Interactive Windows source launcher

For repeated unpackaged Windows sessions, use the source launcher from a clean
checkout:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-validation\run-agent-source.ps1
```

Choose **Local Mac DEV** to check out `dev` and launch Electron against the
fixed local backend `http://192.168.64.1:8000`. Choose **Staging source
session** to check out `staging` and launch unpackaged Electron against
`https://notiventabe-staging.up.railway.app`. The staging source session is not
a packaged-installer validation. The helper installs dependencies only when
they are missing or changed and repairs a missing Electron development binary.

## Windows ARM64 local-VM validation packaging

The Phase 5.4 Windows ARM64 VM has one separate, non-release package for the
fixed local backend `http://192.168.64.1:8000`. It is neither a staging nor a
production artifact, and its local-validation identity and HTTP destination are
embedded at package time. It does not read backend configuration from the
runtime environment.

Run this only from the ARM64 Windows VM with ARM64 Node/npm:

```powershell
npm ci
npm test
npm run typecheck
npm run package:local-validation:win:arm64
```

The installer is `dist/local-validation/NotiVenta-Local-Validation-Setup-<version>-arm64.exe`.
The normal `package:staging:*` commands still require a credential-free,
non-local HTTPS staging origin.

Windows 11 UTM validation instructions and the manual results checklist are in
[`docs/windows-phase4-validation.md`](docs/windows-phase4-validation.md) and
[`docs/windows-phase4-validation-checklist.md`](docs/windows-phase4-validation-checklist.md).

## Architecture and security

```text
React Renderer → typed Preload bridge → Electron Main → backend/platform services
```

Renderer is UI-only. Windows use context isolation, no Node integration,
sandboxing, restrictive navigation/window creation, and a restrictive CSP.
Electron Main owns pairing, Device-authenticated HTTP, polling, credentials,
tray lifecycle, and Windows startup behavior.

The raw `deviceCredential` is received in Main, stored through
`CredentialStore`, and never exposed through IPC or ordinary settings. The V1
production implementation uses `@napi-rs/keyring` to access Windows Credential
Manager. Real Windows persistence must be validated on Windows before release.

## Phase 4 scope

Implemented: pairing, secure credential lifecycle, authenticated polling,
temporary-disconnection and revocation behavior, authoritative status display,
tray background lifecycle, and Start with Windows preferences.

Implemented: safe receipt of a backend-authorized PrintJob through the existing
Device-authenticated poll contract. Before acknowledgement, Electron Main
persists only non-secret receipt metadata (`jobId`, `attemptId`, print type,
shipment ID, and optional order ID) in its local settings boundary. On restart,
it acknowledges that pending receipt before polling. If no local receipt exists,
it asks the Device-authenticated `GET /api/v1/agent/assignment` endpoint for
its own existing `AUTHORIZED` or `RECEIVED` assignment, persists that same
assignment when needed, then uses the normal idempotent receipt acknowledgement.
Recovery never creates a second PrintAttempt or redispatches a job. A received
assignment remains Device-blocking until the future physical lifecycle resolves
it. Receipt does not download a label or invoke a printer.

Not implemented: real printers, label files, physical printing, print
retry/requeue, production signing, or auto-update.

PF0 now locks the contract for the future receipt-to-result lifecycle without
implementing those components. The same backend-owned `RECEIVED` assignment
will be orchestrated by an Electron Main `PrintCoordinator` and a
`PrinterAdapter`; adapters will never call the backend, mutate workflow state,
persist result events, choose retries, fetch Mercado Libre labels, or receive
Device credentials.

Fake execution is restricted to test dependency injection, unpackaged
development composition, and immutable `local-validation` builds. Staging and
production builds must fail closed rather than construct a fake adapter, and
the backend will independently accept result events marked `SIMULATED` only
when its normalized environment is `dev`, `development`, `test`, or `testing`.
No user-facing or general runtime fake-print switch is planned.

PF0 also locks restart behavior: a `RECEIVED` assignment recovers with the same
job/attempt identity; a durable known result is resent with the same `eventId`
before any new work; and a `PRINTING` attempt is never automatically invoked
again after restart. Without a durable known result it remains unresolved and
eventually becomes backend-authoritative `UNKNOWN`/`NEEDS_ATTENTION`.

PF1 now provides the backend result endpoint, and PF2 provides the Agent's
durable SQLite result outbox. Synthetic or later adapter-owned outcomes are
saved locally before submission, retain one `eventId` across restart/retry, and
are removed only after backend acknowledgement. A durable active-assignment
checkpoint blocks new polling until terminal result delivery is acknowledged.
PF3 now supplies the minimal Main-process `PrinterAdapter`, deterministic
guarded `FakePrinterAdapter`, and `PrintCoordinator`. The coordinator maps only
fake `SUCCESS`/`FAILURE`/`UNKNOWN` to simulated PF1/PF2 result events. It never
emits physical `PRINTING`. PF4 now validates the fake success, failure, and
unknown flows through the PF2 HTTP client/outbox contract and PF1's local
PostgreSQL endpoint lifecycle, including delivery loss and restart resend.

PF5 adds a read-only installed-printer discovery boundary using Electron's
`webContents.getPrintersAsync()`. It normalizes the Windows queue name,
display name, optional description, and default marker. A queue is only
"available" when that exact case-insensitive Windows queue identity is present
in the current enumeration; this does not prove hardware health or printability.
PF5 never submits a print job or persists a user selection. PF6 owns selection
and configuration persistence.

PF6 stores one local selected Windows queue name and the fixed `SHIPPING_LABEL`
4 × 6 inch profile in Electron settings. Restart restores that selection; a
missing queue remains remembered but unavailable. The Agent never substitutes
the OS default queue, persists this setting to the backend, or prints on select.

Phase 5.2 completed the Windows staging packaging foundation. On 2026-10-06,
an installed packaged Agent on the Windows ARM64 VM passed the local-HTTP
credential lifecycle: secure write, complete-exit restore, revocation deletion,
return to pairing, and a restart that remained in pairing. The exact installer
filename was not recorded. This does not claim HTTPS staging/release acceptance
or x64 primary-architecture readiness. Packaged Start with Windows acceptance
remains Phase 5.4.
The Windows ARM64 reference installer requires the pinned `electron-builder`
26.15.6 release, which fixes the ARM64 NSIS extraction regression encountered
with 26.15.3.
