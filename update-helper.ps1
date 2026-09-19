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
function WriteProgress([int]$percent,[string]$stage){try{[IO.File]::WriteAllText($progressFile,(@{percent=$percent;stage=$stage}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))}catch{}}
function ExpandPackage([string]$zip,[string]$destination){
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  New-Item -ItemType Directory -Force -Path $destination|Out-Null
  $root=[IO.Path]::GetFullPath($destination).TrimEnd('\')+'\'
  $archive=[IO.Compression.ZipFile]::OpenRead($zip)
  try{
    $files=@($archive.Entries|Where-Object{-not[String]::IsNullOrEmpty($_.Name)})
    $total=[double](($files|Measure-Object Length -Sum).Sum);if($total-le0){$total=1};$done=[double]0;$last=0
    foreach($entry in $archive.Entries){
      $target=[IO.Path]::GetFullPath((Join-Path $destination ($entry.FullName-replace'/','\')))
      if(-not$target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Package invalide.'}
      if([String]::IsNullOrEmpty($entry.Name)){New-Item -ItemType Directory -Force -Path $target|Out-Null;continue}
      New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($target))|Out-Null
      $input=$entry.Open();$output=[IO.File]::Create($target)
      try{$buffer=New-Object byte[] 1048576;while(($read=$input.Read($buffer,0,$buffer.Length))-gt0){$output.Write($buffer,0,$read);$done+=$read;$now=[Environment]::TickCount;if($now-$last-ge250){WriteProgress ([Math]::Min(94,[int]($done*94/$total))) 'Extraction des composants';$last=$now}}}finally{$output.Dispose();$input.Dispose()}
    }
  }finally{$archive.Dispose()}
}
function Running([string]$path){$full=[IO.Path]::GetFullPath($path);@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{$_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $full}).Count -gt 0}
function WaitClosed([string]$path){$end=(Get-Date).AddSeconds(60);while((Get-Date)-lt $end){if(-not(Running $path)){return};Start-Sleep -Milliseconds 250};throw 'Assistant Planning ne s est pas ferme.'}
function CloseProgramProcesses([string]$root){
  $prefix=[IO.Path]::GetFullPath($root).TrimEnd('\')+'\'
  $end=(Get-Date).AddSeconds(30)
  do{
    $owned=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{
      $_.ProcessId -ne $PID -and $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)
    })
    if(-not $owned.Count){return}
    foreach($process in $owned){
      Log 'OK' ('fermeture processus programme '+$process.Name+' PID='+$process.ProcessId)
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 250
  }while((Get-Date)-lt $end)
  throw 'Des processus Assistant Planning bloquent encore la mise a jour.'
}
function StartChecked([string]$path){$p=Start-Process -FilePath $path -ArgumentList '--skip-update' -WorkingDirectory (Split-Path $path -Parent) -WindowStyle Normal -PassThru;Start-Sleep -Seconds 2;if($p.HasExited -and $p.ExitCode -ne 0){throw ('Demarrage echoue (code '+$p.ExitCode+').')}}
$install=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$backup=$install+'.backup-'+[guid]::NewGuid().ToString('N');$new=Join-Path $TempRoot 'Assistant Planning';$sw=[Diagnostics.Stopwatch]::StartNew()
$movedOld=$false;$installedNew=$false
$resolvedTemp=[IO.Path]::GetFullPath($TempRoot).TrimEnd('\')
$progressDone=$UpdateLock+'.finished'
$progressFile=Join-Path $TempRoot 'update-install-progress.json'
$progressScript=Join-Path $TempRoot 'update-progress-window.ps1'
if($install -eq [IO.Path]::GetPathRoot($install).TrimEnd('\') -or $resolvedTemp -eq [IO.Path]::GetPathRoot($resolvedTemp).TrimEnd('\') -or $install.Equals($resolvedTemp,[StringComparison]::OrdinalIgnoreCase) -or $install.StartsWith($resolvedTemp+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Dossiers de mise a jour incorrects.'}
try{
  Set-Location -LiteralPath $TempRoot
  [Environment]::CurrentDirectory=[IO.Path]::GetFullPath($TempRoot)
  try{if(Test-Path -LiteralPath $progressDone){[IO.File]::Delete($progressDone)}}catch{}
  WriteProgress 0 'Preparation de la mise a jour'
  if(Test-Path -LiteralPath $progressScript){try{Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$progressScript,'-DoneFile',$progressDone,'-ProgressFile',$progressFile,'-Version',$ExpectedVersion,'-LogoFile',(Join-Path $TempRoot 'udsp14-logo.png')) -WindowStyle Hidden|Out-Null}catch{}}
  New-Item -ItemType Directory -Force -Path $new|Out-Null
  Log 'OK' ('extraction package '+$ExpectedVersion)
  ExpandPackage $Package $new
  if(-not(Test-Path (Join-Path $new 'SDIS-Collegues.exe'))){throw 'Package complet incomplet.'}
  Log 'OK' 'package extrait et verifie'
  WaitClosed $Exe
  CloseProgramProcesses $install
  WriteProgress 96 'Remplacement de l application'
  Log 'OK' 'application et processus embarques fermes'
  if(Test-Path -LiteralPath $install){Move-Item -LiteralPath $install -Destination $backup;$movedOld=$true}
  Move-Item -LiteralPath $new -Destination $install;$installedNew=$true
  WriteProgress 98 'Configuration de la nouvelle version'
  $v=Get-Content (Join-Path $install 'app-version.json') -Raw|ConvertFrom-Json
  if([string]$v.version -ne $ExpectedVersion){throw ('Version installee inattendue : '+$v.version)}
  $taskScript=Join-Path $install 'configure-background-task.ps1'
  if(-not(Test-Path -LiteralPath $taskScript)){throw 'Configuration du demarrage automatique absente.'}
  try{& $taskScript -InstallRoot $install}catch{Log 'AVERTISSEMENT' ('demarrage automatique non reconfigure : '+$_.Exception.Message)}
  WriteProgress 99 'Redemarrage d Assistant Planning'
  StartChecked (Join-Path $install 'SDIS-Collegues.exe')
  WriteProgress 100 'Mise a jour terminee'
  Log 'OK' ('installation '+$ExpectedVersion+' et redemarrage reussis en '+[math]::Round($sw.Elapsed.TotalSeconds,1)+' s')
  try{Remove-Item $backup -Recurse -Force -ErrorAction SilentlyContinue}catch{Log 'OK' 'backup conserve temporairement'}
}catch{
  Log 'ERREUR' ($_.InvocationInfo.PositionMessage+' | '+$_.Exception.Message)
  try{
    if($installedNew -and (Test-Path -LiteralPath $install)){
      CloseProgramProcesses $install
      if([IO.Path]::GetFullPath($install) -ne [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')){throw 'Destination de restauration incorrecte.'}
      Remove-Item -LiteralPath $install -Recurse -Force
    }
    if($movedOld){Move-Item -LiteralPath $backup -Destination $install}
    if(($movedOld -or $installedNew) -and (Test-Path -LiteralPath (Join-Path $install 'SDIS-Collegues.exe'))){StartChecked (Join-Path $install 'SDIS-Collegues.exe')}
    Log 'OK' 'ancienne installation conservee ou restauree'
  }catch{Log 'ERREUR' ('rollback impossible : '+$_.Exception.Message)}
}finally{
  try{[IO.File]::WriteAllText($progressDone,'done')}catch{}
  ReleaseLock
  try{
    Set-Location -LiteralPath $env:TEMP
    [Environment]::CurrentDirectory=$env:TEMP
    if([IO.Path]::GetFullPath($TempRoot).TrimEnd('\') -eq $resolvedTemp){Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue}
  }catch{}
}
