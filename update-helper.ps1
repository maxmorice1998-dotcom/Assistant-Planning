param(
  [Parameter(Mandatory=$true)][string]$Package,
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [Parameter(Mandatory=$true)][string]$Exe,
  [Parameter(Mandatory=$true)][string]$UpdateLock,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion,
  [Parameter(Mandatory=$true)][string]$TempRoot
)
$ErrorActionPreference='Stop'
$logRoot=if($env:SDIS_COLLEAGUES_TEST_DIR){$env:SDIS_COLLEAGUES_TEST_DIR}else{Join-Path $env:LOCALAPPDATA 'SDIS-Bot-Collegues'}
$log=Join-Path $logRoot 'assistant-planning.log'
function Log([string]$result,[string]$message=''){try{New-Item -ItemType Directory -Force -Path (Split-Path $log -Parent)|Out-Null;Add-Content -LiteralPath $log -Value ('['+(Get-Date).ToString('HH:mm:ss')+'] [UPDATE] '+$result+' - '+($message -replace '[\r\n]+',' ')) -Encoding UTF8}catch{}}
function ReleaseLock(){try{Remove-Item -LiteralPath $UpdateLock -Force -ErrorAction SilentlyContinue}catch{}}
function Running([string]$path){$full=[IO.Path]::GetFullPath($path);@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{$_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $full}).Count -gt 0}
function WaitClosed([string]$path){$end=(Get-Date).AddSeconds(60);while((Get-Date)-lt $end){if(-not(Running $path)){return};Start-Sleep -Milliseconds 250};throw 'Assistant Planning ne s est pas fermé.'}
function StartChecked([string]$path){$p=Start-Process -FilePath $path -ArgumentList '--skip-update' -WorkingDirectory (Split-Path $path -Parent) -PassThru;Start-Sleep -Seconds 2;if($p.HasExited -and $p.ExitCode -ne 0){throw ('Démarrage échoué (code '+$p.ExitCode+').')}}
$install=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$backup=$install+'.backup';$new=Join-Path $TempRoot 'Assistant Planning';$sw=[Diagnostics.Stopwatch]::StartNew()
try{
  New-Item -ItemType Directory -Force -Path $new|Out-Null
  Expand-Archive -LiteralPath $Package -DestinationPath $new -Force
  if(-not(Test-Path (Join-Path $new 'SDIS-Collegues.exe'))){throw 'Package complet incomplet.'}
  WaitClosed $Exe
  if(Test-Path $backup){Remove-Item $backup -Recurse -Force}
  if(Test-Path $install){Move-Item $install $backup}
  Move-Item $new $install
  $v=Get-Content (Join-Path $install 'app-version.json') -Raw|ConvertFrom-Json
  if([string]$v.version -ne $ExpectedVersion){throw ('Version installée inattendue : '+$v.version)}
  $taskScript=Join-Path $install 'configure-background-task.ps1'
  if(-not(Test-Path -LiteralPath $taskScript)){throw 'Configuration du démarrage automatique absente.'}
  & $taskScript -InstallRoot $install
  StartChecked (Join-Path $install 'SDIS-Collegues.exe')
  Log 'OK' ('installation '+$ExpectedVersion+' et redémarrage réussis en '+[math]::Round($sw.Elapsed.TotalSeconds,1)+' s')
  try{Remove-Item $backup -Recurse -Force -ErrorAction SilentlyContinue}catch{Log 'OK' 'backup conservé temporairement'}
}catch{
  Log 'ERREUR' $_.Exception.Message
  try{if(Test-Path $install){Remove-Item $install -Recurse -Force};if(Test-Path $backup){Move-Item $backup $install};if(Test-Path (Join-Path $install 'SDIS-Collegues.exe')){StartChecked (Join-Path $install 'SDIS-Collegues.exe')};Log 'OK' 'rollback restauré'}catch{Log 'ERREUR' ('rollback impossible : '+$_.Exception.Message)}
}finally{ReleaseLock;try{Remove-Item $TempRoot -Recurse -Force -ErrorAction SilentlyContinue}catch{}}
