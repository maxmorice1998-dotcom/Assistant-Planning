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
    if(args.Length==2 && args[0]=="--preview"){
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
 bool updatingRepos;
 readonly JavaScriptSerializer json=new JavaScriptSerializer();
 readonly Panel busyPanel=new Panel();
 readonly Label busySpinner=new Label(),busyText=new Label(),progressDetail=new Label(),progressCounters=new Label(),progressDuration=new Label();
 readonly ProgressBar syncProgress=new ProgressBar();
 readonly Panel calendarPreview=new Panel();
 readonly DataGridView calendarGrid=new DataGridView();
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
  Panel header=new Panel{Bounds=new Rectangle(0,0,640,126),BackColor=Color.White};Controls.Add(header);
  header.Controls.Add(new Panel{Bounds=new Rectangle(0,122,640,4),BackColor=Color.FromArgb(232,35,42)});
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
   Panel reposCard=new Panel{Bounds=new Rectangle(34,476,570,62),BackColor=Color.White,BorderStyle=BorderStyle.FixedSingle};Controls.Add(reposCard);
   reposCard.Controls.Add(new Panel{Bounds=new Rectangle(0,0,5,62),BackColor=Color.FromArgb(244,126,32)});
   reposCheck.Text="";reposCheck.Bounds=new Rectangle(18,17,26,26);reposCheck.ForeColor=Color.FromArgb(3,46,66);reposCheck.CheckedChanged+=(s,e)=>{if(!updatingRepos)SaveRepos(reposCheck.Checked);};reposCard.Controls.Add(reposCheck);
   reposCard.Controls.Add(new Label{Text="Repos compensatoire",Font=new Font("Segoe UI",11,FontStyle.Bold),ForeColor=Color.FromArgb(3,46,66),AutoSize=true,Location=new Point(58,10)});
   reposCard.Controls.Add(new Label{Text="Apres une garde, bloquer le repos prevu dans Dendreo",Font=new Font("Segoe UI",9),ForeColor=Color.FromArgb(94,107,113),AutoSize=true,Location=new Point(58,34)});
   lastCheck.Text="Derniere verification : pas encore effectuee";lastCheck.SetBounds(34,606,570,25);lastCheck.ForeColor=Color.DimGray;Controls.Add(lastCheck);
   status.SetBounds(34,638,570,70);status.AutoSize=false;status.AutoEllipsis=false;status.Text="";Controls.Add(status);
   buildInfo.Text=BuildLabel();buildInfo.SetBounds(34,760,570,24);buildInfo.ForeColor=Color.FromArgb(120,128,132);buildInfo.Font=new Font("Segoe UI",9);Controls.Add(buildInfo);
   lastCheck.Visible=false;status.Visible=false;buildInfo.Visible=true;
  calendarPreview.Bounds=new Rectangle(34,148,570,650);calendarPreview.BackColor=Color.White;calendarPreview.BorderStyle=BorderStyle.FixedSingle;calendarPreview.Visible=false;Controls.Add(calendarPreview);
  calendarGrid.Bounds=new Rectangle(10,42,548,640);calendarGrid.ReadOnly=true;calendarGrid.AllowUserToAddRows=false;calendarGrid.AllowUserToDeleteRows=false;calendarGrid.RowHeadersVisible=false;calendarGrid.AutoGenerateColumns=false;calendarGrid.BackgroundColor=Color.White;calendarGrid.SelectionMode=DataGridViewSelectionMode.FullRowSelect;calendarGrid.Columns.Add(new DataGridViewTextBoxColumn{HeaderText="Date",Width=92});calendarGrid.Columns.Add(new DataGridViewTextBoxColumn{HeaderText="Heure",Width=92});calendarGrid.Columns.Add(new DataGridViewTextBoxColumn{HeaderText="Événement Dendreo",AutoSizeMode=DataGridViewAutoSizeColumnMode.Fill});calendarPreview.Controls.Add(calendarGrid);
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
    var refreshed=await Task.Run(()=>Request(new Dictionary<string,object>{{"action","status"}}));
    if(Flag(refreshed,"ok"))ApplyStatus(refreshed);
    else ShowError(Convert.ToString(refreshed["message"]));
    if(action=="simulate")status.Text=Convert.ToString(response["message"]);
    if(action=="synchronize"){
     status.Text=FormatSyncResult(response);
     try{
      var calendar=await Task.Run(()=>Request(new Dictionary<string,object>{{"action","dendreo-calendar"}}));
      if(Flag(calendar,"ok"))ShowDendreoCalendarScreen(calendar);
      else status.Text+="\nCalendrier Dendreo indisponible.";
     }catch{calendarPreview.Visible=true;calendarPreview.BringToFront();status.Text+="\nCalendrier Dendreo indisponible.";}
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
  calendarPreview.Controls.Clear();calendarPreview.Visible=true;calendarPreview.BringToFront();
  calendarPreview.Bounds=new Rectangle(34,148,500,650);
  calendarPreview.Controls.Add(new Label{Text="Calendrier Dendreo - 28 prochains jours",Font=new Font("Segoe UI",12,FontStyle.Bold),ForeColor=Color.FromArgb(3,46,66),AutoSize=true,Location=new Point(10,10)});
  calendarPreview.Controls.Add(new Label{Text=Convert.ToString(response["from"])+" au "+Convert.ToString(response["to"]),Font=new Font("Segoe UI",8),ForeColor=Color.FromArgb(94,107,113),AutoSize=true,Location=new Point(10,37)});
  DateTime first=DateTime.ParseExact(Convert.ToString(response["from"]),"yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture);var byDate=new Dictionary<string,List<Dictionary<string,object>>>();
  foreach(object value in Values(response.ContainsKey("events")?response["events"]:null)){var ev=value as Dictionary<string,object>;if(ev==null)continue;foreach(object date in Values(ev.ContainsKey("dates")?ev["dates"]:null)){string key=Convert.ToString(date);if(!byDate.ContainsKey(key))byDate[key]=new List<Dictionary<string,object>>();byDate[key].Add(ev);}}
  TableLayoutPanel table=new TableLayoutPanel{Bounds=new Rectangle(8,65,480,570),ColumnCount=7,RowCount=4,CellBorderStyle=TableLayoutPanelCellBorderStyle.None,BackColor=Color.White};for(int c=0;c<7;c++)table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,14.2857f));for(int r=0;r<4;r++)table.RowStyles.Add(new RowStyle(SizeType.Percent,25f));
  for(int i=0;i<28;i++){DateTime date=first.AddDays(i);string key=date.ToString("yyyy-MM-dd");Panel cell=new Panel{Dock=DockStyle.Fill,Margin=new Padding(1),BackColor=Color.White,BorderStyle=BorderStyle.FixedSingle};cell.Controls.Add(new Label{Text=date.ToString("ddd dd/MM"),Dock=DockStyle.Top,Height=24,Font=new Font("Segoe UI",8,FontStyle.Bold),ForeColor=Color.FromArgb(3,46,66),Padding=new Padding(3,2,0,0)});FlowLayoutPanel list=new FlowLayoutPanel{Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false,AutoScroll=false,Padding=new Padding(2),BackColor=Color.Transparent};var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);if(byDate.ContainsKey(key))foreach(var ev in byDate[key]){string text=Convert.ToString(ev.ContainsKey("text")?ev["text"]:"").Replace("\r"," ").Replace("\n"," ").Trim();bool bot=(ev.ContainsKey("botOwned")&&Convert.ToBoolean(ev["botOwned"]))||text.IndexOf("[SDIS-BOT]",StringComparison.OrdinalIgnoreCase)>=0;string type=CalendarEventType(text,ev.ContainsKey("indispo")&&Convert.ToBoolean(ev["indispo"]));var dates=Values(ev.ContainsKey("dates")?ev["dates"]:null) as List<object> ?? new List<object>();if(bot)type=(dates.Count>1&&key!=Convert.ToString(dates[0]))?"Repos compensatoire":"Garde";string shown=bot?type:text.Replace("📅","").Replace("❌","").Trim();shown=Regex.Replace(shown,@"\s*\([12]/2\)","");shown=Regex.Replace(shown,@"\s*-\s*(matin|après-midi)$","",RegexOptions.IgnoreCase).Trim();shown=ShortCalendarText(String.IsNullOrWhiteSpace(shown)?type:shown,16);if(!seen.Add(shown))continue;cell.BackColor=CalendarEventColor(type);list.Controls.Add(new Label{Text=shown,Width=74,Height=20,Font=new Font("Segoe UI",7),ForeColor=Color.FromArgb(3,46,66),BackColor=Color.Transparent});}cell.Controls.Add(list);if(byDate.ContainsKey(key))cell.Controls.Add(new Label{Text=CalendarCellText(byDate[key],key),Dock=DockStyle.Fill,ForeColor=Color.FromArgb(3,46,66),BackColor=Color.Transparent,Font=new Font("Segoe UI",7),Padding=new Padding(3,25,2,2)});table.Controls.Add(cell,i%7,i/7);}
  calendarPreview.Controls.Add(table);
 }
 void ShowDendreoCalendarSimple(Dictionary<string,object> response){
  DateTime first=DateTime.ParseExact(Convert.ToString(response["from"]),"yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture);
  var byDate=new Dictionary<string,List<Dictionary<string,object>>>();
  foreach(object value in Values(response.ContainsKey("events")?response["events"]:null)){var ev=value as Dictionary<string,object>;if(ev==null)continue;foreach(object date in Values(ev.ContainsKey("dates")?ev["dates"]:null)){string key=Convert.ToString(date);if(!byDate.ContainsKey(key))byDate[key]=new List<Dictionary<string,object>>();byDate[key].Add(ev);}}
  Form page=new Form{Text="Calendrier Dendreo",StartPosition=FormStartPosition.CenterParent,ClientSize=new Size(920,700),MinimumSize=new Size(920,700),BackColor=Color.White};
  page.Controls.Add(new Label{Text="Calendrier Dendreo - 28 prochains jours",Font=new Font("Segoe UI",18,FontStyle.Bold),ForeColor=Color.FromArgb(3,46,66),AutoSize=true,Location=new Point(24,18)});
  page.Controls.Add(new Label{Text=Convert.ToString(response["from"])+" au "+Convert.ToString(response["to"]),Font=new Font("Segoe UI",10),ForeColor=Color.FromArgb(94,107,113),AutoSize=true,Location=new Point(26,52)});
  TableLayoutPanel table=new TableLayoutPanel{Bounds=new Rectangle(24,86,872,570),ColumnCount=7,RowCount=4,CellBorderStyle=TableLayoutPanelCellBorderStyle.None,BackColor=Color.White};
  for(int c=0;c<7;c++)table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,14.2857f));for(int r=0;r<4;r++)table.RowStyles.Add(new RowStyle(SizeType.Percent,25f));
  for(int i=0;i<28;i++){DateTime date=first.AddDays(i);string key=date.ToString("yyyy-MM-dd");Panel cell=new Panel{Dock=DockStyle.Fill,Margin=new Padding(2),BackColor=Color.White,BorderStyle=BorderStyle.FixedSingle};cell.Controls.Add(new Label{Text=date.ToString("ddd dd/MM"),Dock=DockStyle.Top,Height=26,Font=new Font("Segoe UI",8,FontStyle.Bold),ForeColor=Color.FromArgb(3,46,66),Padding=new Padding(3,3,0,0)});FlowLayoutPanel list=new FlowLayoutPanel{Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false,AutoScroll=false,Padding=new Padding(3,2,2,2),BackColor=Color.Transparent};var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);if(byDate.ContainsKey(key))foreach(var ev in byDate[key]){string text=Convert.ToString(ev.ContainsKey("text")?ev["text"]:"").Replace("\r"," ").Replace("\n"," ").Trim();bool bot=(ev.ContainsKey("botOwned")&&Convert.ToBoolean(ev["botOwned"]))||text.IndexOf("[SDIS-BOT]",StringComparison.OrdinalIgnoreCase)>=0;string type=CalendarEventType(text,ev.ContainsKey("indispo")&&Convert.ToBoolean(ev["indispo"]));var dates=Values(ev.ContainsKey("dates")?ev["dates"]:null) as List<object> ?? new List<object>();if(bot)type=(dates.Count>1&&key!=Convert.ToString(dates[0]))?"Repos compensatoire":"Garde";string shown=bot?type:text.Replace("📅","").Replace("❌","").Trim();shown=Regex.Replace(shown,@"\s*\([12]/2\)","");shown=Regex.Replace(shown,@"\s*-\s*(matin|après-midi)$","",RegexOptions.IgnoreCase).Trim();shown=ShortCalendarText(String.IsNullOrWhiteSpace(shown)?type:shown,14);if(!seen.Add(shown))continue;cell.BackColor=CalendarEventColor(type);list.Controls.Add(new Label{Text=shown,Width=62,Height=22,Font=new Font("Segoe UI",7),ForeColor=Color.FromArgb(3,46,66),BackColor=Color.Transparent});}cell.Controls.Add(list);table.Controls.Add(cell,i%7,i/7);}
  page.Controls.Add(table);page.Show(this);
 }
 void ShowDendreoCalendar(Dictionary<string,object> response){
  calendarPreview.Controls.Clear();
  calendarPreview.Visible=true;calendarPreview.BringToFront();
  Label previewTitle=new Label{Text="Calendrier Dendreo - 28 prochains jours",Font=new Font("Segoe UI",11,FontStyle.Bold),ForeColor=Color.FromArgb(3,46,66),AutoSize=true,Location=new Point(10,10)};calendarPreview.Controls.Add(previewTitle);
  Label previewPeriod=new Label{Text=Convert.ToString(response["from"])+" au "+Convert.ToString(response["to"]),Font=new Font("Segoe UI",8),ForeColor=Color.FromArgb(94,107,113),AutoSize=true,Location=new Point(10,34)};calendarPreview.Controls.Add(previewPeriod);
  DateTime first=DateTime.ParseExact(Convert.ToString(response["from"]),"yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture);
  var eventsByDate=new Dictionary<string,List<Dictionary<string,object>>>();
  foreach(object value in Values(response.ContainsKey("events")?response["events"]:null)){var ev=value as Dictionary<string,object>;if(ev==null)continue;foreach(object date in Values(ev.ContainsKey("dates")?ev["dates"]:null)){string key=Convert.ToString(date);if(!eventsByDate.ContainsKey(key))eventsByDate[key]=new List<Dictionary<string,object>>();eventsByDate[key].Add(ev);}}
  int offset=0;int rows=(28+6)/7;TableLayoutPanel table=new TableLayoutPanel{Bounds=new Rectangle(8,62,554,575),ColumnCount=7,RowCount=rows,CellBorderStyle=TableLayoutPanelCellBorderStyle.None,BackColor=Color.White};
  for(int c=0;c<7;c++)table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,14.2857f));for(int r=0;r<rows;r++)table.RowStyles.Add(new RowStyle(SizeType.Percent,100f/rows));
  for(int slot=0;slot<rows*7;slot++){int dayIndex=slot-offset;Panel cell=new Panel{Dock=DockStyle.Fill,Margin=new Padding(1),BackColor=Color.White};if(dayIndex>=0&&dayIndex<28){cell.BorderStyle=BorderStyle.FixedSingle;DateTime date=first.AddDays(dayIndex);string key=date.ToString("yyyy-MM-dd");Label day=new Label{Text=date.ToString("ddd dd"),Dock=DockStyle.Top,Height=24,Font=new Font("Segoe UI",8,FontStyle.Bold),ForeColor=Color.FromArgb(3,46,66),Padding=new Padding(3,2,0,0)};cell.Controls.Add(day);FlowLayoutPanel list=new FlowLayoutPanel{Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false,AutoScroll=false,Padding=new Padding(2,0,2,2),BackColor=Color.Transparent};HashSet<string> seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);if(eventsByDate.ContainsKey(key))foreach(var ev in eventsByDate[key]){string text=Convert.ToString(ev.ContainsKey("text")?ev["text"]:"").Replace("\r"," ").Replace("\n"," ").Trim();bool bot=(ev.ContainsKey("botOwned")&&Convert.ToBoolean(ev["botOwned"]))||text.IndexOf("[SDIS-BOT]",StringComparison.OrdinalIgnoreCase)>=0;string type=CalendarEventType(text,ev.ContainsKey("indispo")&&Convert.ToBoolean(ev["indispo"]));List<object> dates=Values(ev.ContainsKey("dates")?ev["dates"]:null) as List<object> ?? new List<object>();if(bot){type=(dates.Count>1&&key!=Convert.ToString(dates[0]))?"Repos compensatoire":"Garde";}string shown=bot?type:text.Replace("📅","").Replace("❌","").Trim();shown=Regex.Replace(shown,@"\s*\([12]/2\)","");shown=Regex.Replace(shown,@"\s*-\s*(matin|après-midi)$","",RegexOptions.IgnoreCase).Trim();shown=ShortCalendarText(shown,18);if(String.IsNullOrWhiteSpace(shown))shown=type;if(!seen.Add(shown))continue;cell.BackColor=CalendarEventColor(type);Label item=new Label{Text=shown,Width=74,Height=20,Font=new Font("Segoe UI",7f),ForeColor=Color.FromArgb(3,46,66),BackColor=Color.Transparent,Margin=new Padding(0,1,0,1),AutoEllipsis=false};list.Controls.Add(item);}cell.Controls.Add(list);cell.Controls.Add(new Label{Text=CalendarCellText(eventsByDate[key],key),Dock=DockStyle.Fill,ForeColor=Color.FromArgb(3,46,66),BackColor=Color.Transparent,Font=new Font("Segoe UI",7f),AutoEllipsis=false,Padding=new Padding(3,25,2,2)});}table.Controls.Add(cell,slot%7,slot/7);}
  calendarPreview.Controls.Add(table);
  calendarPreview.Visible=true;calendarPreview.BringToFront();
  return;
  Form page=new Form{Text="Dendreo - calendrier des 31 prochains jours",StartPosition=FormStartPosition.CenterParent,ClientSize=new Size(900,620),MinimumSize=new Size(700,420),BackColor=Color.White};
  Label title=new Label{Text="Événements Dendreo",Font=new Font("Segoe UI",18,FontStyle.Bold),ForeColor=Color.FromArgb(3,46,66),AutoSize=true,Location=new Point(22,18)};page.Controls.Add(title);
  Label period=new Label{Text="Tous les événements du "+Convert.ToString(response["from"])+" au "+Convert.ToString(response["to"]),Font=new Font("Segoe UI",10),ForeColor=Color.FromArgb(94,107,113),AutoSize=true,Location=new Point(24,55)};page.Controls.Add(period);
  DataGridView grid=new DataGridView{Bounds=new Rectangle(22,88,856,500),ReadOnly=true,AllowUserToAddRows=false,AllowUserToDeleteRows=false,AllowUserToResizeRows=false,RowHeadersVisible=false,AutoGenerateColumns=false,BackgroundColor=Color.White,BorderStyle=BorderStyle.FixedSingle,SelectionMode=DataGridViewSelectionMode.FullRowSelect,MultiSelect=false};
  grid.Columns.Add(new DataGridViewTextBoxColumn{HeaderText="Date",Width=125});
  grid.Columns.Add(new DataGridViewTextBoxColumn{HeaderText="Horaire",Width=125});
  grid.Columns.Add(new DataGridViewTextBoxColumn{HeaderText="Événement Dendreo",AutoSizeMode=DataGridViewAutoSizeColumnMode.Fill});
  grid.Columns.Add(new DataGridViewTextBoxColumn{HeaderText="Type",Width=145});
  object raw=response.ContainsKey("events")?response["events"]:null;
  foreach(object value in Values(raw)){
   var ev=value as Dictionary<string,object>;if(ev==null)continue;
   string text=Convert.ToString(ev.ContainsKey("text")?ev["text"]:"");
   string type=CalendarEventType(text,ev.ContainsKey("indispo")&&Convert.ToBoolean(ev["indispo"]));
   string hours=Convert.ToString(ev.ContainsKey("startTime")?ev["startTime"]:"");
   string end=Convert.ToString(ev.ContainsKey("endTime")?ev["endTime"]:"");
   if(!String.IsNullOrWhiteSpace(end)&&end!="00:00")hours+=" - "+end;
   foreach(object date in Values(ev.ContainsKey("dates")?ev["dates"]:null)){int row=grid.Rows.Add(Convert.ToString(date),hours,text,type);grid.Rows[row].DefaultCellStyle.BackColor=CalendarEventColor(type);}
  }
  if(grid.Rows.Count==0){int row=grid.Rows.Add("","","Aucun événement Dendreo sur cette période.","");grid.Rows[row].DefaultCellStyle.ForeColor=Color.Gray;}
  page.Controls.Add(grid);page.Show(this);
  }
 string CalendarCellText(List<Dictionary<string,object>> events,string date){var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var labels=new List<string>();foreach(var ev in events??new List<Dictionary<string,object>>()){string text=Convert.ToString(ev.ContainsKey("text")?ev["text"]:"").Replace("\r"," ").Replace("\n"," ").Trim();bool bot=(ev.ContainsKey("botOwned")&&Convert.ToBoolean(ev["botOwned"]))||text.IndexOf("[SDIS-BOT]",StringComparison.OrdinalIgnoreCase)>=0;string type=CalendarEventType(text,ev.ContainsKey("indispo")&&Convert.ToBoolean(ev["indispo"]));List<object> dates=Values(ev.ContainsKey("dates")?ev["dates"]:null) as List<object> ?? new List<object>();if(bot)type=(dates.Count>1&&date!=Convert.ToString(dates[0]))?"Repos compensatoire":"Garde";string shown=bot?type:text.Replace("📅","").Replace("❌","").Trim();shown=Regex.Replace(shown,@"\s*\([12]/2\)","");shown=Regex.Replace(shown,@"\s*-\s*(matin|après-midi)$","",RegexOptions.IgnoreCase).Trim();shown=ShortCalendarText(String.IsNullOrWhiteSpace(shown)?type:shown,18);if(seen.Add(shown))labels.Add(shown);}return String.Join("\n",labels);}
 string ShortCalendarText(string value,int length){string text=(value??"").Trim();if(text.Length<=length)return text;return text.Substring(0,Math.Max(1,length-1))+"…";}
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
 void SetBusy(bool value,string message,bool showProgress){busy=value;syncProgressMode=value&&showProgress;busyText.Text=message;busyPanel.Visible=syncProgressMode;syncProgress.Visible=syncProgressMode;progressDetail.Visible=syncProgressMode;progressCounters.Visible=syncProgressMode;progressDuration.Visible=syncProgressMode;if(value){syncStartedAt=DateTime.Now;syncProgress.Value=0;progressDetail.Text="";progressCounters.Text="";progressDuration.Text="";busyTimer.Tag=0;busySpinner.Text="|";busyTimer.Start();if(syncProgressMode){progressTimer.Start();busyPanel.BringToFront();}}else{busyTimer.Stop();progressTimer.Stop();busyPanel.Visible=false;}foreach(Button b in buttons){b.Visible=!value;b.Enabled=!value;}reposCheck.Visible=!value;reposCheck.Enabled=!value;}
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
