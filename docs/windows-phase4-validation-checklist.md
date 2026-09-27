# Phase 4 Windows VM validation checklist

Run in the Windows 11 UTM VM. Replace each `[ ] NOT RUN` with `[PASS]`, `[FAIL]`,
or `[BLOCKED]`, and add brief evidence where useful. A VM result does not prove
physical printer behavior.

Validation date:

Validator:

Agent commit:

Windows architecture:

Node / Electron architecture:

## Environment

- [ ] NOT RUN — Windows version and build recorded
- [ ] NOT RUN — OS, Node, Electron, and native dependency architectures recorded
- [ ] NOT RUN — VM hostname matches detected Agent `systemName`
- [ ] NOT RUN — current user and Agent package version recorded

## Project checks

- [ ] NOT RUN — `npm ci`
- [ ] NOT RUN — `npm test`
- [ ] NOT RUN — `npm run typecheck`
- [ ] NOT RUN — `npm run build`
- [ ] NOT RUN — confirmed build output is bundles, not a packaged executable

## Windows Credential Manager smoke test

- [ ] NOT RUN — SET PASS
- [ ] NOT RUN — GET PASS
- [ ] NOT RUN — DELETE PASS
- [ ] NOT RUN — MISSING PASS
- [ ] NOT RUN — temporary validation credential cleaned up

## Agent launch and pairing

- [ ] NOT RUN — Agent launches on Windows
- [ ] NOT RUN — Renderer, Preload, and Main start normally
- [ ] NOT RUN — live pairing uses DEV only
- [ ] NOT RUN — six-digit pairing succeeds
- [ ] NOT RUN — `systemName`, `displayName`, platform, and Agent version are correct
- [ ] NOT RUN — Agent reaches Connected state
- [ ] NOT RUN — Device appears correctly in DEV

## Credential restoration and polling

- [ ] NOT RUN — credential entry exists without exposing its value
- [ ] NOT RUN — Renderer/settings/logs do not expose the credential
- [ ] NOT RUN — restart restores paired state without another code
- [ ] NOT RUN — authenticated polling begins immediately
- [ ] NOT RUN — backend-authoritative state is displayed

## Network recovery

- [ ] NOT RUN — network loss produces Disconnected state without unpairing
- [ ] NOT RUN — 5/10/20/30-second retry progression observed
- [ ] NOT RUN — credential remains stored during temporary failure
- [ ] NOT RUN — Agent reconnects automatically after network restoration

## Revocation

- [ ] NOT RUN — Device revoked through the supported DEV flow
- [ ] NOT RUN — definitive authentication failure stops polling
- [ ] NOT RUN — credential is cleared without exposing its value
- [ ] NOT RUN — Agent returns to pairing

## Tray

- [ ] NOT RUN — closing the window leaves Agent running
- [ ] NOT RUN — polling continues while hidden
- [ ] NOT RUN — tray action reopens the current UI
- [ ] NOT RUN — explicit Quit exits the process

## Start with Windows

- [ ] NOT RUN — unpackaged development does not register autostart
- [BLOCKED] — packaged default enablement and sign-in launch; packaging does not exist
- [BLOCKED] — packaged user opt-out persistence; packaging does not exist

## Packaged native module

- [BLOCKED] — packaged Windows executable; packaging does not exist
- [BLOCKED] — packaged `@napi-rs/keyring` ARM64/x64 loading; packaging does not exist
- [BLOCKED] — packaged Credential Manager, tray, restart, and revocation checks

## Overall result

Choose exactly one after completing the applicable checks:

```text
WINDOWS VM VALIDATED
```

or

```text
WINDOWS VM NOT VALIDATED
```
