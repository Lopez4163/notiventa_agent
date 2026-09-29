# Phase 4 Windows VM validation checklist

This checklist records the completed developer-run Windows 11 ARM64 UTM
validation. A VM result does not prove physical printer behavior.

Validation date:

Validator:

Agent commit:

Windows architecture:

Node / Electron architecture:

## Environment

- [PASS] — Windows 11 ARM64 VM execution
- [PASS] — Windows/Node/Electron environment supported Agent launch
- [PASS] — VM hostname matched detected Agent `systemName`
- [PASS] — Agent platform and version reporting

## Project checks

- [PASS] — dependency installation
- [PASS] — `npm test`
- [PASS] — `npm run typecheck`
- [PASS] — `npm run build`
- [PASS] — confirmed Phase 4 build output was bundles, not a packaged executable

## Windows Credential Manager smoke test

- [PASS] — SET
- [PASS] — GET
- [PASS] — DELETE
- [PASS] — MISSING
- [PASS] — temporary validation credential cleaned up

## Agent launch and pairing

- [PASS] — Agent launches on Windows
- [PASS] — Renderer, Preload, and Main start normally
- [PASS] — live pairing used DEV only
- [PASS] — six-digit pairing succeeds
- [PASS] — `systemName`, `displayName`, platform, and Agent version are correct
- [PASS] — Agent reaches Connected state
- [PASS] — Device appears correctly in DEV

## Credential restoration and polling

- [PASS] — credential entry exists without exposing its value
- [PASS] — Renderer/settings/logs do not expose the credential
- [PASS] — restart restores paired state without another code
- [PASS] — authenticated polling begins immediately
- [PASS] — backend-authoritative state is displayed

## Network recovery

- [PASS] — host Wi-Fi loss produces Disconnected state without unpairing while the UTM adapter remains intact
- [PASS] — temporary-failure retry behavior
- [PASS] — credential remains stored during temporary failure
- [PASS] — Agent reconnects automatically after host Wi-Fi restoration

## Revocation

- [PASS] — Device revoked through the supported DEV flow
- [PASS] — definitive authentication failure stops polling
- [PASS] — credential is cleared without exposing its value
- [PASS] — Agent returns to pairing

## Tray

- [PASS] — closing the window leaves Agent running
- [PASS] — polling continues while hidden
- [PASS] — tray action reopens the current UI
- [PASS] — explicit Quit exits the process

## Start with Windows

- [PASS] — unpackaged development does not register autostart
- [BLOCKED] — packaged default enablement and sign-in launch; moved to Phase 5 packaged acceptance
- [BLOCKED] — packaged user opt-out persistence; moved to Phase 5 packaged acceptance

## Packaged native module

- [BLOCKED] — packaged Windows executable; moved to Phase 5 packaging
- [BLOCKED] — packaged `@napi-rs/keyring` ARM64/x64 loading; moved to Phase 5 packaged acceptance
- [BLOCKED] — packaged Credential Manager restart and revocation checks; moved to Phase 5 packaged acceptance

## Overall result

```text
WINDOWS VM VALIDATED
```

The Phase 5 packaging items above were moved because Phase 4 did not own an
installer. They are not Phase 4 failures. This result does not claim
`REAL WINDOWS VALIDATED` or `PHYSICAL PRINTER VALIDATED`.
