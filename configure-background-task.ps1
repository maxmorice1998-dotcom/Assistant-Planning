param(
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [switch]$WhatIf
)
$ErrorActionPreference='Stop'
$taskName='Assistant Planning - Synchronisation automatique'
$root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$exe=Join-Path $root 'SDIS-Collegues.exe'
if(-not(Test-Path -LiteralPath $exe)){throw "Executable absent: $exe"}
$user=[Security.Principal.WindowsIdentity]::GetCurrent()
$sid=[Security.SecurityElement]::Escape($user.User.Value)
$escapedRoot=[Security.SecurityElement]::Escape($root)
$escapedExe=[Security.SecurityElement]::Escape($exe)
$xml=@"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Synchronisation silencieuse Assistant Planning</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><Delay>PT12S</Delay><UserId>$sid</UserId></LogonTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>$sid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT30M</ExecutionTimeLimit><Hidden>true</Hidden></Settings>
  <Actions Context="Author"><Exec><Command>$escapedExe</Command><Arguments>--background-sync</Arguments><WorkingDirectory>$escapedRoot</WorkingDirectory></Exec></Actions>
</Task>
"@
if($WhatIf){$xml;exit 0}
Register-ScheduledTask -TaskName $taskName -TaskPath "\" -Xml $xml -User $user.Name -Force | Out-Null
