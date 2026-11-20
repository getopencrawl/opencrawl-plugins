$ErrorActionPreference = 'Stop'
$plugin = Split-Path -Parent $PSScriptRoot
$env:OPENCRAWL_NO_UPDATE = '1'
if (Get-Command bun -CommandType Application -ErrorAction SilentlyContinue) {
  & bun (Join-Path $plugin 'cli/opencrawl.js') @args
  exit $LASTEXITCODE
}

$version = (Get-Content -Raw (Join-Path $plugin 'cli/VERSION')).Trim()
$cache = Join-Path $env:LOCALAPPDATA 'OpenCrawl-Devin/cli'
$binary = Join-Path $cache "data/opencrawl/versions/$version/opencrawl.exe"
if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
  $saved = @{}
  foreach ($key in @('XDG_CACHE_HOME','XDG_DATA_HOME','OPENCRAWL_INSTALL_DIR','OPENCRAWL_DOWNLOAD_BASE')) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
  }
  try {
    $env:XDG_CACHE_HOME = Join-Path $cache 'cache'
    $env:XDG_DATA_HOME = Join-Path $cache 'data'
    $env:OPENCRAWL_INSTALL_DIR = Join-Path $cache 'bin'
    Remove-Item Env:OPENCRAWL_DOWNLOAD_BASE -ErrorAction SilentlyContinue
    & (Join-Path $plugin 'cli/install.ps1') -Version $version 6>&1 | ForEach-Object { [Console]::Error.WriteLine($_) }
  } finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
  }
}
& $binary @args
exit $LASTEXITCODE
