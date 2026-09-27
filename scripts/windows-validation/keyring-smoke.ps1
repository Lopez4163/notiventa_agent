$ErrorActionPreference = 'Stop'

& node (Join-Path $PSScriptRoot 'keyring-smoke.mjs')
exit $LASTEXITCODE
