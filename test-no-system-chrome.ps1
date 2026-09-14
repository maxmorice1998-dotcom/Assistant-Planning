$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
function Assert([bool]$ok, [string]$message) { if (-not $ok) { throw $message } }

# Le navigateur distribue doit etre present dans le runtime embarque.
$bundled = @(Get-ChildItem -LiteralPath (Join-Path $root 'runtime\browser') -Recurse -File -Filter 'chrome.exe')
Assert ($bundled.Count -eq 1) 'Chromium embarque absent ou ambigu.'
$bundledPath = [IO.Path]::GetFullPath($bundled[0].FullName)
$runtimeBrowser = [IO.Path]::GetFullPath((Join-Path $root 'runtime\browser')).TrimEnd('\') + '\'
Assert ($bundledPath.StartsWith($runtimeBrowser, [StringComparison]::OrdinalIgnoreCase)) 'chrome.exe hors du runtime embarque.'

# Aucun chemin Chrome systeme ne doit etre present dans le code de l application.
$files = @(Get-ChildItem -LiteralPath $root -File -Recurse |
  Where-Object { $_.Extension -in '.js','.cs','.ps1' -and $_.Name -ne 'test-no-system-chrome.ps1' -and $_.FullName -notmatch '\\node_modules\\' })
$forbidden = @($files | Select-String -Pattern '(?i)(Program Files|ProgramW6432|ProgramFiles\(x86\)).{0,120}Google[\\/]Chrome' -AllMatches)
if ($forbidden.Count -gt 0) { throw ('Chemin Chrome systeme detecte : ' + $forbidden[0].Line.Trim()) }
$manager = [IO.File]::ReadAllText((Join-Path $root 'browser-manager.js'))
Assert ($manager.Contains('spawn(rt.browserExe()')) 'AGATT/Dendreo ne lancent pas le navigateur runtime.browserExe().' 

# Resolution runtime effective, independante du PATH et de Chrome installe.
$node = Join-Path $root 'runtime\node\node.exe'
Assert (Test-Path -LiteralPath $node) 'Runtime Node embarque absent.'
$resolved = (& $node -e "process.stdout.write(require('./runtime-config').browserExe())")
Assert ($LASTEXITCODE -eq 0) 'runtime-config.browserExe() a echoue.'
Assert ([IO.Path]::GetFullPath($resolved).StartsWith($runtimeBrowser, [StringComparison]::OrdinalIgnoreCase)) 'browserExe() ne retourne pas Chromium embarque.'

# Verification statique des deux ports dedies.
$ports = (& $node -e "const r=require('./runtime-config');process.stdout.write(JSON.stringify(r.ports))") | ConvertFrom-Json
Assert ($ports.agatt -eq 19222 -and $ports.dendreo -eq 19223) 'Ports CDP inattendus.'
Write-Output ('PASS: Chromium embarque uniquement - ' + $bundledPath)
