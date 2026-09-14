$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Accueil\Desktop\sdis-bot-installateur'
$stage = Join-Path $root '.package-staging'
$zip = Join-Path $root '.assistant-planning-package.zip'
$stub = Join-Path $root '.assistant-planning-installer.stub.exe'
$final = Join-Path $root 'INSTALLER Assistant Planning.exe'
$candidate = Join-Path $root '.assistant-planning-installer.new.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path -LiteralPath $compiler)) { throw 'Compilateur Windows absent.' }
function Read-JsonFile([string]$path) {
  $text = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
  return $text | ConvertFrom-Json
}
function Write-JsonUtf8NoBom([string]$path, $value) {
  $text = $value | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}
$oauthPath = Join-Path $root 'google-oauth-config.json'
$oauth = Read-JsonFile $oauthPath
$desktopPath = Join-Path $root 'google-desktop-oauth.json'
if (Test-Path -LiteralPath $desktopPath) {
  $desktop = (Read-JsonFile $desktopPath).installed
  if (-not $desktop.client_id -or -not $desktop.client_secret) { throw 'Le fichier distributeur doit correspondre à une application OAuth Desktop.' }
  if ($oauth.clientId -ne $desktop.client_id) { throw 'Le Client ID du fichier Desktop ne correspond pas à celui de cette application.' }
  $oauth | Add-Member -NotePropertyName clientSecret -NotePropertyValue $desktop.client_secret -Force
}
if (-not $oauth.clientId -or -not $oauth.clientSecret) { throw 'Package Google incomplet : paramètres OAuth Desktop du distributeur manquants. Installateur précédent conservé.' }
foreach ($p in @($stage,$zip,$stub,$candidate)) {
  if (-not [IO.Path]::GetFullPath($p).StartsWith([IO.Path]::GetFullPath($root) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Chemin de fabrication hors workspace.' }
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
}
New-Item -ItemType Directory -Path $stage | Out-Null

$files = @(
  'SDIS-Collegues.exe','AssistantPlanning-Agent.exe','AssistantPlanning-Updater.exe','SDIS-Collegues-Bridge.exe','runtime-config.js','ui-backend.js','browser-manager.js',
  'browser-client.js','colleague-runner.js','check-agatt-alerts.js','check-dendreo-alerts.js','cleanup-dendreo-stale.js',
  'ensure-dendreo-browser.js','login-agatt.js','send-combined-alerts.js','sync.js','sync-dendreo.js','sdis-utils.js','dendreo-state.js',
  'google-oauth.js','google-oauth-v2.js','update-client.js','update-helper.ps1','update-ui-runner.js','verify-browser.ps1',
  'app-version.json','update-config.json','google-oauth-config.json','colleague-config.json','dendreo-config.json','alert.json',
  'package.json','package-lock.json'
)
foreach ($file in $files) {
  $source = Join-Path $root $file
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Fichier package absent : $file" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $stage $file) -Force
}
# Desktop application credentials are portable application parameters, not user tokens.
Write-JsonUtf8NoBom (Join-Path $stage 'google-oauth-config.json') $oauth
foreach ($dir in @('node_modules','runtime\node','runtime\browser','assets')) {
  $source = Join-Path $root $dir
  if (-not (Test-Path -LiteralPath $source)) { throw "Dossier package absent : $dir" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $stage $dir) -Recurse -Force
}

$forbidden = Get-ChildItem -LiteralPath $stage -Recurse -File -Force | Where-Object {
  $_.Name -match '^(token|credentials|client_secret).*\.json$' -or
  $_.Extension -eq '.dpapi' -or
  $_.FullName -match '\\(profiles|logs|secrets|oauth-secrets)(\\|$)'
}
if ($forbidden) { throw 'Artefact sensible détecté dans le package.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$zip,[IO.Compression.CompressionLevel]::Optimal,$false)
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 `
  /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll `
  /reference:System.IO.Compression.FileSystem.dll /reference:Microsoft.CSharp.dll `
  /out:$stub (Join-Path $root 'Assistant-Planning-Installer.cs')
if ($LASTEXITCODE -ne 0) { throw 'Compilation de l''installateur impossible.' }

$stubStream = [IO.File]::OpenRead($stub)
$zipStream = [IO.File]::OpenRead($zip)
$outStream = [IO.File]::Create($candidate)
try {
  $stubStream.CopyTo($outStream)
  $zipStream.CopyTo($outStream)
  $magic = [Text.Encoding]::ASCII.GetBytes('SDISPKG1')
  $length = [BitConverter]::GetBytes([int64]$zipStream.Length)
  $outStream.Write($magic,0,$magic.Length)
  $outStream.Write($length,0,$length.Length)
} finally {
  $outStream.Dispose();$zipStream.Dispose();$stubStream.Dispose()
}

Remove-Item -LiteralPath $stage,$zip,$stub -Recurse -Force
if (Test-Path -LiteralPath $final) {
  Remove-Item -LiteralPath $final -Force
  [IO.File]::Move($candidate,$final)
} else {
  [IO.File]::Move($candidate,$final)
}
$info = Get-Item -LiteralPath $final
$hash = (Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash
[pscustomobject]@{path=$final;size=$info.Length;sha256=$hash} | ConvertTo-Json -Compress
