param([Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$info=Get-Content (Join-Path $root 'app-version.json') -Raw|ConvertFrom-Json
if([string]$info.version -ne $Version){throw 'Version applicative incoherente.'}
$stage=Join-Path $root ('.app-stage-'+$Version+'-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage|Out-Null
 $files=@('SDIS-Collegues.exe','SDIS-Collegues-Bridge.exe','operation-lock.js','runtime-config.js','ui-backend.js','browser-manager.js','browser-client.js','colleague-runner.js','check-agatt-alerts.js','check-dendreo-alerts.js','cleanup-dendreo-stale.js','dendreo-state.js','ensure-dendreo-browser.js','send-combined-alerts.js','sync.js','sync-dendreo.js','sdis-utils.js','google-oauth-v2.js','update-client.js','update-helper.ps1','verify-browser.ps1','app-version.json','package.json','package-lock.json','google-oauth-config.json')
foreach($file in @('agatt-view.js','planning-model.js','diagnostic-report.js','diagnostic-worker.js','diagnostic-config.json')){$files += $file}
foreach($file in $files){$src=Join-Path $root $file;if(-not(Test-Path -LiteralPath $src -PathType Leaf)){throw "Fichier obligatoire absent : $file"};Copy-Item $src (Join-Path $stage $file)}
foreach($dir in @('node_modules','assets','runtime')){Copy-Item (Join-Path $root $dir) (Join-Path $stage $dir) -Recurse}
$forbidden=Get-ChildItem $stage -File -Recurse|Where-Object{$_.FullName -match '\\(profiles|secrets|logs)(\\|$)' -or $_.Name -in @('update-config.json','colleague-config.json','dendreo-config.json','alert.json')}
if($forbidden){throw 'Donnees utilisateur presentes dans le package application.'}
$zip=Join-Path $root 'AssistantPlanning-app.zip';$candidate=Join-Path $root ('AssistantPlanning-app-'+$Version+'.new-'+[guid]::NewGuid().ToString('N')+'.zip')
if(Test-Path $candidate){Remove-Item $candidate -Force}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$candidate,[IO.Compression.CompressionLevel]::Optimal,$false)
if(Test-Path $zip){Copy-Item $zip (Join-Path $root ('AssistantPlanning-app.previous-'+(Get-Date -Format yyyyMMdd-HHmmss)+'.zip')) -Force}
Move-Item $candidate $zip -Force
$hash=(Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output ("APP ZIP : {0}`nSHA256 : {1}`nSIZE : {2}" -f $zip,$hash,(Get-Item $zip).Length)
Remove-Item $stage -Recurse -Force
