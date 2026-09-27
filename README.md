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
dispatch, retries, result events/outbox, installer/signing, or auto-update.
