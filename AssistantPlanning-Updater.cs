using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class UpdaterProgram {
 [STAThread] static void Main(){Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new UpdaterForm());}
}
internal sealed class UpdaterForm:Form {
 readonly Label title=new Label(),step=new Label(),detail=new Label(),warning=new Label();
 readonly ProgressBar progress=new ProgressBar();
 readonly Button open=new Button(),close=new Button();
 readonly Timer spinnerTimer=new Timer();
 readonly JavaScriptSerializer json=new JavaScriptSerializer();
 readonly string root=AppDomain.CurrentDomain.BaseDirectory;
 Process node;bool finished,gotResult;int frame;
 public UpdaterForm(){
  Text="Assistant Planning - Mise a jour";ClientSize=new Size(540,300);MinimumSize=new Size(540,300);MaximumSize=new Size(540,300);StartPosition=FormStartPosition.CenterScreen;FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;MinimizeBox=false;BackColor=Color.FromArgb(250,250,249);ShowInTaskbar=true;
  title.Text="Assistant Planning";title.Font=new Font("Segoe UI",20,FontStyle.Bold);title.ForeColor=Color.FromArgb(3,46,66);title.SetBounds(32,24,470,38);Controls.Add(title);
  step.Text="Recherche de mise a jour";step.Font=new Font("Segoe UI",13,FontStyle.Bold);step.ForeColor=Color.FromArgb(232,35,42);step.SetBounds(32,78,470,30);Controls.Add(step);
  detail.Text="Version actuelle : recherche...";detail.Font=new Font("Segoe UI",10);detail.ForeColor=Color.FromArgb(70,80,84);detail.SetBounds(32,115,470,26);Controls.Add(detail);
  progress.SetBounds(32,154,476,20);progress.Style=ProgressBarStyle.Marquee;progress.MarqueeAnimationSpeed=30;Controls.Add(progress);
  warning.Text="Ne fermez pas Assistant Planning pendant la mise a jour.";warning.Font=new Font("Segoe UI",9);warning.ForeColor=Color.FromArgb(90,90,90);warning.SetBounds(32,188,476,25);Controls.Add(warning);
  open.Text="Ouvrir Assistant Planning";open.SetBounds(252,235,170,34);open.Visible=false;open.Click+=(s,e)=>{StartMain();};Controls.Add(open);
  close.Text="Fermer";close.SetBounds(432,235,76,34);close.Visible=false;close.Click+=(s,e)=>{AllowClose();Close();};Controls.Add(close);
  spinnerTimer.Interval=140;spinnerTimer.Tick+=(s,e)=>{frame=(frame+1)%4;Text="Assistant Planning - Mise a jour "+new string('.',frame);};
  Load+=(s,e)=>Start();FormClosing+=(s,e)=>{if(!finished){e.Cancel=true;}};
 }
 void Start(){spinnerTimer.Start();try{ProcessStartInfo info=new ProcessStartInfo{FileName=Path.Combine(root,"runtime","node","node.exe"),Arguments="\""+Path.Combine(root,"update-ui-runner.js")+"\" --parent-pid "+Process.GetCurrentProcess().Id,WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};node=Process.Start(info);Task.Factory.StartNew(new Action(ReadOutput));}catch(Exception ex){Fail(ex.Message);}}
 void ReadOutput(){try{string line;while((line=node.StandardOutput.ReadLine())!=null){string copy=line;try{BeginInvoke((Action)(()=>HandleLine(copy)));}catch{return;}}string err=node.StandardError.ReadToEnd();if(!finished&&(node.ExitCode!=0||!gotResult))BeginInvoke((Action)(()=>Fail(string.IsNullOrWhiteSpace(err)?"Le moteur de mise a jour a echoue.":err.Trim())));}catch(Exception ex){if(!finished)try{BeginInvoke((Action)(()=>Fail(ex.Message)));}catch{}}}
 void HandleLine(string line){try{DictionaryLike data=new DictionaryLike(json.DeserializeObject(line));if(data.Get("type")=="stage"){step.Text=data.Get("stage");if(data.Get("version")!=null)detail.Text="Version actuelle : "+data.Get("currentVersion")+"   Nouvelle version : v"+data.Get("version");return;}if(data.Get("type")=="progress"){string name=data.Get("stage")??"Mise a jour en cours";step.Text=name;double downloaded=data.Number("downloaded"),total=data.Number("total");if(total>0){progress.Style=ProgressBarStyle.Continuous;progress.Value=Math.Max(0,Math.Min(100,(int)Math.Round(downloaded*100/total)));detail.Text="Téléchargement : "+FormatBytes(downloaded)+" / "+FormatBytes(total)+"   "+progress.Value+" %";}else{progress.Style=ProgressBarStyle.Marquee;detail.Text="Téléchargement en cours...";}return;}if(data.Get("type")=="result"){gotResult=true;if(data.Get("ok")=="True"||data.Get("ok")=="true"){if(data.Get("available")=="False"||data.Get("available")=="false"){step.Text="Assistant Planning demarre";detail.Text="Aucune mise a jour disponible.";StartMain();}else{step.Text="Redemarrage d Assistant Planning";detail.Text="La nouvelle version va demarrer.";FinishAndClose();}}else Fail(data.Get("error")??"La mise a jour n a pas pu etre installee.");}}catch(Exception ex){Fail(ex.Message);}}
 string FormatBytes(double n){if(n<1024*1024)return ((long)n/1024)+" Ko";return (n/(1024*1024)).ToString("0.0")+" Mo";}
 void Fail(string message){if(finished)return;spinnerTimer.Stop();step.Text="La mise a jour n a pas pu etre installee.";detail.Text=message;warning.Text="La version actuelle est conservee. Consultez le journal pour le detail.";progress.Style=ProgressBarStyle.Continuous;progress.Value=0;open.Visible=true;close.Visible=true;}
 void StartMain(){try{Process.Start(new ProcessStartInfo{FileName=Path.Combine(root,"SDIS-Collegues.exe"),Arguments="--skip-update",WorkingDirectory=root,UseShellExecute=false});FinishAndClose();}catch(Exception ex){Fail(ex.Message);}}
 void FinishAndClose(){finished=true;spinnerTimer.Stop();AllowClose();Close();}
 void AllowClose(){finished=true;}
 sealed class DictionaryLike {
  readonly System.Collections.Generic.Dictionary<string,object> value;
  public DictionaryLike(object source){value=source as System.Collections.Generic.Dictionary<string,object>??new System.Collections.Generic.Dictionary<string,object>();}
  public string Get(string key){object v;if(!value.TryGetValue(key,out v)||v==null)return null;return Convert.ToString(v);}
  public double Number(string key){object v;if(!value.TryGetValue(key,out v)||v==null)return 0;double d;return Double.TryParse(Convert.ToString(v),out d)?d:0;}
 }
}
