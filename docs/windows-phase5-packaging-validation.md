# Phase 5.2 Windows Packaging and Phase 5.3 Keyring Validation

Run the authoritative packaging validation inside Windows. Do not treat a
macOS cross-build as an official artifact.

## Build the staging installer

Open PowerShell in a clean Agent checkout. Use Node/npm whose architecture
matches the artifact being built.

```powershell
node --version
node -p "process.platform + ' ' + process.arch"
npm --version
npm ci
$env:NOTIVENTA_AGENT_STAGING_BACKEND_URL = "https://<STAGING_BACKEND_URL>"
npm test
npm run typecheck
npm run package:staging:win:x64
```

For ARM64, run the same clean process with Windows/Node ARM64 and replace the
last command with:

```powershell
npm run package:staging:win:arm64
```

The build refuses non-Windows hosts, mismatched Node/target architectures,
missing URLs, local URLs, credentials in URLs, non-HTTPS staging origins, and a
missing architecture-matched Windows `@napi-rs/keyring` binary.

### Interactive package helper

For the supported staging and local-VM validation choices, run the checked-in
PowerShell helper from a clean checkout:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-validation\package-agent.ps1
```

It asks for **Staging** or **Local VM validation**, checks out and fast-forwards
the matching branch, runs `npm ci` and Agent tests, invokes the existing
architecture-matched package command, and asks before starting the installer.
Staging embeds `https://notiventabe-staging.up.railway.app`; local validation
supports matching x64 and ARM64 Windows/Node installations and uses its
existing fixed local backend. The helper stops when
the checkout has local changes rather than resetting, stashing, or overwriting
them.

## Local-validation package

Phase 5.4 needs an installed packaged Agent to validate Windows login startup.
Build the explicitly named local-validation package using matching Windows and
Node architecture. It embeds `http://192.168.64.1:8000` and a
`local-validation` package environment; it is not staging or production and
must never be distributed as either.

From a clean Windows checkout with matching x64 or ARM64 Node/npm:

```powershell
node -p "process.platform + ' ' + process.arch"
npm ci
npm test
npm run typecheck
npm run package:local-validation:win:x64
# or
npm run package:local-validation:win:arm64
```

The installer is written to:

```text
dist/local-validation/NotiVenta-Local-Validation-Setup-<version>-<arch>.exe
```

The local-validation command does not accept a backend URL environment
variable. It is limited to the VM backend above and has a distinct application,
shortcut, and installer identity. It does not relax the staging command, which
continues to require a credential-free, non-local HTTPS origin.

## Find and install the artifact

The installer is written to:

```text
dist/staging/NotiVenta-Staging-Setup-<version>-<arch>.exe
```

1. Confirm the filename says `Staging` and has the expected architecture.
2. Run the installer. An Unknown Publisher or SmartScreen warning is expected
   for this unsigned internal staging artifact; do not disable Windows security.
3. Launch **NotiVenta Agent Staging** from its installed shortcut.
4. Confirm Main, Preload, and Renderer start normally and the Agent reaches the
   initial pairing state without crashing.
5. Confirm the displayed Agent version matches `package.json`.
6. Confirm requests target the supplied staging backend and not DEV or
   production. Do not expose any Device credential while inspecting traffic.

## Record results

Record each architecture independently:

```text
Architecture: x64 | ARM64
Installer: BUILT | NOT BUILT
Install: PASS | FAIL | NOT RUN
Launch: PASS | FAIL | NOT RUN
Staging identity/backend: PASS | FAIL | NOT RUN
```

Phase 5.2 does not claim full packaged keyring lifecycle or Start with Windows
acceptance. Those checks belong to Phase 5.3 and Phase 5.4.

## ARM64 reference-build result

Developer-run validation in the Windows 11 ARM64 UTM VM established the
following Phase 5.2 results:

```text
Architecture: ARM64
Installer: BUILT
Install: PASS
Launch: PASS
Initial/pairing state: PASS
Installed executable/runtime: PASS
Staging identity/backend: PASS
```

The first installer built with `electron-builder` 26.15.3 contained the full
application payload, but its NSIS install step silently omitted the ARM64 main
executable and several Electron runtime DLLs. The unpacked application launched
successfully, manual archive extraction produced the complete application, and
Windows security logs showed no matching block. This matched the upstream
electron-builder ARM64 NSIS extraction regression fixed in 26.15.6.

The project now pins `electron-builder` 26.15.6. Rebuilding with that version
produced a working ARM64 installer: installation completed, the installed
directory contained `NotiVentaAgentStaging.exe` and the expected Electron DLLs,
and the installed Agent launched successfully. No NSIS YAML redesign was
required.

Phase 5.2 is complete. Actual Device pairing was intentionally not required for
this packaging/install phase. Packaged native keyring loading, pairing,
credential persistence, restart restoration, revocation clearing, and return
to pairing begin in Phase 5.3. Packaged Start with Windows remains Phase 5.4,
the Device-status backend remains Phase 5.5, dashboard pairing and Device UI
remain Phase 5.6, and Disconnect/Remove Computer remains Phase 5.7.

## Phase 5.3 packaged keyring acceptance

Run this procedure using the installed staging Agent, never Electron or source
bundles. Repeat it separately for every packaged architecture being accepted.
x64 is required for V1 production readiness; ARM64 is a supported secondary
architecture. Do not print, copy, or reveal a Device credential at any point.

### Preconditions

* Build the matching architecture from a clean Windows checkout with `npm ci`
  and the command above.
* Use a reachable staging backend and a staging test User that can pair and
  revoke its own Device through the existing supported backend mechanism.
* Begin without an active Device for that User and without a stale NotiVenta
  Device credential for this test installation.

### 1. Install and native-module load

1. Install `NotiVenta-Staging-Setup-<version>-<arch>.exe`.
2. Confirm the installed application's unpacked resources contain the matching
   `@napi-rs/keyring` binary:

   ```powershell
   $arch = 'x64' # or 'arm64'
   $installRoot = Join-Path $env:LOCALAPPDATA 'Programs\NotiVenta Agent Staging'
   Get-ChildItem "$installRoot\resources\app.asar.unpacked\node_modules\@napi-rs" -Recurse `
     -Filter "keyring.win32-$arch-msvc.node"
   ```

3. Launch **NotiVenta Agent Staging** from its installed shortcut.
4. Confirm it reaches pairing without a native-module error. The Main-process
   log records only `Secure Windows credential storage initialized.`; it never
   includes a credential.

Expected: the architecture-matched binary is present and the installed Agent
starts normally.

### 2. Secure write after pairing

1. Generate a staging pairing code through the supported backend flow.
2. Pair from the installed Agent and wait for its connected state.
3. In Windows Credential Manager, verify that the NotiVenta entry exists. Check
   existence only; do not reveal, copy, or print its stored value.

Expected: the Main-process log records only `Secure Device credential stored.`
and the Agent polls as the paired Device.

### 3. Complete exit and secure restore

1. Choose **Quit** from the Agent tray menu, not merely the window close button.
2. Confirm the Agent process is no longer running.
3. Relaunch the installed Agent from its Start-menu or desktop shortcut.
4. Confirm it reconnects as the same Device without a pairing code.

Expected: the Main-process log records only `Secure Device credential restored.`
and the Agent authenticates and polls without another pairing flow.

### 4. Revocation and secure deletion

1. Revoke that Device through the existing supported staging backend mechanism.
2. Leave the installed Agent running until its next authenticated request is
   rejected.
3. Confirm it stops authenticated work and returns to pairing.
4. Verify that the NotiVenta entry is absent in Windows Credential Manager
   without opening or revealing any credential value.

Expected: only a definitive Device-authentication rejection causes the Main
process to record that the credential was deleted. Timeout, connection loss,
and 5xx responses retain the credential and show the temporary disconnected
state instead.

### 5. Deletion persists across restart

1. Quit the Agent from its tray menu and confirm the process exits.
2. Relaunch the installed Agent.

Expected: the Agent remains in pairing and the revoked credential does not
return.

### Record

Record a result for every tested architecture:

```text
Architecture: x64 | ARM64
Installer / matching native binary: PASS | FAIL
Installed native-module load: PASS | FAIL
Secure write after pairing: PASS | FAIL
Complete-exit restore and same-Device authentication: PASS | FAIL
Revocation deletes credential and returns to pairing: PASS | FAIL
Deleted credential remains absent after restart: PASS | FAIL
```

This is Phase 5.3 acceptance only. Packaged Start with Windows is Phase 5.4;
dashboard Device status and removal UX are later Phase 5 work.

### Recorded ARM64 local VM result — 2026-10-06

An installed packaged Agent on the Windows ARM64 VM completed the full Device
credential lifecycle against the local HTTP VM backend:

```text
Architecture: ARM64
Exact installer filename: not recorded
Installed native-module load: PASS
Secure write after pairing: PASS
Complete-exit restore and same-Device authentication: PASS
Revocation deletes credential and returns to pairing: PASS
Deleted credential remains absent after restart: PASS
```

This result is intentionally limited to local HTTP VM acceptance. It does not
claim that an HTTPS-bound staging/release artifact or the x64 primary production
architecture has completed the same acceptance.

## Phase 5.4 packaged Start with Windows acceptance

Run this validation only with the installed local-validation package, never an
unpackaged Electron development session. Start with Windows is a local Agent
preference and does not change backend Device pause state.

### Recorded ARM64 local VM result — 2026-10-06

The installed `NotiVenta Agent Local Validation` ARM64 package, built from
Agent commit `f5f6cdf`, passed the full Start with Windows lifecycle against
the local HTTP VM backend:

```text
Architecture: ARM64
Package: local-validation only; http://192.168.64.1:8000
Default preference enabled and login registration present: PASS
Preference remains enabled after explicit quit/relaunch: PASS
Windows sign-in launches installed Agent: PASS
Disable removes login registration: PASS
Disabled preference remains after explicit quit/relaunch: PASS
Disabled Agent does not launch after Windows sign-in: PASS
Unpackaged npm run dev does not register login startup: PASS
Re-enable restores login registration: PASS
```

This completes Phase 5.4 Windows VM acceptance for the local ARM64 package.
It does not claim HTTPS staging/release acceptance, x64 primary-architecture
readiness, real-Windows-hardware validation, code signing, or Phase 5.5 work.
