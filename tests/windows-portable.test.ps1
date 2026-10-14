$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repoRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $repoRoot 'scripts/build-portable-windows.ps1'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('hop-portable-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null

function Assert-True($condition, $message) {
    if (-not $condition) { throw $message }
}

function Assert-Fails($arguments) {
    $failed = $false
    try { & $scriptPath @arguments | Out-Null } catch { $failed = $true }
    Assert-True $failed 'Expected packaging to reject invalid input.'
}

try {
    # Fixture files test packaging only; they are deliberately not launchable.
    $fixtureRoot = Join-Path $testRoot ('folder with spaces ' + [char]0xD55C + [char]0xAE00)
    New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
    $exe = Join-Path $fixtureRoot 'hop-desktop.exe'
    $font = Join-Path $fixtureRoot 'font.ttf'
    Set-Content -LiteralPath $exe -Value 'fixture executable'
    Set-Content -LiteralPath $font -Value 'fixture PDF font'
    $configPath = Join-Path $fixtureRoot 'tauri.conf.json'
    @{ version = '0.4.5'; bundle = @{ resources = @{ 'font.ttf' = 'fonts/pdf/font.ttf' } } } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
    $arguments = @{
        SkipBuild = $true; ExecutablePath = $exe; ConfigPath = $configPath
        OutputDirectory = (Join-Path $testRoot 'output')
        WebView2RuntimePath = ''
    }
    $zipPath = & $scriptPath @arguments
    $zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $names = @($zip.Entries | ForEach-Object { $_.FullName })
        Assert-True (@($names | Where-Object { $_.Contains('\') }).Count -eq 0) 'ZIP paths must use forward slashes.'
        foreach ($expected in @('HOP/HOP.exe', 'HOP/hop-portable.json', 'HOP/fonts/pdf/font.ttf', 'HOP/LICENSE.txt', 'HOP/README.md', 'HOP/VERSION.txt')) {
            Assert-True ($names -contains $expected) "Missing ZIP entry: $expected"
        }
        Assert-True ($names.Count -eq 6) 'Unexpected files in portable ZIP.'
        $reader = [IO.StreamReader]::new($zip.GetEntry('HOP/HOP.exe').Open())
        try { Assert-True ($reader.ReadToEnd().Trim() -eq 'fixture executable') 'Wrong executable bytes.' }
        finally { $reader.Dispose() }
        $reader = [IO.StreamReader]::new($zip.GetEntry('HOP/VERSION.txt').Open())
        try { Assert-True ($reader.ReadToEnd().Trim() -eq '0.4.5') 'Wrong portable version.' }
        finally { $reader.Dispose() }
    } finally { $zip.Dispose() }

    $runtime = Join-Path $fixtureRoot 'runtime'
    New-Item -ItemType Directory -Path $runtime | Out-Null
    Set-Content -LiteralPath (Join-Path $runtime 'msedgewebview2.exe') -Value 'fixture runtime'
    Set-Content -LiteralPath (Join-Path $runtime 'LICENSE') -Value 'fixture runtime license'
    $arguments.WebView2RuntimePath = $runtime
    $zipPath = & $scriptPath @arguments
    $zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $names = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
        Assert-True ($names -contains 'HOP/WebView2/msedgewebview2.exe') 'Runtime missing.'
        Assert-True ($names -contains 'HOP/WebView2/LICENSE') 'Runtime license missing.'
    } finally { $zip.Dispose() }
    $previousHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
    $arguments.WebView2RuntimePath = $fixtureRoot
    Assert-Fails $arguments
    $arguments.WebView2RuntimePath = ''
    $arguments.ExecutablePath = Join-Path $fixtureRoot 'missing.exe'
    Assert-Fails $arguments
    $arguments.ExecutablePath = $exe
    @{ version = '0.4.5'; bundle = @{ resources = @{ 'missing.ttf' = 'fonts/pdf/font.ttf' } } } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
    Assert-Fails $arguments
    @{ version = '0.4.5'; bundle = @{ resources = @{ 'font.ttf' = '../escape.ttf' } } } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
    Assert-Fails $arguments
    Assert-True ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash -eq $previousHash) 'Failed packaging replaced the previous ZIP.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $testRoot 'output/escape.ttf'))) 'Resource escaped staging.'
    Assert-True (@(Get-ChildItem -LiteralPath $arguments.OutputDirectory -Directory).Count -eq 0) 'Staging folders were not cleaned.'
    Write-Output 'Windows portable packaging tests passed.'
} finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedTestRoot.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to remove test files outside the temporary directory.'
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
}
