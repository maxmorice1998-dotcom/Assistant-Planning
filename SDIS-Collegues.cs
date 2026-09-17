using System;
using System.IO;
using System.Text;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using System.Collections.Generic;
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
    ShortcutRepair.Repair();
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
 readonly Timer busyTimer=new Timer();
 readonly Timer progressTimer=new Timer();
 DateTime syncStartedAt;
 bool busy;
 bool syncProgressMode;
 bool allowClose;
 public MainForm(){
 Text="Assistant Planning";ClientSize=new Size(640,800);MinimumSize=new Size(656,839);
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
   Button logs=new Button{Text="Ouvrir les logs",Bounds=new Rectangle(34,720,180,34)};logs.Click+=(s,e)=>{try{string file=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"SDIS-Bot-Collegues","assistant-planning.log");Directory.CreateDirectory(Path.GetDirectoryName(file));if(!File.Exists(file))File.WriteAllText(file,"");Process.Start(new ProcessStartInfo{FileName="notepad.exe",Arguments="\""+file+"\"",UseShellExecute=false});}catch{}};buttons.Add(logs);Controls.Add(logs);
  Button updates=new Button{Text="Vérifier les mises à jour",Bounds=new Rectangle(224,680,240,34)};updates.Click+=(s,e)=>Call("update-check");buttons.Add(updates);Controls.Add(updates);
   updates.SetBounds(224,720,240,34);
    buildInfo.Text=BuildLabel();buildInfo.SetBounds(34,760,570,24);buildInfo.ForeColor=Color.FromArgb(120,128,132);buildInfo.Font=new Font("Segoe UI",9);Controls.Add(buildInfo);
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
  FormClosing+=(s,e)=>{if(busy&&!allowClose){e.Cancel=true;status.Text="Une connexion ou une verification est en cours.";}};
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
   Task<string> output=process.StandardOutput.ReadToEndAsync();
   Task<string> errors=process.StandardError.ReadToEndAsync();
   using(StreamWriter input=new StreamWriter(process.StandardInput.BaseStream,new UTF8Encoding(false))){
    input.Write(json.Serialize(request));
   }
   if(!process.WaitForExit(1800000)){process.Kill();throw new Exception("Delai depasse.");}
   Task.WaitAll(output,errors);
   if(process.ExitCode!=0)throw new Exception("Le programme est incomplet ou indisponible.");
   return json.Deserialize<Dictionary<string,object>>(output.Result);
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
   if(Flag(response,"updated")){status.Text="Mise a jour d'Assistant Planning...";allowClose=true;Application.Exit();return;}
    RefreshStatusInBackground();
    if(Flag(response,"warning"))status.Text="Mise a jour impossible - version actuelle conservee";
    else status.Text="";
   }else if(action=="status")ApplyStatus(response);
   else if(action=="update-check"){
    if(Flag(response,"available")){status.Text="Nouvelle version détectée : téléchargement du package complet...";var installed=await Task.Run(()=>Request(new Dictionary<string,object>{{"action","update-install"}}));if(Flag(installed,"ok")){status.Text="Mise à jour en cours. Assistant Planning va redémarrer.";allowClose=true;Application.Exit();}else ShowError(Convert.ToString(installed["message"]));}
    else status.Text=Convert.ToString(response["message"]);
   }
   else if(action=="google"||action=="simulate"||action=="synchronize"||action=="open-agatt"||action=="open-dendreo"){
    if(action=="google"){googleBadge.Text="\u2705 Google connect\u00E9";googleBadge.ForeColor=Color.ForestGreen;status.Text="\u2705 Google connect\u00E9";}
    if(action=="open-agatt"){agattBadge.Text="\u2705 AGATT connect\u00E9";agattBadge.ForeColor=Color.ForestGreen;status.Text="\u2705 AGATT connect\u00E9";}
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
    if(action=="synchronize")status.Text=FormatSyncResult(response);
    if(action=="open-agatt"||action=="open-dendreo")status.Text=Convert.ToString(response["message"]);
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
  string FormatSyncResult(Dictionary<string,object> response){
   string text=Convert.ToString(response.ContainsKey("message")?response["message"]:"");
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
  summary.Text=google&&agatt&&dendreo?"Assistant Planning est pret.":"Connectez vos trois services pour commencer.";
  lastCheck.Text="Derniere verification : "+DateTime.Now.ToString("dd/MM/yyyy HH:mm");
  status.Text=google&&agatt&&dendreo?"Assistant Planning est pret.":"";
  updatingRepos=true;reposCheck.Checked=Flag(response,"reposCompensatoire");updatingRepos=false;
 }
}
