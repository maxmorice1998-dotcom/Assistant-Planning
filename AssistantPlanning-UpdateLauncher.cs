using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
internal static class AssistantPlanningUpdateLauncher {
 const uint BREAKAWAY=0x01000000,NEW_GROUP=0x00000200,NO_WINDOW=0x08000000,UNICODE_ENV=0x00000400,USE_SHOW=1; const short HIDE=0;
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string reserved,desktop,title; public int x,y,xSize,ySize,xChars,yChars,fill; public uint flags; public short show,reserved2; public IntPtr reservedPtr; }
 [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public int processId,threadId; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO startup,out PROCESS_INFORMATION process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
 static int Main(string[] args) { try {
  if(args.Length!=1)return 2; var command=File.ReadAllText(args[0],Encoding.UTF8).Trim(); if(String.IsNullOrWhiteSpace(command))return 3;
  var startup=new STARTUPINFO(); startup.cb=Marshal.SizeOf(typeof(STARTUPINFO)); startup.flags=USE_SHOW; startup.show=HIDE; PROCESS_INFORMATION process;
  if(!CreateProcess(null,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,BREAKAWAY|NEW_GROUP|NO_WINDOW|UNICODE_ENV,IntPtr.Zero,null,ref startup,out process)){var error=Marshal.GetLastWin32Error();File.WriteAllText(args[0]+".error",error.ToString(),new UTF8Encoding(false));return error;}
  File.WriteAllText(args[0]+".pid",process.processId.ToString(),new UTF8Encoding(false));CloseHandle(process.thread);CloseHandle(process.process);return 0;
 }catch{return 1;} }
}
