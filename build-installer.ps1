$ErrorActionPreference='Stop'
$binaryRoot=Join-Path $PSScriptRoot ('.installer-binaries-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $binaryRoot | Out-Null
& "$PSScriptRoot\build.ps1" -OutputRoot $binaryRoot
$version=(Get-Content "$PSScriptRoot\app-version.json" -Raw | ConvertFrom-Json).version
& "$PSScriptRoot\build-app.ps1" -Version $version -BinaryRoot $binaryRoot
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$stub=Join-Path $PSScriptRoot '.installer-stub.exe'
$candidate=Join-Path $PSScriptRoot '.installer-candidate.exe'
$assemblyInfo=Join-Path $binaryRoot 'installer-version.cs'
[IO.File]::WriteAllText($assemblyInfo,('[assembly:System.Reflection.AssemblyVersion("'+$version+'.0")][assembly:System.Reflection.AssemblyFileVersion("'+$version+'.0")][assembly:System.Reflection.AssemblyInformationalVersion("'+$version+'") ]'),[Text.UTF8Encoding]::new($false))
try {
 & $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /resource:"$PSScriptRoot\assets\udsp14-logo.png",udsp14-logo.png /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:Microsoft.CSharp.dll /out:$stub "$PSScriptRoot\Assistant-Planning-Installer.cs" $assemblyInfo
 if($LASTEXITCODE -ne 0){throw 'Compilation de l’installateur impossible.'}
 $output=[IO.File]::Create($candidate)
 $stubStream=[IO.File]::OpenRead($stub)
 $payload=[IO.File]::OpenRead((Join-Path $PSScriptRoot 'AssistantPlanning-app.zip'))
 try {
  $stubStream.CopyTo($output);$payload.CopyTo($output)
  $magic=[Text.Encoding]::ASCII.GetBytes('SDISPKG1')
  $length=[BitConverter]::GetBytes([int64]$payload.Length)
  $output.Write($magic,0,8);$output.Write($length,0,8)
 } finally {$output.Dispose();$stubStream.Dispose();$payload.Dispose()}
 Move-Item -LiteralPath $candidate -Destination (Join-Path $PSScriptRoot 'INSTALLER Assistant Planning.exe') -Force
} finally {
 foreach($file in @($stub,$candidate)){if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force}}
 if([IO.Path]::GetFullPath($binaryRoot).StartsWith([IO.Path]::GetFullPath($PSScriptRoot)+'\',[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $binaryRoot -Recurse -Force}
}
