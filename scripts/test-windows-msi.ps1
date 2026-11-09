# Run as Administrator on a disposable Windows VM: this installs and removes HOP.
param(
    [Parameter(Mandatory)][string]$BaselineMsi,
    [Parameter(Mandatory)][string]$CandidateMsi
)
$ErrorActionPreference = 'Stop'
$installer = New-Object -ComObject WindowsInstaller.Installer
$BaselineMsi = (Resolve-Path $BaselineMsi).Path
$CandidateMsi = (Resolve-Path $CandidateMsi).Path
$logs = Join-Path $env:TEMP ('hop-msi-qa-' + [guid]::NewGuid())
New-Item -ItemType Directory $logs | Out-Null

function Install([string[]]$arguments, [string]$scenario) {
    $log = Join-Path $logs "$scenario.log"
    $quoted = $arguments | ForEach-Object {
        if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
    }
    $process = Start-Process msiexec.exe -ArgumentList ($quoted + @('/qn', '/norestart', '/l*v', "`"$log`"")) -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) {
        throw "$scenario failed ($($process.ExitCode)); see $log"
    }
}

$desktop = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'HOP.lnk'
$menu = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'HOP\HOP.lnk'
$uninstall = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'HOP\Uninstall HOP.lnk'
$database = $installer.OpenDatabase($CandidateMsi, 0)
$view = $database.OpenView("SELECT Value FROM Property WHERE Property='ProductCode'")
$null = $view.Execute()
$candidateCode = $view.Fetch().StringData(1)
$null = $view.Close()

function Check([string]$scenario, [bool]$hasDesktop, [bool]$hasMenu) {
    $actual = [ordered]@{
        scenario = $scenario
        desktop = Test-Path $desktop
        startMenu = Test-Path $menu
        uninstall = Test-Path $uninstall
    }
    $actual | ConvertTo-Json -Compress | Write-Output
    if ($actual.desktop -ne $hasDesktop -or $actual.startMenu -ne $hasMenu -or $actual.uninstall -ne $hasMenu) {
        throw "Shortcut assertion failed: $scenario; logs: $logs"
    }
}

Install @('/i', $BaselineMsi) 'baseline'
Check 'baseline-051-missing' $false $false
Install @('/i', $CandidateMsi) 'upgrade-broken'
Check 'upgrade-broken' $false $true
Install @('/x', $candidateCode) 'remove-broken'
Check 'uninstall' $false $false

Install @('/i', $CandidateMsi) 'fresh'
Check 'fresh' $true $true
Install @('/x', $candidateCode) 'remove-fresh'

Install @('/i', $BaselineMsi, 'REINSTALLMODE=amus') 'baseline-present'
Check 'baseline-present' $true $true
Install @('/i', $CandidateMsi) 'upgrade-present'
Check 'upgrade-present' $true $true
Install @('/x', $candidateCode) 'remove-present'

Install @('/i', $BaselineMsi, 'REINSTALLMODE=amus') 'baseline-deleted'
Remove-Item $desktop
Install @('/i', $CandidateMsi) 'upgrade-deleted'
Check 'upgrade-deleted' $false $true
Install @('/x', $candidateCode) 'remove-deleted'
Check 'final-uninstall' $false $false
Write-Output "MSI shortcut checks passed; logs: $logs"
