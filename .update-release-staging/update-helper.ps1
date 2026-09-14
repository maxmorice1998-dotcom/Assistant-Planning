param([Parameter(Mandatory=$true)][string]$Package,[Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$Exe,[Parameter(Mandatory=$true)][int]$ParentPid,[string]$UpdateLock,[string]$ExpectedVersion)
$ErrorActionPreference='Stop'
$log=Join-Path $env:LOCALAPPDATA 'SDIS-Bot-Collegues\assistant-planning.log'
function Log([string]$stage,[string]$message=''){try{$dir=Split-Path $log -Parent;New-Item -ItemType Directory -Force -Path $dir|Out-Null;$clean=($message -replace '[\r\n]+',' ').Substring(0,[Math]::Min(500,($message -replace '[\r\n]+',' ').Length));Add-Content -LiteralPath $log -Value ('[UPDATE] '+(Get-Date).ToString('o')+' | '+$stage+$(if($clean){' | '+$clean}else{''})) -Encoding UTF8}catch{}}
Log 'helper demarre'
$work=Join-Path ([IO.Path]::GetTempPath()) ('assistant-planning-stage-'+[guid]::NewGuid().ToString('N'))
$stage=Join-Path $work 'stage';$backup=Join-Path $work 'backup'
$copied=@();$backed=@()
$step='initialisation'
function SafeRelative([string]$base,[string]$full){$b=(Resolve-Path -LiteralPath $base).Path.TrimEnd('\')+'\';$f=(Resolve-Path -LiteralPath $full).Path;if(-not $f.StartsWith($b,[StringComparison]::OrdinalIgnoreCase)){throw 'Chemin de package invalide.'};return $f.Substring($b.Length)}
try{
 $step='extraction';New-Item -ItemType Directory -Force -Path $stage,$backup|Out-Null
 Expand-Archive -LiteralPath $Package -DestinationPath $stage -Force
 if(-not(Test-Path -LiteralPath (Join-Path $stage 'SDIS-Collegues.exe'))){throw 'Package incomplet.'}
 Log 'extraction reussie'
 $step='arret des processus';while(Get-Process -Id $ParentPid -ErrorAction SilentlyContinue){Start-Sleep -Milliseconds 250}
 Log 'processus arretes'
 $files=Get-ChildItem -LiteralPath $stage -File -Recurse
 $step='validation package';foreach($f in $files){$rel=SafeRelative $stage $f.FullName;if($rel -match '(^|[\\/])\.\.?([\\/]|$)'){throw 'Chemin de package invalide.'}}
 $step='sauvegarde';foreach($f in $files){$rel=SafeRelative $stage $f.FullName;$dest=Join-Path $InstallRoot $rel;if(Test-Path -LiteralPath $dest){$b=Join-Path $backup $rel;New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($b))|Out-Null;Copy-Item -LiteralPath $dest -Destination $b -Force;$backed+=$rel}}
 $step='remplacement';foreach($f in $files){$rel=SafeRelative $stage $f.FullName;$dest=Join-Path $InstallRoot $rel;New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($dest))|Out-Null;Copy-Item -LiteralPath $f.FullName -Destination $dest -Force;$copied+=$rel}
 Log 'fichiers remplaces'
 $step='validation version';$versionFile=Join-Path $InstallRoot 'app-version.json';$versionText=[IO.File]::ReadAllText($versionFile,[Text.Encoding]::UTF8).TrimStart([char]0xFEFF);$installedVersion=$versionText|ConvertFrom-Json;if(-not $installedVersion.version){throw 'Version locale absente apres remplacement.'};if($ExpectedVersion -and ([string]$installedVersion.version -ne $ExpectedVersion)){throw ('Version installee inattendue : '+[string]$installedVersion.version)};Log 'version locale mise a jour' ([string]$installedVersion.version)
 $step='redemarrage';Start-Process -FilePath $Exe -ArgumentList '--skip-update' -WorkingDirectory $InstallRoot
 Log 'application redemarree'
}catch{
 Log ('mise a jour en erreur ('+$step+')') $_.Exception.Message
 try{foreach($rel in $copied){if($backed -notcontains $rel){Remove-Item -LiteralPath (Join-Path $InstallRoot $rel) -Force -ErrorAction SilentlyContinue}};foreach($b in Get-ChildItem -LiteralPath $backup -File -Recurse){$rel=SafeRelative $backup $b.FullName;$dest=Join-Path $InstallRoot $rel;New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($dest))|Out-Null;Copy-Item -LiteralPath $b.FullName -Destination $dest -Force};Start-Process -FilePath $Exe -ArgumentList '--skip-update' -WorkingDirectory $InstallRoot}catch{}
}finally{try{Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue}catch{};if($UpdateLock){try{Remove-Item -LiteralPath $UpdateLock -Force -ErrorAction SilentlyContinue}catch{}}}
