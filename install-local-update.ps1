$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$result=Get-Content -LiteralPath (Join-Path $root 'v1.0.3-build-result.json') -Raw | ConvertFrom-Json
$install=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Assistant Planning'))
$stage=[IO.Path]::GetFullPath($result.stage)
if(-not $stage.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Stage hors projet.'}
if((Get-FileHash -LiteralPath $result.zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $result.sha256){throw 'SHA256 final invalide.'}
$data=Join-Path $env:LOCALAPPDATA 'SDIS-Bot-Collegues'
if(Test-Path -LiteralPath (Join-Path $data 'simulation.lock')){throw 'Synchronisation en cours.'}
if(-not(Test-Path -LiteralPath (Join-Path $data 'update.lock'))){throw 'Verrou de preparation absent.'}
$backup=Join-Path $root ('.rollback-local-v1.0.3-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup | Out-Null
$changed=@()
foreach($file in Get-ChildItem -LiteralPath $stage -File -Recurse -Force){
 $rel=$file.FullName.Substring($stage.Length+1)
 if($rel -match '(^|\\)(profiles|secrets|SDIS-Bot-Collegues)(\\|$)' -or $rel -in @('update-config.json','google-oauth-config.json','colleague-config.json','dendreo-config.json','alert.json')){throw ('Fichier protege dans le stage : '+$rel)}
 $dest=[IO.Path]::GetFullPath((Join-Path $install $rel))
 if(-not $dest.StartsWith($install+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Destination hors installation.'}
 $newHash=(Get-FileHash -LiteralPath $file.FullName).Hash
 if((Test-Path -LiteralPath $dest) -and (Get-FileHash -LiteralPath $dest).Hash -eq $newHash){continue}
 $changed+= [pscustomobject]@{rel=$rel;source=$file.FullName;dest=$dest;hash=$newHash;existed=(Test-Path -LiteralPath $dest)}
}
# Fermer uniquement l'interface, jamais Chromium ni les profils connectes.
$exe=Join-Path $install 'SDIS-Collegues.exe'
foreach($p in Get-Process -Name 'SDIS-Collegues' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $exe}){
 $null=$p.CloseMainWindow()
 if(-not $p.WaitForExit(10000)){Stop-Process -Id $p.Id -Force}
}
$copied=@()
try{
 foreach($file in $changed){
  if($file.existed){$saved=Join-Path $backup $file.rel;New-Item -ItemType Directory -Force -Path (Split-Path $saved -Parent)|Out-Null;Copy-Item -LiteralPath $file.dest -Destination $saved}
  New-Item -ItemType Directory -Force -Path (Split-Path $file.dest -Parent)|Out-Null
  $copied+=$file
  Copy-Item -LiteralPath $file.source -Destination $file.dest -Force
  if((Get-FileHash -LiteralPath $file.dest).Hash -ne $file.hash){throw ('Verification echouee : '+$file.rel)}
 }
 $local=Get-Content -LiteralPath (Join-Path $install 'app-version.json') -Raw | ConvertFrom-Json
 if($local.version -ne '1.0.3' -or $local.build -ne $result.build){throw 'Version installee incoherente.'}
 $report=[ordered]@{version=$local.version;build=$local.build;install=$install;backup=$backup;changed=@($changed.rel);verified=$true}
 [IO.File]::WriteAllText((Join-Path $root 'v1.0.3-install-result.json'),($report|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
 Write-Output ($report|ConvertTo-Json -Depth 4)
}catch{
 foreach($file in $copied){if($file.existed){Copy-Item -LiteralPath (Join-Path $backup $file.rel) -Destination $file.dest -Force}else{Remove-Item -LiteralPath $file.dest}}
 throw
}
