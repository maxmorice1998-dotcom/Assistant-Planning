$ErrorActionPreference = 'Stop'
$workspace = $PSScriptRoot
$testRoot = Join-Path $workspace ('.t-' + [Guid]::NewGuid().ToString('N').Substring(0, 6))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$installer = Join-Path $workspace 'INSTALLER Assistant Planning.exe'
$assembly = [Reflection.Assembly]::LoadFile($installer)
$install = $assembly.GetType('InstallerForm').GetMethod('InstallPackage', [Reflection.BindingFlags]'NonPublic,Static')
function Assert($condition, $message) { if (-not $condition) { throw $message } }
function Invoke-Install([string]$zip, [string]$destination, [string[]]$links, [Action[string]]$launch) {
  $arguments = New-Object object[] 4
  $arguments[0] = $zip
  $arguments[1] = $destination
  $arguments[2] = $links
  $arguments[3] = $launch
  $install.Invoke($null, $arguments)
}

# Read the actual rebuilt executable's appended payload.
$zip = Join-Path $testRoot 'payload.zip'
$inputStream = [IO.File]::OpenRead($installer)
try {
  $inputStream.Seek(-16, [IO.SeekOrigin]::End) | Out-Null
  $footer = New-Object byte[] 16
  Assert ($inputStream.Read($footer, 0, 16) -eq 16) 'Footer incomplet'
  Assert ([Text.Encoding]::ASCII.GetString($footer, 0, 8) -eq 'SDISPKG1') 'Footer invalide'
  $remaining = [BitConverter]::ToInt64($footer, 8)
  Assert ($remaining -gt 0 -and $remaining -lt $inputStream.Length - 16) 'Taille invalide'
  $inputStream.Seek(-16 - $remaining, [IO.SeekOrigin]::End) | Out-Null
  $outputStream = [IO.File]::Create($zip)
  try {
    $buffer = New-Object byte[] 1048576
    while ($remaining -gt 0) {
      $read = $inputStream.Read($buffer, 0, [int][Math]::Min($remaining, $buffer.Length))
      Assert ($read -gt 0) 'Payload tronqué'
      $outputStream.Write($buffer, 0, $read)
      $remaining -= $read
    }
  } finally { $outputStream.Dispose() }
} finally { $inputStream.Dispose() }

$destination = Join-Path $testRoot 'app'
$links = [string[]]@('Programs', 'Desktop', 'Startup' | ForEach-Object { Join-Path $testRoot ($_ + '\Assistant Planning.lnk') })
$script:launchTarget = $null
Invoke-Install $zip $destination $links ([Action[string]]{ param($app) $script:launchTarget = $app })
$expected = Join-Path $destination 'SDIS-Collegues.exe'
Assert ($script:launchTarget -eq $expected -and (Test-Path -LiteralPath $expected)) 'Chemin de lancement incorrect'
Assert ((Get-FileHash -LiteralPath $expected).Hash -eq (Get-FileHash -LiteralPath (Join-Path $workspace 'SDIS-Collegues.exe')).Hash) 'EXE installé différent'
$shell = New-Object -ComObject WScript.Shell
foreach ($path in $links) {
  $link = $shell.CreateShortcut($path)
  Assert ($link.TargetPath -eq $expected) 'Cible raccourci incorrecte'
  Assert ($link.WorkingDirectory -eq $destination) 'Dossier de travail incorrect'
}
Write-Output 'PASS: installation du payload final et trois raccourcis'

# Exercise the real installed EXE through its shortcut using its existing preview mode.
$preview = Join-Path $testRoot 'installed-preview.png'
$link = $shell.CreateShortcut($links[1])
$link.Arguments = '--preview "' + $preview + '"'
$link.WindowStyle = 7
$link.Save()
$previousTestDir = $env:SDIS_COLLEAGUES_TEST_DIR
try {
  $env:SDIS_COLLEAGUES_TEST_DIR = Join-Path $destination 'test-data'
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $links[1]
  $start.UseShellExecute = $true
  $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $process = [Diagnostics.Process]::Start($start)
  if ($process) { Assert ($process.WaitForExit(30000)) 'Démarrage trop long'; Assert ($process.ExitCode -eq 0) 'EXE en erreur' }
  Assert (Test-Path -LiteralPath $preview) 'Aperçu non produit par le raccourci'
} finally {
  $env:SDIS_COLLEAGUES_TEST_DIR = $previousTestDir
  $link.Arguments = ''
  $link.Save()
}
Write-Output 'PASS: lancement du véritable EXE installé via le raccourci'

# Small valid payload for deterministic transaction failure tests.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$fixture = Join-Path $testRoot 'fixture'
New-Item -ItemType Directory -Path (Join-Path $fixture 'runtime\browser'), (Join-Path $fixture 'runtime\node') | Out-Null
[IO.File]::WriteAllText((Join-Path $fixture 'SDIS-Collegues.exe'), 'new')
[IO.File]::WriteAllText((Join-Path $fixture 'runtime\node\node.exe'), 'fixture')
$fixtureZip = Join-Path $testRoot 'fixture.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($fixture, $fixtureZip)
foreach ($existing in @($false, $true)) {
  $target = Join-Path $testRoot ('rollback-' + $existing)
  $shortcut = Join-Path $testRoot ('rollback-' + $existing + '.lnk')
  if ($existing) {
    New-Item -ItemType Directory -Path $target | Out-Null
    [IO.File]::WriteAllText((Join-Path $target 'old.txt'), 'previous installation')
    [IO.File]::WriteAllText($shortcut, 'previous shortcut')
  }
  $failed = $false
  try { Invoke-Install $fixtureZip $target @($shortcut) ([Action[string]]{ throw 'Injected launch failure' }) }
  catch { $failed = $true }
  Assert $failed 'Échec attendu absent'
  if ($existing) {
    Assert ([IO.File]::ReadAllText((Join-Path $target 'old.txt')) -eq 'previous installation') 'Ancienne installation perdue'
    Assert ([IO.File]::ReadAllText($shortcut) -eq 'previous shortcut') 'Ancien raccourci perdu'
    Assert (-not (Test-Path -LiteralPath (Join-Path $target 'SDIS-Collegues.exe'))) 'Nouvelle installation non retirée'
  } else {
    Assert (-not (Test-Path -LiteralPath $target)) 'Première installation partielle conservée'
    Assert (-not (Test-Path -LiteralPath $shortcut)) 'Raccourci partiel conservé'
  }
}
Write-Output 'PASS: rollback après échec de lancement, installation neuve et remplacement'

$target = Join-Path $testRoot 'rollback-shortcut'
$goodLink = Join-Path $testRoot 'partial.lnk'
$blocker = Join-Path $testRoot 'not-a-directory'
[IO.File]::WriteAllText($blocker, 'block shortcut creation')
New-Item -ItemType Directory -Path $target | Out-Null
[IO.File]::WriteAllText((Join-Path $target 'old.txt'), 'previous')
$failed = $false
try { Invoke-Install $fixtureZip $target @($goodLink, (Join-Path $blocker 'bad.lnk')) ([Action[string]]{ throw 'Must not launch' }) }
catch { $failed = $true }
Assert $failed 'Échec de création du raccourci absent'
Assert ([IO.File]::ReadAllText((Join-Path $target 'old.txt')) -eq 'previous') 'Rollback après raccourci défaillant incorrect'
Assert (-not (Test-Path -LiteralPath $goodLink)) 'Raccourci partiel non retiré'
Write-Output 'PASS: rollback après création partielle des raccourcis'

# Lock a newly installed file: rollback must preserve the old backup if removal fails.
$target = Join-Path $testRoot 'rollback-locked'
New-Item -ItemType Directory -Path $target | Out-Null
[IO.File]::WriteAllText((Join-Path $target 'old.txt'), 'recoverable')
$script:locked = $null
$failed = $false
try {
  Invoke-Install $fixtureZip $target @() ([Action[string]]{
    param($app)
    $script:locked = [IO.File]::Open($app, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    throw 'Injected failure with locked file'
  })
} catch { $failed = $true }
finally { if ($script:locked) { $script:locked.Dispose() } }
Assert $failed 'Échec verrouillé absent'
$backups = @(Get-ChildItem -LiteralPath $testRoot -Directory -Filter 'rollback-locked.backup-*')
Assert ($backups.Count -eq 1) 'Sauvegarde supprimée après échec de restauration'
Assert ([IO.File]::ReadAllText((Join-Path $backups[0].FullName 'old.txt')) -eq 'recoverable') 'Sauvegarde endommagée'
Write-Output 'PASS: sauvegarde conservée lorsque le rollback est empêché'
[pscustomobject]@{ installer = $installer; sha256 = (Get-FileHash -LiteralPath $installer).Hash; testRoot = $testRoot; result = 'PASS' } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $workspace 'installer-test-result.json')
Write-Output ('Preuves : ' + $testRoot)
