$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PlanningContext {
 [DllImport("advapi32.dll")] public static extern bool IsTokenRestricted(IntPtr token);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint id);
 [DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr handle,int index,StringBuilder data,int size,out int needed);
 public static string Name(IntPtr handle){int needed;var text=new StringBuilder(512);return GetUserObjectInformation(handle,2,text,1024,out needed)?text.ToString():"unavailable";}
}
'@
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
[pscustomobject]@{
 restrictedToken=[PlanningContext]::IsTokenRestricted($identity.Token)
 windowStation=[PlanningContext]::Name([PlanningContext]::GetProcessWindowStation())
 desktop=[PlanningContext]::Name([PlanningContext]::GetThreadDesktop([PlanningContext]::GetCurrentThreadId()))
} | ConvertTo-Json
