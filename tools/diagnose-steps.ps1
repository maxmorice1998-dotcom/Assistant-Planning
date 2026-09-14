$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$node=Join-Path $root 'runtime\node\node.exe'
$data=Join-Path $env:LOCALAPPDATA 'SDIS-Bot-Collegues'
$steps=@(
 @{name='login-agatt.js';args=@()},
 @{name='sync.js';args=@()},
 @{name='check-agatt-alerts.js';args=@('after')},
 @{name='sync-dendreo.js';args=@()},
 @{name='check-dendreo-alerts.js';args=@('after')},
 @{name='send-combined-alerts.js';args=@()}
)
function Safe([string]$text){
 $text=[regex]::Replace($text,'(?i)(access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|cookie|bearer|authorization code|code_verifier|eyJ[a-z0-9_-]{10,})[^\s]*','[donnée masquée]')
 return (($text -split "`r?`n" | Where-Object {$_.Trim()} | Select-Object -Last 12) -join ' | ').Substring(0,[Math]::Min(2000,(($text -split "`r?`n" | Where-Object {$_.Trim()} | Select-Object -Last 12) -join ' | ').Length))
}
foreach($step in $steps){
 $out=[IO.Path]::GetTempFileName();$err=[IO.Path]::GetTempFileName()
 try{
  $info=New-Object Diagnostics.ProcessStartInfo; $info.FileName=$node; $info.WorkingDirectory=$data; $info.UseShellExecute=$false; $info.CreateNoWindow=$true; $info.Arguments='"'+(Join-Path $root $step.name)+'" '+(($step.args|ForEach-Object {'"'+$_+'"'}) -join ' ')+' --dry-run'; $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $p=[Diagnostics.Process]::Start($info);$stdoutTask=$p.StandardOutput.ReadToEndAsync();$stderrTask=$p.StandardError.ReadToEndAsync();if(-not $p.WaitForExit(300000)){ $p.Kill();$code=$null }else{$code=$p.ExitCode};$stdout=$stdoutTask.Result;$stderr=$stderrTask.Result
  $result=[pscustomobject]@{step=$step.name;args=$step.args;exitCode=$code;stdout=(Safe $stdout);stderr=(Safe $stderr)}; $result | ConvertTo-Json -Compress
  if($code -ne 0){ break }
 } finally {Remove-Item $out,$err -Force -ErrorAction SilentlyContinue}
}
