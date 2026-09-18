$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$repository='maxmorice1998-dotcom/Assistant-Planning'
$version=(Get-Content "$root\app-version.json" -Raw | ConvertFrom-Json).version
$tag='v'+$version
$app=Join-Path $root 'AssistantPlanning-app.zip'
$installer=Join-Path $root 'INSTALLER Assistant Planning.exe'
$manifestPath=Join-Path $root 'update-manifest.json'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($app)
try {
 foreach($name in @('SDIS-Collegues.exe','background-sync.js','configure-background-task.ps1','update-config.json')){
  if(-not $zip.GetEntry($name)){throw "Package incomplet : $name"}
 }
 $reader=[IO.StreamReader]::new($zip.GetEntry('app-version.json').Open())
 try {$packedVersion=($reader.ReadToEnd() | ConvertFrom-Json).version} finally {$reader.Dispose()}
 if($packedVersion -ne $version){throw 'Version du package incorrecte.'}
 if(@($zip.Entries | Where-Object {$_.FullName -match '(^|/)(profiles|secrets|logs)/|\.dpapi$|(^|/)(colleague-config|alert|dendreo-config)\.json$'}).Count){throw 'Données privées dans le package.'}
} finally {$zip.Dispose()}
if(-not(Test-Path -LiteralPath $installer)){throw 'Installateur absent.'}
$manifest=[ordered]@{version=$version;channel='stable';app=[ordered]@{version=$version;url="https://github.com/$repository/releases/download/$tag/AssistantPlanning-app.zip";sha256=(Get-FileHash $app -Algorithm SHA256).Hash.ToLowerInvariant();size=(Get-Item $app).Length}}
[IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$token=$env:GITHUB_TOKEN
if(-not $token){$token=$env:GH_TOKEN}
if(-not $token){
 $credential="protocol=https`nhost=github.com`n`n" | git credential fill
 foreach($line in $credential){if($line.StartsWith('password=')){$token=$line.Substring(9)}}
}
if(-not $token){throw 'Identifiant GitHub indisponible.'}
$headers=@{Authorization="Bearer $token";Accept='application/vnd.github+json';'User-Agent'='Assistant-Planning-Publisher'}
$api="https://api.github.com/repos/$repository"
try {$existing=Invoke-RestMethod "$api/releases/tags/$tag" -Headers $headers} catch {if($_.Exception.Response.StatusCode.value__ -ne 404){throw};$existing=$null}
if($existing){throw "La version $tag existe déjà. Choisir une nouvelle version."}
$notes="Synchronisation automatique silencieuse à chaque ouverture de session Windows. La tâche planifiée est créée ou mise à jour lors de l’installation et de la mise à jour, avec le chemin réel de l’application. Le moteur, les configurations, les logs et l’envoi d’e-mails existants sont réutilisés."
$body=@{tag_name=$tag;name="Assistant Planning $tag";target_commitish=(git rev-parse HEAD).Trim();draft=$true;body=$notes} | ConvertTo-Json
$release=Invoke-RestMethod "$api/releases" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
foreach($file in @($app,$installer,$manifestPath)){
 $name=[IO.Path]::GetFileName($file)
 $upload="https://uploads.github.com/repos/$repository/releases/$($release.id)/assets?name=$([Uri]::EscapeDataString($name))"
 $asset=Invoke-RestMethod $upload -Method Post -Headers $headers -ContentType 'application/octet-stream' -InFile $file -TimeoutSec 1800
 if([long]$asset.size -ne (Get-Item $file).Length){throw "Taille distante incorrecte : $name"}
 if($asset.digest -and $asset.digest -ne ('sha256:'+(Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant())){throw "Empreinte distante incorrecte : $name"}
 Write-Output "Téléversé et vérifié : $name"
}
$published=Invoke-RestMethod "$api/releases/$($release.id)" -Method Patch -Headers $headers -ContentType 'application/json' -Body '{"draft":false,"make_latest":"true"}'
$remote=Invoke-RestMethod "https://github.com/$repository/releases/latest/download/update-manifest.json?cb=$([DateTime]::UtcNow.Ticks)"
if($remote.version -ne $version -or $remote.app.sha256 -ne $manifest.app.sha256){throw 'Manifest public incorrect.'}
Write-Output "Publication vérifiée : $($published.html_url)"
