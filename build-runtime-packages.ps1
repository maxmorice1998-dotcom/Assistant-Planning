$ErrorActionPreference='Stop'
$root=$PSScriptRoot
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Build-Runtime([string]$name,[string]$version,[string]$source,[string]$exe,[string]$archiveName=$name){
 if(-not(Test-Path $exe)){throw "Runtime $name absent."}
 $finger=(Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
 $info=[ordered]@{type=$name;version=$version;fingerprint=$finger;generatedAt=(Get-Date).ToString('o')}
 $infoPath=Join-Path $source 'runtime-info.json';[IO.File]::WriteAllText($infoPath,($info|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 $stage=Join-Path $root ('.runtime-stage-'+$name+'-'+[guid]::NewGuid().ToString('N'));$runtimeRoot=Join-Path $stage 'runtime';New-Item -ItemType Directory -Force -Path $runtimeRoot|Out-Null;Copy-Item $source (Join-Path $runtimeRoot $archiveName) -Recurse
 $zip=Join-Path $root ("AssistantPlanning-runtime-{0}-{1}.zip" -f $name,$version);$candidate=$zip+'.new';if(Test-Path $candidate){Remove-Item $candidate -Force};[IO.Compression.ZipFile]::CreateFromDirectory($stage,$candidate,[IO.Compression.CompressionLevel]::Optimal,$false);Move-Item $candidate $zip -Force;Remove-Item $stage -Recurse -Force
 [pscustomobject]@{type=$name;version=$version;path=$zip;size=(Get-Item $zip).Length;sha256=(Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant();fingerprint=$finger}
}
$nodeExe=Join-Path $root 'runtime\node\node.exe';$nodeVersion=(( & $nodeExe --version) -replace '^v','').Trim();$browser=Get-ChildItem (Join-Path $root 'runtime\browser') -Filter chrome.exe -File -Recurse|Select-Object -First 1;if(-not$browser){throw 'Chromium absent.'};$browserVersion='148.0.7778.167';$node=Build-Runtime 'node' $nodeVersion (Join-Path $root 'runtime\node') $nodeExe 'node';$chrome=Build-Runtime 'chromium' $browserVersion (Join-Path $root 'runtime\browser') $browser.FullName 'browser';$node;$chrome
