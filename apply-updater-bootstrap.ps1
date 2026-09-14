param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference='Stop'
$files=@('update-client.js','runtime-config.js','update-helper.ps1')
$root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$expectedPrefix=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Assistant Planning')).TrimEnd('\')
if(-not $root.StartsWith($expectedPrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Dossier d installation invalide.'}
$backup=Join-Path ([IO.Path]::GetTempPath()) ('assistant-planning-bootstrap-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $backup | Out-Null
$copied=@()
try {
  foreach($name in $files){
    $src=Join-Path $PSScriptRoot $name
    $dst=Join-Path $root $name
    if(-not(Test-Path -LiteralPath $src -PathType Leaf)){throw "Bootstrap incomplet : $name"}
    if(-not(Test-Path -LiteralPath $dst -PathType Leaf)){throw "Fichier cible absent : $name"}
    Copy-Item -LiteralPath $dst -Destination (Join-Path $backup $name) -Force
  }
  foreach($name in $files){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $root $name) -Force;$copied+=$name}
  foreach($name in $files){$srcHash=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $name) -Algorithm SHA256).Hash;$dstHash=(Get-FileHash -LiteralPath (Join-Path $root $name) -Algorithm SHA256).Hash;if($srcHash -ne $dstHash){throw "Vérification échouée : $name"}}
  Write-Output 'Bootstrap updater appliqué. Les données utilisateur sont inchangées.'
} catch {
  foreach($name in $files){$old=Join-Path $backup $name;if(Test-Path -LiteralPath $old){Copy-Item -LiteralPath $old -Destination (Join-Path $root $name) -Force}}
  throw
} finally {Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue}
