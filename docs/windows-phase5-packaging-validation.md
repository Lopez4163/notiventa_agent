# Phase 5.2 Windows Packaging Validation

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
