param([string]$Version='1.0.3')
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$info=Get-Content -LiteralPath (Join-Path $root 'app-version.json') -Raw | ConvertFrom-Json
if($info.version -ne $Version -or -not $info.build){throw 'Version/build incoherent.'}
$stage=Join-Path $root ('.update-stage-'+$Version+'-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
# Paquet de mise a jour : jamais de configuration utilisateur ou de connecteur.
# Les valeurs deja installees restent en place, notamment update-config.json.
$files=@(
 'SDIS-Collegues.exe','SDIS-Collegues-Bridge.exe','AssistantPlanning-Agent.exe',
 'runtime-config.js','ui-backend.js','browser-manager.js','browser-client.js','colleague-runner.js',
 'check-agatt-alerts.js','check-dendreo-alerts.js','cleanup-dendreo-stale.js','dendreo-state.js',
 'ensure-dendreo-browser.js','login-agatt.js','send-combined-alerts.js','sync.js','sync-dendreo.js','sdis-utils.js',
 'google-oauth.js','google-oauth-v2.js','update-client.js','update-helper.ps1','verify-browser.ps1',
 'app-version.json','package.json','package-lock.json'
)
foreach($file in $files){Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $stage $file)}
foreach($dir in @('node_modules','runtime\node','runtime\browser','assets')){
 $dest=Join-Path $stage $dir
 New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
 Copy-Item -LiteralPath (Join-Path $root $dir) -Destination $dest -Recurse
}
$forbidden=Get-ChildItem -LiteralPath $stage -File -Recurse -Force | Where-Object {
 $_.Extension -eq '.dpapi' -or $_.Name -match '^(token|credentials|client_secret).*\.json$' -or
 $_.FullName -match '\\(profiles|secrets|logs)(\\|$)' -or
 $_.Name -in @('update-config.json','google-oauth-config.json','colleague-config.json','dendreo-config.json','alert.json')
}
if($forbidden){throw 'Configuration privee interdite dans la mise a jour.'}
$zip=Join-Path $root 'AssistantPlanning-update.zip'
$candidate=Join-Path $root ('AssistantPlanning-update-'+$Version+'.new.zip')
if(Test-Path -LiteralPath $candidate){throw 'ZIP candidat deja present.'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$candidate,[IO.Compression.CompressionLevel]::Optimal,$false)
$archive=[IO.Compression.ZipFile]::OpenRead($candidate)
try{
 foreach($file in $files){if(-not $archive.GetEntry($file)){throw ('Fichier absent du ZIP : '+$file)}}
 $entry=$archive.GetEntry('app-version.json');$reader=[IO.StreamReader]::new($entry.Open())
 try{$embedded=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
 if($embedded.version -ne $Version -or $embedded.build -ne $info.build){throw 'Version embarquee invalide.'}
}finally{$archive.Dispose()}
if(Test-Path -LiteralPath $zip){Copy-Item -LiteralPath $zip -Destination (Join-Path $root ('AssistantPlanning-update.previous-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.zip'))}
Copy-Item -LiteralPath $candidate -Destination $zip -Force
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest=[ordered]@{
 version=$Version;build=$info.build
 downloadUrl="https://github.com/maxmorice1998-dotcom/Assistant-Planning/releases/download/v$Version/AssistantPlanning-update.zip"
 sha256=$hash;channel='stable'
 notes='Correction Dendreo : dates AGATT, detection par identifiant, doublons bot verifies et relecture serveur.'
}
[IO.File]::WriteAllText((Join-Path $root 'update-manifest.json'),($manifest|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $root ('v'+$Version+'-build-result.json')),([ordered]@{version=$Version;build=$info.build;sha256=$hash;zip=$zip;stage=$stage;manifest=(Join-Path $root 'update-manifest.json')}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
Remove-Item -LiteralPath $candidate
Write-Output ('ZIP final : '+$zip)
Write-Output ('SHA256 : '+$hash)
