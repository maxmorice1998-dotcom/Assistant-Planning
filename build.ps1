param([string]$OutputRoot=$PSScriptRoot)
$ErrorActionPreference='Stop'
$versionPath=Join-Path $PSScriptRoot 'app-version.json'
if(-not(Test-Path -LiteralPath $versionPath)){throw 'Fichier app-version.json absent.'}
$versionText=[IO.File]::ReadAllText($versionPath,[Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
$versionData=$versionText | ConvertFrom-Json
$version=([string]$versionData.version).Trim()
if(-not $version){throw 'Version applicative absente.'}
$buildStamp=(Get-Date).ToString('o')
$versionJson = [ordered]@{version=$version;build=$buildStamp} | ConvertTo-Json
[IO.File]::WriteAllText($versionPath,$versionJson,(New-Object Text.UTF8Encoding($false)))
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if(-not(Test-Path -LiteralPath $compiler)){throw 'Compilateur Windows absent.'}
$assemblyInfo=Join-Path $PSScriptRoot '.build-version.cs'
if($version -notmatch '^\d+\.\d+\.\d+$'){throw 'Version invalide.'}
[IO.File]::WriteAllText($assemblyInfo,('[assembly:System.Reflection.AssemblyVersion("'+$version+'.0")][assembly:System.Reflection.AssemblyFileVersion("'+$version+'.0")][assembly:System.Reflection.AssemblyInformationalVersion("'+$version+'") ]'),[Text.UTF8Encoding]::new($false))
try {
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /win32icon:"$PSScriptRoot\assets\assistant-planning.ico" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.Security.dll /reference:Microsoft.CSharp.dll /out:"$OutputRoot\SDIS-Collegues.exe" "$PSScriptRoot\SDIS-Collegues.cs" "$PSScriptRoot\ShortcutRepair.cs" $assemblyInfo
if($LASTEXITCODE -ne 0){throw 'Compilation impossible.'}
& $compiler /nologo /target:exe /platform:x64 /optimize+ /codepage:65001 /reference:System.Security.dll /out:"$OutputRoot\SDIS-Collegues-Bridge.exe" "$PSScriptRoot\SDIS-Collegues-Bridge.cs" $assemblyInfo
if($LASTEXITCODE -ne 0){throw 'Compilation du pont DPAPI impossible.'}
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /out:"$OutputRoot\AssistantPlanning-UpdateLauncher.exe" "$PSScriptRoot\AssistantPlanning-UpdateLauncher.cs" $assemblyInfo
if($LASTEXITCODE -ne 0){throw 'Compilation du lanceur de mise a jour impossible.'}
} finally { Remove-Item -LiteralPath $assemblyInfo -Force -ErrorAction SilentlyContinue }
