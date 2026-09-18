$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$testRoot=Join-Path $root ('.installer-test-update-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$env:SDIS_COLLEAGUES_TEST_DIR=$testRoot
$source=Join-Path $testRoot 'app.cs'
[IO.File]::WriteAllText($source,'class App { static void Main() { System.Threading.Thread.Sleep(3000); } }')
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$exe=Join-Path $testRoot 'app.exe'
& $compiler /nologo /target:winexe /platform:x64 /out:$exe $source
if($LASTEXITCODE -ne 0){throw 'Compilation du test impossible.'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
function RunCase([string]$name,[bool]$failTask){
 $caseRoot=Join-Path $testRoot $name
 $install=Join-Path $caseRoot 'installed'
 $payload=Join-Path $caseRoot 'payload'
 $temp=Join-Path $caseRoot 'updater'
 foreach($dir in @($install,$payload,$temp)){New-Item -ItemType Directory -Path $dir | Out-Null}
 Copy-Item -LiteralPath $exe -Destination (Join-Path $install 'SDIS-Collegues.exe')
 Copy-Item -LiteralPath $exe -Destination (Join-Path $payload 'SDIS-Collegues.exe')
 [IO.File]::WriteAllText((Join-Path $install 'old.txt'),'original preserved')
 [IO.File]::WriteAllText((Join-Path $payload 'app-version.json'),'{"version":"1.0.43"}')
 $taskCode=if($failTask){"throw 'simulated task failure'"}else{'param($InstallRoot)'}
 [IO.File]::WriteAllText((Join-Path $payload 'configure-background-task.ps1'),$taskCode)
 $zip=Join-Path $caseRoot 'package.zip'
 [IO.Compression.ZipFile]::CreateFromDirectory($payload,$zip)
 $lock=Join-Path $caseRoot 'update.lock';[IO.File]::WriteAllText($lock,'test')
 $start=[Diagnostics.ProcessStartInfo]::new()
 $start.FileName=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
 $start.Arguments='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $root 'update-helper.ps1')+'" -Package "'+$zip+'" -InstallRoot "'+$install+'" -Exe "'+(Join-Path $install 'SDIS-Collegues.exe')+'" -UpdateLock "'+$lock+'" -ExpectedVersion 1.0.43 -TempRoot "'+$temp+'"'
 $start.WorkingDirectory=$install;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
 $process=[Diagnostics.Process]::Start($start)
 if(-not $process.WaitForExit(20000)){throw 'Timeout du test de mise à jour.'}
 $process.Dispose()
 if(Test-Path -LiteralPath $lock){throw 'Verrou non libéré.'}
 if($failTask){if([IO.File]::ReadAllText((Join-Path $install 'old.txt')) -ne 'original preserved'){throw 'Ancienne installation perdue.'}}
 else{if((Get-Content (Join-Path $install 'app-version.json') -Raw|ConvertFrom-Json).version -ne '1.0.43'){throw 'Version non remplacée.'}}
 Write-Output ('PASS: '+$name)
}
RunCase 'replace-from-locked-working-directory' $false
RunCase 'rollback-after-task-failure' $true
