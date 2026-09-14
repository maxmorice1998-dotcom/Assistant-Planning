$ErrorActionPreference='Stop'
$bridge=Join-Path (Split-Path $PSScriptRoot -Parent) 'SDIS-Collegues-Bridge.exe'
function Invoke-Bridge([string]$mode,[string]$value){
 $info=New-Object Diagnostics.ProcessStartInfo
 $info.FileName=$bridge
 $info.Arguments=$mode
 $info.UseShellExecute=$false
 $info.CreateNoWindow=$true
 $info.RedirectStandardInput=$true
 $info.RedirectStandardOutput=$true
 $info.RedirectStandardError=$true
 $p=[Diagnostics.Process]::Start($info)
 $p.StandardInput.Write($value)
 $p.StandardInput.Close()
 $output=$p.StandardOutput.ReadToEnd()
 $p.WaitForExit()
 if($p.ExitCode -ne 0){throw ('Bridge exit: '+$p.ExitCode)}
 return $output
}
$encrypted=Invoke-Bridge '--protect' 'diagnostic-non-secret'
$plain=Invoke-Bridge '--unprotect' $encrypted
[pscustomobject]@{path=$bridge;roundTrip=($plain -eq 'diagnostic-non-secret');encryptedBytes=$encrypted.Length} | ConvertTo-Json
