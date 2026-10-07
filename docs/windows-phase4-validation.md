# Phase 4 Windows VM validation

Run this validation inside the Windows 11 UTM VM on the Apple Silicon Mac. The
VM is the Phase 4 Windows integration environment. It is not authoritative for
physical printer behavior, which remains Phase 6 work on a real Windows machine
with the Westinghouse printer.

Do not use staging or production. Live checks in this guide use DEV only.

## Prepare the repository

Open PowerShell in the `notiventa_agent` repository root. Confirm the expected
revision when Git metadata is available:

```powershell
git rev-parse HEAD
```

The initial Phase 4 revision is:

```text
11c84b0e3c944c5d7006455fb577ecd21b54a864
```

Run the environment report before installing dependencies:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-validation\environment-check.ps1
```

The report contains OS/tool versions, architecture, hostname, user name, and
dependency presence. It does not read or print credentials.

Install the locked dependency tree and run the standard checks:

```powershell
npm ci
npm test
npm run typecheck
npm run build
```

`npm ci` is preferred because `package-lock.json` is committed. It performs a
clean, reproducible install and fails if the manifest and lockfile disagree.
Use `npm install` only when intentionally changing dependencies and the lockfile.

`npm run build` produces Electron Main, Preload, and Renderer bundles under
`out`. It does not create a packaged Windows executable or installer.

## Windows Credential Manager smoke test

After `npm ci`, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-validation\keyring-smoke.ps1
```

Expected output:

```text
SET PASS
GET PASS
DELETE PASS
MISSING PASS
```

The script creates a random secret under the dedicated service `NotiVenta Phase
4 Validation` and account `temporary-keyring-smoke`. It never uses, reads, or
changes the real Agent credential. It never prints the temporary secret or
enumerates unrelated credentials, and it attempts cleanup even after failure.
Because the entry is deleted immediately, use the PASS/FAIL output rather than
trying to inspect its secret value in Credential Manager.

## Launch against DEV

Set configuration only in the current PowerShell session, substituting the
actual DEV backend URL:

```powershell
$env:NOTIVENTA_AGENT_ENV = "development"
$env:NOTIVENTA_AGENT_BACKEND_URL = "https://<DEV_BACKEND_URL>"
npm run dev
```

Do not put a Device credential or pairing code in environment variables. Do not
point this validation at staging or production.

### Mac-hosted local Dummy ML development

For the DML 1.8 Windows VM -> Mac local-development path, use an unpackaged
Agent working copy and the verified private or link-local Mac-host address.
Do not use `127.0.0.1` from Windows: it means the VM itself.

```powershell
$env:NOTIVENTA_AGENT_ENV = "development"
$env:NOTIVENTA_AGENT_BACKEND_URL = "http://<MAC_VM_HOST>:8000"
$env:NOTIVENTA_AGENT_ALLOW_INSECURE_LOCAL_NETWORK = "true"
npm.cmd run dev
```

The explicit opt-in permits HTTP only for unpackaged development to a private
or link-local IPv4 host. An installed staging or production Agent `.exe` keeps
its packaged HTTPS destination and cannot be redirected to the Mac with shell
or `.env` variables. If PowerShell blocks `npm.ps1`, `npm.cmd run dev` is the
equivalent command without changing execution policy.

## Pairing and live polling

1. Launch the Agent in Windows.
2. Confirm the detected system name matches the VM hostname.
3. Generate a six-digit pairing code from the DEV dashboard.
4. Enter that code in the Agent.
5. Enter the intended display name.
6. Select **Pair computer**.
7. Confirm the Agent reaches Connected state.
8. Confirm the Device appears with the correct names, Windows platform, and
   Agent version in DEV where the dashboard exposes them.
9. Confirm authenticated polling begins immediately and the displayed state
   reflects DEV. Do not expose the Bearer credential while checking requests.

Do not automate this flow with invented codes or credentials.

## DML 1.9 receipt-only delivery follow-up

The Windows VM later validated DML 1.9's real receipt-only delivery path:
recover an existing `AUTHORIZED` assignment before polling when necessary,
persist safe receipt metadata, acknowledge it as `RECEIVED`, receive the next
queued job, and acknowledge it without duplicate dispatch. This is not a Phase
4 claim of printer support: no label download, spooler, printer API, or physical
output was used. See the backend local-testing guide for the full replay.

## Credential persistence and restart

After successful DEV pairing:

1. Confirm the Agent UI and logs do not display a Device credential.
2. In Windows Credential Manager, confirm a NotiVenta credential entry exists.
   Check existence only; do not reveal, copy, or print its stored value.
3. Quit the Agent explicitly from its tray menu.
4. Launch it again with the same DEV configuration.
5. Confirm it restores paired state and polls without asking for another code.

Ordinary Agent settings must not contain the credential. The behavioral restart
check is the primary validation that `CredentialStore` restored it.

## Temporary network failure

While paired and connected:

1. Disable the Windows VM network adapter or disconnect Windows networking.
2. Confirm the Agent becomes Disconnected but does not return to pairing.
3. Leave the network unavailable long enough to exercise the 5, 10, 20, and
   30-second retry delays.
4. Confirm the Credential Manager entry still exists without revealing it.
5. Restore networking.
6. Confirm the Agent reconnects automatically and refreshes authoritative state.

Temporary timeouts, DNS failures, connection failures, and backend 5xx responses
must not clear the credential.

## Device revocation

Using the existing supported DEV dashboard/backend flow:

1. Revoke or delete the paired DEV Device.
2. Leave the Agent running and allow its next poll to occur.
3. Confirm definitive authentication failure stops authenticated polling.
4. Confirm the Agent returns to pairing.
5. Confirm the NotiVenta entry is no longer present in Windows Credential
   Manager without exposing any secret value.

Do not call an invented endpoint and do not perform this validation against
staging or production.

## Tray lifecycle

While paired:

1. Close the main window.
2. Confirm the Agent remains present in the Windows tray and its process remains
   running.
3. Confirm backend liveness/polling continues while the window is hidden.
4. Select **Open NotiVenta** from the tray and confirm current UI state returns.
5. Select **Quit** and confirm the Agent process exits.

## Start with Windows

The current repository implements and unit-tests the startup-service boundary,
but does not contain Windows packaging. Unpackaged development intentionally
does not register autostart.

Therefore:

```text
BLOCKED UNTIL PACKAGING EXISTS
```

Do not add installer or signing work to Phase 4 merely to exercise this check.
Once a packaged Windows build exists, verify default enablement, sign-in launch,
user opt-out persistence, and that startup never changes `Device.isPaused`.

## Packaged native-module validation

`electron-vite build` creates bundles, not an installable application. It does
not prove that the correct Windows ARM64 or x64 `@napi-rs/keyring` native binary
will be included or loadable from a packaged application.

When packaging exists, repeat the keyring, restart, revocation, tray, and
autostart checks using the packaged build. Record Windows, Node, Electron,
package, and native-module architectures. Until then, packaged native-module
validation remains blocked.

Record results in [windows-phase4-validation-checklist.md](windows-phase4-validation-checklist.md).
