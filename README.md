# NotiVenta Agent

Windows-first Electron foundation that pairs a computer with NotiVenta and keeps
its backend-authoritative operational state synchronized. This is a standalone
application and repository; it is not part of the backend or web frontend.

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

Not implemented: printers, label files, physical printing, PrintAttempt,
dispatch, retries, result events/outbox, production signing, or auto-update.

Phase 5.2 completed the Windows staging packaging foundation. Packaged keyring
acceptance and packaged Start with Windows acceptance remain Phase 5.3 and 5.4.
The Windows ARM64 reference installer requires the pinned `electron-builder`
26.15.6 release, which fixes the ARM64 NSIS extraction regression encountered
with 26.15.3.
