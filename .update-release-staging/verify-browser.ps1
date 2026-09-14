param([int]$Port,[string]$Profile)
$ErrorActionPreference='Stop'
try {
 if($Port -notin @(19222,19223)){exit 2}
 $listeners=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
 if($listeners.Count -eq 0){exit 3}
 foreach($listener in $listeners){
  if($listener.LocalAddress -notin @('127.0.0.1','::1')){exit 4}
  $proc=Get-CimInstance Win32_Process -Filter ("ProcessId="+$listener.OwningProcess)
  if($proc.Name -ne 'chrome.exe'){exit 5}
  $line=$proc.CommandLine
  $portPattern='(?:^|\s)--remote-debugging-port='+$Port+'(?:\s|$)'
  $profilePattern='(?:^|\s)"?--user-data-dir="?'+[regex]::Escape($Profile)+'"?(?:\s|$)'
  if($line -notmatch $portPattern -or $line -notmatch $profilePattern){exit 6}
 }
 exit 0
} catch {exit 7}
