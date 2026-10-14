#Requires -Version 5.1
# Downloads the latest whisper.cpp Windows x64 CPU build + ggml-base.en.bin.
# Idempotent: skips anything already present.
#
# Usage:
#   setup-whisper.ps1                         # install into <repo>/bin/whisper  (dev checkout)
#   setup-whisper.ps1 -InstallDir <path>      # install into <path>/bin/whisper  (npx / runtime)

param(
  [string]$InstallDir
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($InstallDir) {
  $root = $InstallDir
} else {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
$binDir = Join-Path $root 'bin\whisper'
$modelsDir = Join-Path $binDir 'models'

New-Item -ItemType Directory -Force -Path $binDir | Out-Null
New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null

$cliPath = Join-Path $binDir 'whisper-cli.exe'
$modelPath = Join-Path $modelsDir 'ggml-base.en.bin'

# Known-good build used when the GitHub API is unreachable or rate-limited
# (unauthenticated calls are capped at 60/hour per IP).
$fallbackTag = 'v1.9.2'
$repoApi = 'https://api.github.com/repos/ggml-org/whisper.cpp'
$repoWeb = 'https://github.com/ggml-org/whisper.cpp'

# Native ARM64 build when available; x64 runs under emulation as a fallback.
$assetNames = @('whisper-bin-x64.zip')
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
  $assetNames = @('whisper-bin-win-cpu-arm64.zip') + $assetNames
}

# Download to a sibling .part file and rename on success, so an interrupted
# download never leaves a truncated file that later passes a Test-Path check.
function Save-Url([string]$Url, [string]$OutFile) {
  $part = "$OutFile.part"
  if (Test-Path $part) { Remove-Item $part -Force }
  Invoke-WebRequest -Uri $Url -OutFile $part -UseBasicParsing
  Move-Item -Path $part -Destination $OutFile -Force
}

# Since v1.9.x, whisper.cpp publishes binaries on separate `bNNNN` build
# releases (often flagged prerelease) while the `vX.Y.Z` tag release ships no
# assets, so `/releases/latest` is useless. Scan recent releases instead and
# take the newest one carrying the plain CPU zip.
function Find-WhisperAsset {
  $headers = @{ 'User-Agent' = 'murmur-setup'; 'Accept' = 'application/vnd.github+json' }
  if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }
  try {
    $releases = Invoke-RestMethod "$repoApi/releases?per_page=30" -Headers $headers
  } catch {
    Write-Host "[setup-whisper] GitHub API unavailable ($($_.Exception.Message))"
    return $null
  }
  foreach ($name in $assetNames) {
    foreach ($release in $releases) {
      if ($release.draft) { continue }
      $asset = $release.assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
      if ($asset) {
        return [pscustomobject]@{
          Tag  = $release.tag_name
          Name = $asset.name
          Url  = $asset.browser_download_url
          Size = $asset.size
        }
      }
    }
  }
  return $null
}

# --- 1. whisper.cpp binary ---------------------------------------------------
if (-not (Test-Path $cliPath)) {
  Write-Host '[setup-whisper] looking up the newest whisper.cpp Windows build...'
  $asset = Find-WhisperAsset
  if (-not $asset) {
    Write-Host "[setup-whisper] falling back to pinned release $fallbackTag"
    $asset = [pscustomobject]@{
      Tag  = $fallbackTag
      Name = 'whisper-bin-x64.zip'
      Url  = "$repoWeb/releases/download/$fallbackTag/whisper-bin-x64.zip"
      Size = 0
    }
  }

  $sizeLabel = if ($asset.Size) { " ($([math]::Round($asset.Size / 1MB, 1)) MB)" } else { '' }
  Write-Host "[setup-whisper] downloading $($asset.Name) from $($asset.Tag)$sizeLabel..."
  $zipPath = Join-Path $env:TEMP "murmur-whisper-$PID.zip"
  try {
    Save-Url $asset.Url $zipPath
  } catch {
    throw "Download of $($asset.Url) failed: $($_.Exception.Message). Grab whisper-bin-x64.zip from $repoWeb/releases and extract it into $binDir."
  }

  Write-Host '[setup-whisper] extracting...'
  try {
    Expand-Archive -Path $zipPath -DestinationPath $binDir -Force
  } finally {
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
  }

  # Recent whisper.cpp releases nest binaries inside a Release\ subfolder.
  # Flatten so the .exe and DLLs sit at $binDir, matching the default config.
  if (-not (Test-Path $cliPath)) {
    $nested = Get-ChildItem -Path $binDir -Directory -ErrorAction SilentlyContinue `
      | Where-Object { Test-Path (Join-Path $_.FullName 'whisper-cli.exe') } `
      | Select-Object -First 1
    if ($nested) {
      Write-Host "[setup-whisper] flattening $($nested.Name)\ -> bin\whisper\"
      Get-ChildItem -Path $nested.FullName -Force | ForEach-Object {
        Move-Item -Path $_.FullName -Destination $binDir -Force
      }
      Remove-Item -Path $nested.FullName -Recurse -Force
    }
  }

  if (-not (Test-Path $cliPath)) {
    throw 'Extracted archive does not contain whisper-cli.exe. Archive layout may have changed.'
  }
  Write-Host "[setup-whisper] whisper-cli.exe ready at $cliPath"
} else {
  Write-Host "[setup-whisper] binary already present at $cliPath"
}

# --- 2. ggml-base.en.bin -----------------------------------------------------
if (-not (Test-Path $modelPath)) {
  Write-Host '[setup-whisper] downloading ggml-base.en.bin (~148 MB)...'
  $modelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin'
  Save-Url $modelUrl $modelPath
  Write-Host "[setup-whisper] model ready at $modelPath"
} else {
  Write-Host "[setup-whisper] model already present at $modelPath"
}

# --- 3. Print env lines ------------------------------------------------------
# With -InstallDir the caller (murmur's first-run setup) writes these paths into
# config.json itself, so the .env hint only applies to dev checkouts.
if ($InstallDir) { exit 0 }
Write-Host ''
Write-Host '============================================================'
Write-Host ' Done. Confirm these lines are in your .env:'
Write-Host '============================================================'
Write-Host "WHISPER_CLI_PATH=$cliPath"
Write-Host "WHISPER_MODEL_PATH=$modelPath"
Write-Host '============================================================'
