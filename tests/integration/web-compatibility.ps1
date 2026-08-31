#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$WebRoot = (Join-Path $PSScriptRoot '..\..\src\web')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedWebRoot = (Resolve-Path $WebRoot).Path
$sourcePath = Join-Path $resolvedWebRoot 'src\idempotency-key.ts'
$tsc = Join-Path $resolvedWebRoot 'node_modules\.bin\tsc.cmd'
if (-not (Test-Path $tsc -PathType Leaf)) { throw "TypeScript compiler was not found: $tsc" }

$outputRoot = Join-Path $env:TEMP ("ConfigHub-web-compat-{0}" -f (Get-Date -Format 'yyyyMMddHHmmss'))
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
& $tsc --target ES2023 --lib ES2023,DOM --module ES2022 --moduleResolution Bundler --outDir $outputRoot $sourcePath
if ($LASTEXITCODE -ne 0) { throw 'Unable to compile the idempotency key compatibility module.' }

$modulePath = Join-Path $outputRoot 'idempotency-key.mjs'
Move-Item -LiteralPath (Join-Path $outputRoot 'idempotency-key.js') -Destination $modulePath
$runnerPath = Join-Path $outputRoot 'run.mjs'
@'
import assert from 'node:assert/strict'
import { createIdempotencyKey } from './idempotency-key.mjs'

const originalCrypto = globalThis.crypto
const restoreCrypto = () => Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true })
try {
  let randomValuesCalled = false
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues(bytes) {
        randomValuesCalled = true
        bytes.forEach((_, index) => { bytes[index] = index + 1 })
        return bytes
      },
    },
  })
  const fallbackKey = createIdempotencyKey()
  assert.equal(randomValuesCalled, true)
  assert.match(fallbackKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => 'browser-random-uuid' } })
  assert.equal(createIdempotencyKey(), 'browser-random-uuid')
} finally {
  restoreCrypto()
}
'@ | Set-Content -LiteralPath $runnerPath -Encoding UTF8

& node $runnerPath
if ($LASTEXITCODE -ne 0) { throw 'Web crypto compatibility test failed.' }
Write-Host 'Web crypto compatibility test passed.'
