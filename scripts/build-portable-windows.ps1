[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [string]$ExecutablePath,
    [string]$WebView2RuntimePath = $env:HOP_WEBVIEW2_RUNTIME_PATH,
    [string]$ConfigPath,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Windows portable packaging must run on Windows.' }
$repoRoot = Split-Path -Parent $PSScriptRoot
$tauriRoot = Join-Path $repoRoot 'apps/desktop/src-tauri'
if (-not $ConfigPath) { $ConfigPath = Join-Path $tauriRoot 'tauri.conf.json' }
$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

if (-not $SkipBuild) {
    Push-Location $repoRoot
    try {
        & pnpm --filter hop-desktop tauri build --no-bundle --target x86_64-pc-windows-msvc
        if ($LASTEXITCODE -ne 0) { throw "Tauri build failed ($LASTEXITCODE)." }
    } finally { Pop-Location }
}
if (-not $ExecutablePath) {
    $ExecutablePath = Join-Path $tauriRoot 'target/x86_64-pc-windows-msvc/release/hop-desktop.exe'
}
$ExecutablePath = (Resolve-Path -LiteralPath $ExecutablePath).Path
if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
    throw 'ExecutablePath must point to a built Windows executable.'
}
if ($WebView2RuntimePath) {
    $WebView2RuntimePath = (Resolve-Path -LiteralPath $WebView2RuntimePath).Path
    if (-not (Test-Path -LiteralPath (Join-Path $WebView2RuntimePath 'msedgewebview2.exe') -PathType Leaf)) {
        throw 'WebView2RuntimePath must be an extracted x64 Fixed Version runtime folder containing msedgewebview2.exe.'
    }
}

$outputRoot = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $tauriRoot 'target/portable' }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$stageRoot = Join-Path $outputRoot ([guid]::NewGuid().ToString('N'))
$packageRoot = Join-Path $stageRoot 'HOP'
$archivePath = Join-Path $outputRoot 'HOP-windows-x64-portable.zip'
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

try {
    Copy-Item -LiteralPath $ExecutablePath -Destination (Join-Path $packageRoot 'HOP.exe')
    # The native app detects this marker beside its executable, regardless of cwd.
    Set-Content -LiteralPath (Join-Path $packageRoot 'hop-portable.json') -Value '{}' -Encoding UTF8
    Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination (Join-Path $packageRoot 'LICENSE.txt')
    foreach ($resource in $config.bundle.resources.PSObject.Properties) {
        $source = Join-Path (Split-Path -Parent $ConfigPath) $resource.Name
        $destination = [IO.Path]::GetFullPath((Join-Path $packageRoot $resource.Value))
        $packagePrefix = [IO.Path]::GetFullPath($packageRoot) + [IO.Path]::DirectorySeparatorChar
        if (-not $destination.StartsWith($packagePrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Resource destination escapes portable folder: $($resource.Value)"
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination
    }
    if ($WebView2RuntimePath) {
        Copy-Item -LiteralPath $WebView2RuntimePath -Destination (Join-Path $packageRoot 'WebView2') -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $repoRoot 'docs/WINDOWS_PORTABLE.md') -Destination (Join-Path $packageRoot 'README.md')
    Set-Content -LiteralPath (Join-Path $packageRoot 'VERSION.txt') -Value $config.version -Encoding UTF8
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.IO.Compression
    $temporaryArchive = Join-Path $stageRoot 'portable.zip'
    $archive = [IO.Compression.ZipFile]::Open($temporaryArchive, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $packageRoot -File -Recurse) {
            $entryName = 'HOP/' + $file.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $archive.Dispose() }
    Move-Item -LiteralPath $temporaryArchive -Destination $archivePath -Force
    Write-Output $archivePath
} finally {
    $resolvedStage = [IO.Path]::GetFullPath($stageRoot)
    $outputPrefix = [IO.Path]::GetFullPath($outputRoot) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedStage.StartsWith($outputPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to clean staging folder outside portable output directory.'
    }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
