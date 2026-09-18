using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Collections;
using System.Web.Script.Serialization;
using System.Threading.Tasks;

internal static class Program {
 static System.Threading.Mutex singleInstance;
 [STAThread] static int Main(string[] args) {
  try {
   string root=AppDomain.CurrentDomain.BaseDirectory;
   if(args.Length==1 && args[0]=="--background-sync"){
    var info=new ProcessStartInfo(Path.Combine(root,"runtime","node","node.exe"),"\""+Path.Combine(root,"background-sync.js")+"\""){
     WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden
    };
    info.EnvironmentVariables["SDIS_ASSISTANT_EXE"]=Path.Combine(root,"SDIS-Collegues.exe");
    using(var process=Process.Start(info)){process.WaitForExit();return process.ExitCode;}
   }
   bool created;
   singleInstance=new System.Threading.Mutex(true,"Local\\AssistantPlanning.UI",out created);
   if(!created)return 0;
   if(args.Length==1 && (args[0]=="--protect" || args[0]=="--unprotect")){
    Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
    string input=Console.In.ReadToEnd();
    if(args[0]=="--protect"){
     byte[] plain=Encoding.UTF8.GetBytes(input);
     try{Console.Write(Convert.ToBase64String(ProtectedData.Protect(plain,null,DataProtectionScope.CurrentUser)));}
     finally{Array.Clear(plain,0,plain.Length);}
    } else {
     byte[] plain=ProtectedData.Unprotect(Convert.FromBase64String(input),null,DataProtectionScope.CurrentUser);
     try{Console.Write(Encoding.UTF8.GetString(plain));}finally{Array.Clear(plain,0,plain.Length);}
    }
    return 0;
   }
   Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
   using(MainForm form=new MainForm()){
    if(args.Length==2&&args[0]=="--calendar")form.PreviewCalendar(args[1]);
    if((args.Length==2 && args[0]=="--preview")||(args.Length==3 && args[0]=="--preview-calendar")){
     if(args[0]=="--preview-calendar")form.PreviewCalendar(args[2]);
     form.Show();Application.DoEvents();
     using(Bitmap bitmap=new Bitmap(form.Width,form.Height)){
      form.DrawToBitmap(bitmap,new Rectangle(0,0,form.Width,form.Height));
      bitmap.Save(args[1],System.Drawing.Imaging.ImageFormat.Png);
     }
     form.Close();return 0;
    }
   Application.Run(form);
   }
   return 0;
  } catch {
   if(args.Length==1 && args[0]=="--background-sync"){
    try{string dir=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"SDIS-Bot-Collegues");Directory.CreateDirectory(dir);File.AppendAllText(Path.Combine(dir,"assistant-planning.log"),DateTime.UtcNow.ToString("o")+" [AUTO] ERREUR : moteur indisponible.\n");}catch{}
    return 1;
   }
   if(args.Length>0 && (args[0]=="--protect"||args[0]=="--unprotect"))return 2;
   MessageBox.Show("Impossible de démarrer SDIS. Demandez une copie complète du programme.","SDIS",MessageBoxButtons.OK,MessageBoxIcon.Error);
   return 1;
  }
 }
}
internal sealed class MainForm:Form {
 readonly Label status=new Label(),summary=new Label(),lastCheck=new Label(),buildInfo=new Label();
 readonly Label googleBadge=new Label(),agattBadge=new Label(),dendreoBadge=new Label();
 readonly List<Button> buttons=new List<Button>();
 readonly CheckBox reposCheck=new CheckBox();
 readonly Panel reposCard=new Panel();
 bool updatingRepos;
 readonly JavaScriptSerializer json=new JavaScriptSerializer();
 readonly Panel busyPanel=new Panel();
 readonly Label busySpinner=new Label(),busyText=new Label(),progressDetail=new Label(),progressCounters=new Label(),progressDuration=new Label();
 readonly ProgressBar syncProgress=new ProgressBar();
 readonly Panel calendarPreview=new Panel();



 readonly Timer busyTimer=new Timer();
 readonly Timer progressTimer=new Timer();
 DateTime syncStartedAt;
 bool busy;
 Process activeRequest;
 bool syncProgressMode;
 public MainForm(){
 Text="Assistant Planning";ClientSize=new Size(640,800);MinimumSize=new Size(656,839);AutoScroll=false;
  try{string iconPath=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"assets","assistant-planning.ico");if(File.Exists(iconPath))Icon=new Icon(iconPath);}catch{}
  StartPosition=FormStartPosition.CenterScreen;Font=new Font("Segoe UI",11);BackColor=Color.FromArgb(250,250,249);
  Panel header=new Panel{Bounds=new Rectangle(0,0,640,126),Anchor=AnchorStyles.Top|AnchorStyles.Left|AnchorStyles.Right,BackColor=Color.White};Controls.Add(header);
  header.Controls.Add(new Panel{Dock=DockStyle.Bottom,Height=4,BackColor=Color.FromArgb(232,35,42)});
  PictureBox logo=new PictureBox{Bounds=new Rectangle(26,18,92,88),SizeMode=PictureBoxSizeMode.Zoom,BackColor=Color.Transparent};
  string logoPath=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"assets","udsp14-logo.png");if(File.Exists(logoPath)){try{logo.Image=Image.FromFile(logoPath);}catch{}}header.Controls.Add(logo);
  header.Controls.Add(new Label{Text="UDSP 14",Font=new Font("Segoe UI",12,FontStyle.Bold),ForeColor=Color.FromArgb(3,46,66),AutoSize=true,Location=new Point(140,22)});
  header.Controls.Add(new Label{Text="Service Formation",Font=new Font("Segoe UI",10),ForeColor=Color.FromArgb(94,107,113),AutoSize=true,Location=new Point(141,47)});
  header.Controls.Add(new Label{Text="Assistant Planning",Font=new Font("Segoe UI",25,FontStyle.Bold),ForeColor=Color.FromArgb(3,46,66),AutoSize=true,Location=new Point(138,63)});
  summary.Text="Connectez vos trois services pour commencer.";summary.SetBounds(34,148,570,32);summary.ForeColor=Color.FromArgb(3,46,66);summary.Font=new Font("Segoe UI",11,FontStyle.Bold);Controls.Add(summary);
  AddService("Google Agenda",googleBadge,"Connecter Google","google","G",Color.FromArgb(66,133,244),196);
  AddService("AGATT",agattBadge,"Connecter AGATT","open-agatt","A",Color.FromArgb(3,46,66),288);
  AddService("Dendreo",dendreoBadge,"Connecter Dendreo","open-dendreo","D",Color.FromArgb(244,126,32),380);
   Button sync=new Button{Text="Synchroniser maintenant",Bounds=new Rectangle(34,550,570,44),BackColor=Color.FromArgb(232,35,42),ForeColor=Color.White,FlatStyle=FlatStyle.Flat};sync.FlatAppearance.BorderSize=0;sync.Click+=(s,e)=>Call("synchronize");buttons.Add(sync);Controls.Add(sync);
   reposCard.Bounds=new Rectangle(34,476,570,62);reposCard.BackColor=Color.White;reposCard.BorderStyle=BorderStyle.FixedSingle;Controls.Add(reposCard);
   reposCard.Controls.Add(new Panel{Bounds=new Rectangle(0,0,5,62),BackColor=Color.FromArgb(244,126,32)});
   reposCheck.Text="";reposCheck.Bounds=new Rectangle(18,17,26,26);reposCheck.ForeColor=Color.FromArgb(3,46,66);reposCheck.CheckedChanged+=(s,e)=>{if(!updatingRepos)SaveRepos(reposCheck.Checked);};reposCard.Controls.Add(reposCheck);
   reposCard.Controls.Add(new Label{Text="Repos compensatoire",Font=new Font("Segoe UI",11,FontStyle.Bold),ForeColor=Color.FromArgb(3,46,66),AutoSize=true,Location=new Point(58,10)});
   reposCard.Controls.Add(new Label{Text="Apres une garde, bloquer le repos prevu dans Dendreo",Font=new Font("Segoe UI",9),ForeColor=Color.FromArgb(94,107,113),AutoSize=true,Location=new Point(58,34)});
   lastCheck.Text="Derniere verification : pas encore effectuee";lastCheck.SetBounds(34,606,570,25);lastCheck.ForeColor=Color.DimGray;Controls.Add(lastCheck);
   status.SetBounds(34,638,570,70);status.AutoSize=false;status.AutoEllipsis=false;status.Text="";Controls.Add(status);
   buildInfo.Text=BuildLabel();buildInfo.SetBounds(34,760,570,24);buildInfo.ForeColor=Color.FromArgb(120,128,132);buildInfo.Font=new Font("Segoe UI",9);Controls.Add(buildInfo);
   lastCheck.Visible=false;status.Visible=false;buildInfo.Visible=true;
  calendarPreview.Bounds=new Rectangle(34,148,570,650);calendarPreview.BackColor=Color.White;calendarPreview.BorderStyle=BorderStyle.FixedSingle;calendarPreview.Visible=false;Controls.Add(calendarPreview);
  busyPanel.Bounds=new Rectangle(34,190,570,340);busyPanel.BackColor=Color.FromArgb(250,250,249);busyPanel.Visible=false;
  busySpinner.Bounds=new Rectangle(235,112,100,70);busySpinner.Font=new Font("Segoe UI",36,FontStyle.Regular);busySpinner.ForeColor=Color.FromArgb(232,35,42);busySpinner.TextAlign=ContentAlignment.MiddleCenter;
   busyText.Bounds=new Rectangle(40,190,490,42);busyText.Font=new Font("Segoe UI",12,FontStyle.Bold);busyText.ForeColor=Color.FromArgb(3,46,66);busyText.TextAlign=ContentAlignment.MiddleCenter;
   syncProgress.Bounds=new Rectangle(70,245,430,18);syncProgress.Minimum=0;syncProgress.Maximum=100;syncProgress.Style=ProgressBarStyle.Continuous;
   progressDetail.Bounds=new Rectangle(40,270,490,30);progressDetail.Font=new Font("Segoe UI",10);progressDetail.ForeColor=Color.FromArgb(94,107,113);progressDetail.TextAlign=ContentAlignment.MiddleCenter;
   progressCounters.Bounds=new Rectangle(40,300,490,26);progressCounters.Font=new Font("Segoe UI",9);progressCounters.ForeColor=Color.FromArgb(94,107,113);progressCounters.TextAlign=ContentAlignment.MiddleCenter;
   progressDuration.Bounds=new Rectangle(15,326,540,38);progressDuration.AutoSize=false;progressDuration.AutoEllipsis=false;progressDuration.Font=new Font("Segoe UI",9);progressDuration.ForeColor=Color.FromArgb(120,128,132);progressDuration.TextAlign=ContentAlignment.MiddleCenter;
   busyPanel.Controls.Add(busySpinner);busyPanel.Controls.Add(busyText);busyPanel.Controls.Add(syncProgress);busyPanel.Controls.Add(progressDetail);busyPanel.Controls.Add(progressCounters);busyPanel.Controls.Add(progressDuration);Controls.Add(busyPanel);busyPanel.BringToFront();
   busyTimer.Interval=120;busyTimer.Tick+=(s,e)=>{string[] frames={"|","/","-","\\"};int n=busyTimer.Tag==null?0:(int)busyTimer.Tag;n=(n+1)%frames.Length;busyTimer.Tag=n;busySpinner.Text=frames[n];};
   progressTimer.Interval=150;progressTimer.Tick+=(s,e)=>PollProgress();
  // Les mises à jour passent par le même backend que les autres actions.
  FormClosing+=(s,e)=>{busy=false;busyTimer.Stop();progressTimer.Stop();try{if(activeRequest!=null&&!activeRequest.HasExited)activeRequest.Kill();}catch{}};
 }
 string BuildLabel(){
  string version="1.0.0",stamp="";
  try{
   string file=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"app-version.json");
   Dictionary<string,object> data=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file,Encoding.UTF8));
   if(data!=null&&data.ContainsKey("version"))version=Convert.ToString(data["version"]);
   if(data!=null&&data.ContainsKey("build"))stamp=Convert.ToString(data["build"]);
  }catch{}
  DateTimeOffset parsed;
  string formatted=DateTimeOffset.TryParse(stamp,out parsed)?parsed.ToLocalTime().ToString("dd/MM/yyyy HH:mm"):"inconnue";
  return "Assistant Planning - v"+version+" - build "+formatted;
 }
 void AddService(string name,Label badge,string caption,string action,string mark,Color accent,int y){
  Panel card=new Panel{Bounds=new Rectangle(34,y,570,80),BackColor=Color.White,BorderStyle=BorderStyle.FixedSingle};Controls.Add(card);
  card.Controls.Add(new Panel{Bounds=new Rectangle(0,0,5,80),BackColor=Color.FromArgb(232,35,42)});
  Label icon=new Label{Text=mark,Bounds=new Rectangle(14,13,54,54),BackColor=accent,ForeColor=Color.White,Font=new Font("Segoe UI",22,FontStyle.Bold),TextAlign=ContentAlignment.MiddleCenter};card.Controls.Add(icon);
  card.Controls.Add(new Label{Text=name,Font=new Font("Segoe UI",13,FontStyle.Bold),AutoSize=true,Location=new Point(84,12)});
  badge.Text=name+" : a connecter";badge.SetBounds(84,42,250,24);badge.ForeColor=Color.DimGray;Controls.Add(badge);card.Controls.Add(badge);
  Button button=new Button{Text=caption,Bounds=new Rectangle(380,19,168,42),BackColor=Color.FromArgb(232,35,42),ForeColor=Color.White,FlatStyle=FlatStyle.Flat};
  button.FlatAppearance.BorderSize=0;button.Click+=(s,e)=>Call(action);buttons.Add(button);card.Controls.Add(button);
 }
 Dictionary<string,object> Request(Dictionary<string,object> request){
  string root=AppDomain.CurrentDomain.BaseDirectory;
  ProcessStartInfo info=new ProcessStartInfo{
   FileName=Path.Combine(root,"runtime","node","node.exe"),
   Arguments="\""+Path.Combine(root,"ui-backend.js")+"\"",
   WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,
   RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,
   StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8
  };
  info.EnvironmentVariables["SDIS_ASSISTANT_EXE"]=Process.GetCurrentProcess().MainModule.FileName;
  using(Process process=Process.Start(info)){
   activeRequest=process;
   try{
   Task<string> output=process.StandardOutput.ReadToEndAsync();
   Task<string> errors=process.StandardError.ReadToEndAsync();
   using(StreamWriter input=new StreamWriter(process.StandardInput.BaseStream,new UTF8Encoding(false))){
    input.Write(json.Serialize(request));
   }
   if(!process.WaitForExit(1800000)){process.Kill();throw new Exception("Delai depasse.");}
   Task.WaitAll(output,errors);
   if(process.ExitCode!=0)throw new Exception("Le programme est incomplet ou indisponible.");
   return json.Deserialize<Dictionary<string,object>>(output.Result);
   } finally {if(Object.ReferenceEquals(activeRequest,process))activeRequest=null;}
  }
 }
 void ReportClientException(string action,string message){
  try{
   string root=AppDomain.CurrentDomain.BaseDirectory;
   string node=Path.Combine(root,"runtime","node","node.exe");
   string script=Path.Combine(root,"diagnostic-report.js");
   string payload=Convert.ToBase64String(Encoding.UTF8.GetBytes(json.Serialize(new Dictionary<string,object>{{"module","csharp"},{"phase",action},{"action",action},{"error",message},{"type","CSharpException"}})));
   Process.Start(new ProcessStartInfo{FileName=node,Arguments="\""+script+"\" --csharp-error "+payload,WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden});
  }catch{}
 }

 async void Call(string action){
  if(busy)return;if(action=="startup"){SetBusy(false,"",false);}else SetBusy(true,BusyMessage(action),action=="synchronize");
  status.ForeColor=Color.FromArgb(3,46,66);
  status.Text=action=="startup"?"Recherche de mise a jour...":(action=="google"?"Ouverture de Google... Terminez la connexion dans votre navigateur.":(action=="synchronize"?"Synchronisation en cours...":"Verification en cours..."));
  try{
   var request=new Dictionary<string,object>{{"action",action}};
   if(action=="google"||action=="open-agatt"||action=="open-dendreo")request["windowBounds"]=new Dictionary<string,object>{{"x",Left},{"y",Top},{"width",Width},{"height",Height}};
   var response=await Task.Run(()=>Request(request));
    if(!Flag(response,"ok")){
    if(action=="simulate"){
     var current=await Task.Run(()=>Request(new Dictionary<string,object>{{"action","status"}}));
     if(Flag(current,"ok"))ApplyStatus(current);
    }
    if(action=="synchronize")RefreshStatusInBackground();
    ShowError(Convert.ToString(response["message"]));
    return;
   }
   if(action=="startup"){
   if(Flag(response,"updated")){status.Text="Mise a jour d'Assistant Planning...";Application.Exit();return;}
    RefreshStatusInBackground();
    if(Flag(response,"warning"))status.Text="Mise a jour impossible - version actuelle conservee";
    else status.Text="";
   }else if(action=="status")ApplyStatus(response);
   else if(action=="update-check"){
    if(Flag(response,"available")){status.Text="Nouvelle version détectée : téléchargement du package complet...";var installed=await Task.Run(()=>Request(new Dictionary<string,object>{{"action","update-install"}}));if(Flag(installed,"ok")){status.Text="Mise à jour en cours. Assistant Planning va redémarrer.";Application.Exit();}else ShowError(Convert.ToString(installed["message"]));}
    else status.Text=Convert.ToString(response["message"]);
   }
   else if(action=="google"||action=="simulate"||action=="synchronize"||action=="open-agatt"||action=="open-dendreo"){
    if(action=="google"){googleBadge.Text="\u2705 Google connect\u00E9";googleBadge.ForeColor=Color.ForestGreen;status.Text="\u2705 Google connect\u00E9";}
    if(action=="open-agatt"){agattBadge.Text="\u2705 AGATT connect\u00E9";agattBadge.ForeColor=Color.ForestGreen;}
    if(action=="open-dendreo"){dendreoBadge.Text="\u2705 Dendreo connect\u00E9";dendreoBadge.ForeColor=Color.ForestGreen;status.Text="\u2705 Dendreo connect\u00E9";}
    if(action=="google"||action=="open-agatt"||action=="open-dendreo"){
     // La confirmation de connexion libere immediatement l'interface. Le
     // statut global et la decouverte d'agentId sont rafraichis en arriere-plan.
     SetBusy(false,"",false);RefreshStatusInBackground();return;
    }
    if(action=="synchronize")RefreshStatusInBackground();
    else{
    var refreshed=await Task.Run(()=>Request(new Dictionary<string,object>{{"action","status"}}));
    if(Flag(refreshed,"ok"))ApplyStatus(refreshed);
    else ShowError(Convert.ToString(refreshed["message"]));
    }
    if(action=="simulate")status.Text=Convert.ToString(response["message"]);
    if(action=="synchronize"){
     status.Text=FormatSyncResult(response);
     try{
      var calendar=response.ContainsKey("calendar")?response["calendar"] as Dictionary<string,object>:null;
      if(!Flag(calendar,"ok"))calendar=await Task.Run(()=>Request(new Dictionary<string,object>{{"action","dendreo-calendar"}}));
      if(Flag(calendar,"ok"))ShowDendreoCalendarScreen(calendar);
      else status.Text+="\nCalendrier Dendreo indisponible.";
     }catch{ShowError("Calendrier Dendreo indisponible. Reessayez la synchronisation.");}
    }
   }else status.Text="Terminez la connexion dans votre navigateur.";
 }catch(Exception error){ReportClientException(action,error.Message);ShowError(action=="google"?"Connexion impossible : verifiez votre connexion Internet puis reessayez.":((action=="open-agatt"||action=="open-dendreo")?"Connexion impossible : la fenetre de connexion n'a pas pu etre verifiee. Reessayez.":"La verification est indisponible. Relancez Assistant Planning puis reessayez."));}
  finally{SetBusy(false,"",false);}
 }
void RefreshStatusInBackground(){
   Task.Run(()=>Request(new Dictionary<string,object>{{"action","status"}})).ContinueWith(t=>{
    if(t.Status!=TaskStatus.RanToCompletion||IsDisposed||!IsHandleCreated)return;
    try{BeginInvoke((Action)(()=>{if(Flag(t.Result,"ok"))ApplyStatus(t.Result);}));}catch{}
   },TaskScheduler.Default);
   }
   void SaveRepos(bool value){
   if(busy)return;
   SetBusy(true,"Enregistrement du repo compensatoire...",false);
   status.ForeColor=Color.FromArgb(3,46,66);
   status.Text=value?"Activation du repos compensatoire...":"Desactivation du repos compensatoire...";
   Task.Run(()=>Request(new Dictionary<string,object>{{"action","set-repos"},{"value",value}})).ContinueWith(t=>{
    try{BeginInvoke((Action)(()=>{
     if(IsDisposed)return;
     SetBusy(false,"",false);
     if(t.Status==TaskStatus.RanToCompletion&&Flag(t.Result,"ok")){
      status.Text=Convert.ToString(t.Result["message"])+(value?" Les repos seront créés à la prochaine synchronisation.":" Les repos bot seront retirés à la prochaine synchronisation.");
      RefreshStatusInBackground();
     }else{
      updatingRepos=true;reposCheck.Checked=!value;updatingRepos=false;
      ShowError(t.Status==TaskStatus.RanToCompletion?Convert.ToString(t.Result["message"]):"Repos compensatoire : enregistrement impossible.");
     }
    }));}catch{}
   },TaskScheduler.Default);
 }
 void ShowDendreoCalendarScreen(Dictionary<string,object> response){
  calendarPreview.SuspendLayout();
  if(!calendarPreview.Visible){foreach(Control control in Controls){if(control!=calendarPreview&&control.Top>=148)control.Visible=false;}}
  while(calendarPreview.Controls.Count>0)calendarPreview.Controls[0].Dispose();
  calendarPreview.Bounds=new Rectangle(16,136,ClientSize.Width-32,ClientSize.Height-148);
  calendarPreview.Anchor=AnchorStyles.Top|AnchorStyles.Bottom|AnchorStyles.Left|AnchorStyles.Right;
  calendarPreview.Padding=new Padding(12);
  Panel heading=new Panel{Dock=DockStyle.Top,Height=94};
  heading.Controls.Add(new Label{Text="Dendreo • 28 prochains jours",AutoSize=true,Font=new Font("Segoe UI",14,FontStyle.Bold),ForeColor=Color.FromArgb(3,46,66),Location=new Point(0,0)});
  DateTime first=DateTime.ParseExact(Convert.ToString(response["from"]),"yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture);
  DateTime last=DateTime.ParseExact(Convert.ToString(response["to"]),"yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture);
  heading.Controls.Add(new Label{Text=first.ToString("dd/MM/yyyy")+" au "+last.ToString("dd/MM/yyyy"),AutoSize=true,Location=new Point(0,34),Font=new Font("Segoe UI",10),ForeColor=Color.DimGray});
  heading.Controls.Add(new Label{Text="Les 28 jours sont visibles ensemble • cliquez sur un événement ou une date pour lire les détails",AutoSize=true,Location=new Point(0,61),Font=new Font("Segoe UI",9),ForeColor=Color.DimGray});
  Planning28Agenda agenda=new Planning28Agenda(response);
  agenda.Dock=DockStyle.Fill;
  heading.Height=78;
  calendarPreview.Controls.Add(agenda);
  calendarPreview.Controls.Add(heading);
  calendarPreview.Visible=true;calendarPreview.BringToFront();
  calendarPreview.ResumeLayout(true);
 }
 public void PreviewCalendar(string file){ShowDendreoCalendarScreen(json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file,Encoding.UTF8)));}
 string CalendarValue(Dictionary<string,object> ev,string key){return Convert.ToString(ev.ContainsKey(key)?ev[key]:"");}
 IEnumerable Values(object value){
  var list=new List<object>();var items=value as IEnumerable;
  if(items!=null&&!(value is string))foreach(object item in items)list.Add(item);
  return list;
 }
 string CalendarEventType(string text,bool indispo){
  if(indispo)return "Indisponibilité";string s=(text??"").ToLowerInvariant();
  if(s.Contains("garde"))return "Garde";if(s.Contains("psc"))return "PSC";if(s.Contains("mac"))return "MAC";if(s.Contains("sst"))return "SST";if(s.Contains("réunion")||s.Contains("reunion"))return "Réunion";if(s.Contains("formation"))return "Formation";return "Autre";
 }
 Color CalendarEventColor(string type){
   switch(type){case "Garde":return Color.MistyRose;case "Repos compensatoire":return Color.Moccasin;case "PSC":return Color.LightBlue;case "MAC":return Color.LemonChiffon;case "SST":return Color.Honeydew;case "Réunion":return Color.Lavender;case "Formation":return Color.LavenderBlush;case "Indisponibilité":return Color.Moccasin;default:return Color.WhiteSmoke;}
 }
 string FormatSyncResult(Dictionary<string,object> response){
   string text=Convert.ToString(response.ContainsKey("message")?response["message"]:"");
   return text;
   if(!Flag(response,"ok"))return text;
   var summary=response.ContainsKey("summary")?response["summary"] as Dictionary<string,object>:null;
   if(summary==null)return text;
   double seconds=response.ContainsKey("durationMs")?Convert.ToDouble(response["durationMs"])/1000.0:0;
   return text+"\n"+Convert.ToString(summary["guardsAnalyzed"])+" gardes analysées — "+Convert.ToString(summary["added"])+" ajoutées, "+Convert.ToString(summary["removed"])+" supprimées, "+Convert.ToString(summary["alreadyUpToDate"])+" déjà à jour\nTerminée en "+seconds.ToString("0.0")+" secondes";
  }
 string BusyMessage(string action){if(action=="startup")return "Recherche de mise a jour...";if(action=="google")return "Connexion a Google...";if(action=="open-agatt")return "Connexion a AGATT...";if(action=="open-dendreo")return "Connexion a Dendreo...";if(action=="synchronize")return "Synchronisation en cours...";return "Verification en cours...";}
 void PollProgress(){if(!syncProgressMode)return;try{string file=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"SDIS-Bot-Collegues","sync-progress.json");if(!File.Exists(file))return;var p=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file,Encoding.UTF8));if(p==null||!String.Equals(Convert.ToString(p.ContainsKey("mode")?p["mode"]:""),"sync",StringComparison.OrdinalIgnoreCase))return;if(p.ContainsKey("percent")){int n=Math.Max(0,Math.Min(100,Convert.ToInt32(p["percent"])));syncProgress.Value=n;busyText.Text="Synchronisation en cours — "+n+" %";}if(p.ContainsKey("message")&&!String.IsNullOrWhiteSpace(Convert.ToString(p["message"])))progressDetail.Text=Convert.ToString(p["message"]);if(p.ContainsKey("detail"))progressCounters.Text=Convert.ToString(p["detail"]);if(syncStartedAt!=DateTime.MinValue)progressDuration.Text="Durée : "+(DateTime.Now-syncStartedAt).TotalSeconds.ToString("0.0")+" secondes";}catch{}}
 void SetBusy(bool value,string message,bool showProgress){busy=value;syncProgressMode=value&&showProgress;busyText.Text=message;busyPanel.Visible=syncProgressMode;syncProgress.Visible=syncProgressMode;progressDetail.Visible=syncProgressMode;progressCounters.Visible=syncProgressMode;progressDuration.Visible=syncProgressMode;if(value){syncStartedAt=DateTime.Now;syncProgress.Value=0;progressDetail.Text="";progressCounters.Text="";progressDuration.Text="";busyTimer.Tag=0;busySpinner.Text="|";busyTimer.Start();if(syncProgressMode){progressTimer.Start();busyPanel.BringToFront();}}else{busyTimer.Stop();progressTimer.Stop();busyPanel.Visible=false;}foreach(Button b in buttons){b.Visible=!value&&!calendarPreview.Visible;b.Enabled=!value;}reposCard.Visible=!value&&!calendarPreview.Visible;reposCheck.Visible=!value&&!calendarPreview.Visible;reposCheck.Enabled=!value;}
 void ShowError(string message){
  status.ForeColor=Color.Firebrick;status.Text=message;
  MessageBox.Show(this,message,"Assistant Planning",MessageBoxButtons.OK,MessageBoxIcon.Warning);
 }
 static bool Flag(Dictionary<string,object> value,string key){return value!=null&&value.ContainsKey(key)&&Convert.ToBoolean(value[key]);}
 bool Badge(Label label,string name,Dictionary<string,object> state){
  bool connected=Flag(state,"connected");
  label.Text=connected?"\u2705 "+name+" connect\u00E9":(Flag(state,"temporary")?name+" : reessayez plus tard":(Flag(state,"reconnect")?name+" : reconnexion necessaire":name+" : a connecter"));
  label.ForeColor=connected?Color.ForestGreen:Color.DimGray;return connected;
 }
 void ApplyStatus(Dictionary<string,object> response){
  bool google=Badge(googleBadge,"Google",response["googleStatus"] as Dictionary<string,object>);
  bool agatt=Badge(agattBadge,"AGATT",response["agattStatus"] as Dictionary<string,object>);
  bool dendreo=Badge(dendreoBadge,"Dendreo",response["dendreoStatus"] as Dictionary<string,object>);
  summary.Text=google&&agatt&&dendreo?"":"Connectez vos trois services pour commencer.";
  lastCheck.Text="Derniere verification : "+DateTime.Now.ToString("dd/MM/yyyy HH:mm");
  status.Text="";
  updatingRepos=true;reposCheck.Checked=Flag(response,"reposCompensatoire");updatingRepos=false;
 }
}

internal sealed class Planning28Agenda:UserControl {
 sealed class Entry {public DateTime Day;public string Title,Hours,Start;public bool Unavailable;public Rectangle Bounds;}
 sealed class Surface:Panel {public Surface(){DoubleBuffered=true;ResizeRedraw=true;}}
 readonly Surface canvas=new Surface();
 readonly TextBox detail=new TextBox();
 readonly ToolTip tooltip=new ToolTip();
 readonly List<Entry> entries=new List<Entry>();
 readonly Rectangle[] days=new Rectangle[28];
 readonly System.Globalization.CultureInfo french=System.Globalization.CultureInfo.GetCultureInfo("fr-FR");
 readonly DateTime first;
 Entry selected;DateTime selectedDay=DateTime.MinValue;
 public Planning28Agenda(Dictionary<string,object> response){
  Font=new Font("Segoe UI",10);BackColor=Color.White;
  first=DateTime.ParseExact(Value(response,"from"),"yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture);
  foreach(object item in Items(response.ContainsKey("events")?response["events"]:null)){
   var ev=item as Dictionary<string,object>;if(ev==null)continue;
   string start=Value(ev,"startTime"),end=Value(ev,"endTime"),title=Value(ev,"text");
   foreach(object raw in Items(ev.ContainsKey("dates")?ev["dates"]:null)){
    DateTime day;if(!DateTime.TryParseExact(Convert.ToString(raw),"yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.None,out day))continue;
    if(day<first||day>=first.AddDays(28))continue;
    entries.Add(new Entry{Day=day,Title=String.IsNullOrWhiteSpace(title)?"Événement sans intitulé":title,Start=start,Hours=start=="00:00"&&end=="00:00"?"Toute la journée":start+" – "+end,Unavailable=ev.ContainsKey("indispo")&&Convert.ToBoolean(ev["indispo"])});
   }
  }
  entries.Sort((a,b)=>{int day=a.Day.CompareTo(b.Day);return day!=0?day:String.CompareOrdinal(a.Start,b.Start);});
  detail.Dock=DockStyle.Bottom;detail.Height=86;detail.Multiline=true;detail.ReadOnly=true;detail.ScrollBars=ScrollBars.Vertical;detail.BackColor=Color.FromArgb(248,250,252);detail.BorderStyle=BorderStyle.FixedSingle;
  detail.Text="Cliquez sur un événement pour lire son intitulé complet, ou sur une date pour voir tout ce qui est prévu ce jour-là.";
  canvas.Dock=DockStyle.Fill;canvas.BackColor=Color.White;canvas.Paint+=PaintPlanning;canvas.MouseClick+=SelectEntry;canvas.MouseMove+=HoverEntry;
  Controls.Add(canvas);Controls.Add(detail);
  canvas.Resize+=(s,e)=>LayoutPlanning();
  LayoutPlanning();
 }
 static string Value(Dictionary<string,object> data,string key){return data.ContainsKey(key)?Convert.ToString(data[key]):"";}
 static IEnumerable Items(object value){return value as IEnumerable??new object[0];}
 List<Entry> ForDay(DateTime day){return entries.FindAll(entry=>entry.Day==day);}
 bool HasConflict(DateTime day){var events=ForDay(day);return events.Exists(entry=>entry.Unavailable)&&events.Exists(entry=>!entry.Unavailable);}
 string ConflictText(DateTime day){return HasConflict(day)?"CONFLIT : indisponibilité (rouge) et événement prévu (bleu) sur cette journée."+Environment.NewLine:"";}
 void LayoutPlanning(){
  foreach(var entry in entries)entry.Bounds=Rectangle.Empty;
  for(int index=0;index<28;index++){
   int col=index%7,row=index/7;
   int x=col*canvas.ClientSize.Width/7,y=row*canvas.ClientSize.Height/4;
   int right=(col+1)*canvas.ClientSize.Width/7,bottom=(row+1)*canvas.ClientSize.Height/4;
   Rectangle cell=new Rectangle(x+2,y+2,Math.Max(1,right-x-4),Math.Max(1,bottom-y-4));days[index]=cell;
   var events=ForDay(first.AddDays(index));
   int contentTop=HasConflict(first.AddDays(index))?48:32;
   int available=Math.Max(0,cell.Height-contentTop-3),count=Math.Min(events.Count,available/36);
   int reserved=count<events.Count?20:0;
   int cardHeight=count>0?Math.Min(100,(available-reserved)/count):0;
   for(int i=0;i<count;i++)events[i].Bounds=new Rectangle(cell.X+4,cell.Y+contentTop+i*cardHeight,Math.Max(1,cell.Width-8),Math.Max(1,cardHeight-3));
  }
  canvas.Invalidate();
 }
 void PaintPlanning(object sender,PaintEventArgs args){
  Graphics g=args.Graphics;g.Clear(Color.White);
  using(Font dayFont=new Font("Segoe UI",9,FontStyle.Bold))using(Font eventFont=new Font("Segoe UI",9)){
   for(int index=0;index<28;index++){
    Rectangle cell=days[index];DateTime date=first.AddDays(index);bool conflict=HasConflict(date);
    bool weekend=date.DayOfWeek==DayOfWeek.Saturday||date.DayOfWeek==DayOfWeek.Sunday;
    using(var brush=new SolidBrush(conflict?Color.FromArgb(255,248,235):(weekend?Color.FromArgb(248,249,250):Color.White)))g.FillRectangle(brush,cell);
    g.DrawRectangle(Pens.Gainsboro,cell);
    Rectangle heading=new Rectangle(cell.X+1,cell.Y+1,cell.Width-2,27);
    using(var brush=new SolidBrush(date==DateTime.Today?Color.FromArgb(232,240,254):Color.FromArgb(245,247,249)))g.FillRectangle(brush,heading);
    TextRenderer.DrawText(g,date.ToString("ddd dd/MM",french),dayFont,new Rectangle(heading.X+5,heading.Y+3,heading.Width-8,24),date==DateTime.Today?Color.FromArgb(26,115,232):Color.FromArgb(60,64,67),TextFormatFlags.NoPrefix);
    if(conflict){
     using(Font badge=new Font("Segoe UI",8,FontStyle.Bold))TextRenderer.DrawText(g,"! CONFLIT",badge,new Rectangle(cell.X+3,cell.Y+28,cell.Width-6,18),Color.FromArgb(164,71,0),TextFormatFlags.NoPrefix|TextFormatFlags.HorizontalCenter);
    }
    if(date==selectedDay)using(Pen pen=new Pen(Color.FromArgb(26,115,232),1)){Rectangle outline=cell;outline.Inflate(-3,-3);g.DrawRectangle(pen,outline);}
    var events=ForDay(date);int visible=0;
    foreach(var entry in events){
     if(entry.Bounds.IsEmpty)continue;visible++;
     Color color=entry.Unavailable?Color.FromArgb(252,232,230):Color.FromArgb(210,227,252);
     using(var brush=new SolidBrush(color))g.FillRectangle(brush,entry.Bounds);
     using(var brush=new SolidBrush(entry.Unavailable?Color.FromArgb(217,48,37):Color.FromArgb(26,115,232)))g.FillRectangle(brush,entry.Bounds.X,entry.Bounds.Y,3,entry.Bounds.Height);
     if(entry==selected)using(Pen pen=new Pen(Color.FromArgb(26,115,232),2))g.DrawRectangle(pen,entry.Bounds);
     Rectangle text=new Rectangle(entry.Bounds.X+6,entry.Bounds.Y+3,Math.Max(1,entry.Bounds.Width-10),Math.Max(1,entry.Bounds.Height-6));
          using(Font hoursFont=new Font("Segoe UI",8))TextRenderer.DrawText(g,entry.Hours.Replace(" – ","–"),hoursFont,new Rectangle(text.X,text.Y,text.Width,16),Color.FromArgb(32,33,36),TextFormatFlags.EndEllipsis|TextFormatFlags.NoPrefix);
     string visual=Regex.Replace(entry.Title.Replace("[SDIS-BOT]","").Replace("📅","").Replace("❌",""),@"\s+"," ").Trim();
     TextRenderer.DrawText(g,visual,eventFont,new Rectangle(text.X,text.Y+16,text.Width,Math.Max(1,text.Height-16)),Color.FromArgb(32,33,36),TextFormatFlags.WordBreak|TextFormatFlags.EndEllipsis|TextFormatFlags.NoPrefix);
    }
    if(events.Count==0)TextRenderer.DrawText(g,"Libre",eventFont,new Rectangle(cell.X+6,cell.Y+37,cell.Width-10,22),Color.Gray,TextFormatFlags.NoPrefix);
    if(conflict)using(Pen pen=new Pen(Color.FromArgb(234,134,0),2))g.DrawRectangle(pen,cell);
    if(visible<events.Count)TextRenderer.DrawText(g,"+ "+(events.Count-visible)+" événement(s) • cliquer",eventFont,new Rectangle(cell.X+5,cell.Bottom-22,cell.Width-8,20),Color.FromArgb(26,115,232),TextFormatFlags.EndEllipsis|TextFormatFlags.NoPrefix);
   }
  }
 }
 void SelectEntry(object sender,MouseEventArgs args){
  foreach(var entry in entries)if(!entry.Bounds.IsEmpty&&entry.Bounds.Contains(args.Location)){
   selected=entry;selectedDay=entry.Day;detail.Text=ConflictText(entry.Day)+entry.Day.ToString("dddd dd MMMM yyyy",french)+"  •  "+entry.Hours+Environment.NewLine+entry.Title;canvas.Invalidate();return;
  }
  for(int index=0;index<28;index++)if(days[index].Contains(args.Location)){
   selected=null;selectedDay=first.AddDays(index);var text=new StringBuilder(ConflictText(selectedDay)+selectedDay.ToString("dddd dd MMMM yyyy",french));
   var events=ForDay(selectedDay);
   if(events.Count==0)text.Append(Environment.NewLine+"Aucun événement prévu.");
   foreach(var entry in events)text.Append(Environment.NewLine+Environment.NewLine+entry.Hours+Environment.NewLine+entry.Title);
   detail.Text=text.ToString();canvas.Invalidate();return;
  }
 }
 string hovered="";
 void HoverEntry(object sender,MouseEventArgs args){
  string text="";
  foreach(var entry in entries)if(!entry.Bounds.IsEmpty&&entry.Bounds.Contains(args.Location)){text=ConflictText(entry.Day)+entry.Hours+Environment.NewLine+entry.Title;break;}
  if(String.IsNullOrEmpty(text))for(int index=0;index<28;index++)if(days[index].Contains(args.Location)&&HasConflict(first.AddDays(index))){text=ConflictText(first.AddDays(index))+"Cliquez sur la date pour voir tous les événements.";break;}
  if(text!=hovered){hovered=text;tooltip.SetToolTip(canvas,text);canvas.Cursor=String.IsNullOrEmpty(text)?Cursors.Default:Cursors.Hand;}
 }
 protected override void Dispose(bool disposing){if(disposing)tooltip.Dispose();base.Dispose(disposing);}
}
