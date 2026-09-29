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
4. Confirm Main, Preload, Renderer, and the tray start normally.
5. Confirm the displayed Agent version matches `package.json`.
6. Confirm requests target the supplied staging backend and not DEV or
   production. Do not expose any Device credential while inspecting traffic.
7. Uninstall **NotiVenta Agent Staging** through Windows Installed Apps and
   confirm the application executable and shortcuts are removed.

## Record results

Record each architecture independently:

```text
Architecture: x64 | ARM64
Installer: BUILT | NOT BUILT
Install: PASS | FAIL | NOT RUN
Launch: PASS | FAIL | NOT RUN
Staging identity/backend: PASS | FAIL | NOT RUN
Tray: PASS | FAIL | NOT RUN
Uninstall: PASS | FAIL | NOT RUN
```

Phase 5.2 does not claim full packaged keyring lifecycle or Start with Windows
acceptance. Those checks belong to Phase 5.3 and Phase 5.4.
