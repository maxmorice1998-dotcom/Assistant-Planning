const fs=require('fs'),path=require('path');
const file=path.join(__dirname,'..','SDIS-Collegues.cs');
const old=fs.readFileSync(file,'utf8');
const request=old.slice(old.indexOf(' Dictionary<string,object> Request('),old.indexOf(' async void Call('));
const ui=`internal sealed class MainForm:Form {
 readonly Label status=new Label(),summary=new Label(),lastCheck=new Label();
 readonly Label googleBadge=new Label(),agattBadge=new Label(),dendreoBadge=new Label();
 readonly List<Button> buttons=new List<Button>();
 readonly JavaScriptSerializer json=new JavaScriptSerializer();
 bool busy;
 public MainForm(){
  Text="Assistant Planning";ClientSize=new Size(600,560);MinimumSize=new Size(616,599);
  StartPosition=FormStartPosition.CenterScreen;Font=new Font("Segoe UI",11);BackColor=Color.FromArgb(247,247,247);
  Controls.Add(new Label{Text="Assistant Planning",Font=new Font("Segoe UI",25,FontStyle.Bold),ForeColor=Color.FromArgb(3,46,66),AutoSize=true,Location=new Point(28,22)});
  summary.Text="Connectez vos trois services pour commencer.";summary.SetBounds(30,82,540,48);Controls.Add(summary);
  AddService("Google",googleBadge,"Connecter Google","google",140);
  AddService("AGATT",agattBadge,"Connecter AGATT","open-agatt",222);
  AddService("Dendreo",dendreoBadge,"Connecter Dendreo","open-dendreo",304);
  Button test=new Button{Text="Tester le système",Bounds=new Rectangle(30,400,540,42),BackColor=Color.FromArgb(3,46,66),ForeColor=Color.White,FlatStyle=FlatStyle.Flat};
  test.Click+=(s,e)=>Call("simulate");buttons.Add(test);Controls.Add(test);
  lastCheck.Text="Dernière vérification : pas encore effectuée";lastCheck.SetBounds(30,454,540,25);lastCheck.ForeColor=Color.DimGray;Controls.Add(lastCheck);
  status.SetBounds(30,489,540,60);status.Text="";Controls.Add(status);
  Shown+=(s,e)=>Call("status");
  FormClosing+=(s,e)=>{if(busy){e.Cancel=true;status.Text="Une connexion ou une vérification est en cours. Terminez-la avant de fermer.";}};
 }
 void AddService(string name,Label badge,string caption,string action,int y){
  Controls.Add(new Label{Text=name,Font=new Font("Segoe UI",13,FontStyle.Bold),AutoSize=true,Location=new Point(30,y)});
  badge.Text=name+" : à connecter";badge.SetBounds(30,y+30,325,28);Controls.Add(badge);
  Button button=new Button{Text=caption,Bounds=new Rectangle(365,y+4,205,42),BackColor=Color.FromArgb(255,0,0),ForeColor=Color.White,FlatStyle=FlatStyle.Flat};
  button.Click+=(s,e)=>Call(action);buttons.Add(button);Controls.Add(button);
 }
`+request+`
 async void Call(string action){
  if(busy)return;busy=true;foreach(Button b in buttons)b.Enabled=false;
  status.ForeColor=Color.FromArgb(3,46,66);
  status.Text=action=="google"?"Ouverture de Google… Terminez la connexion dans votre navigateur.":"Vérification en cours…";
  try{
   var response=await Task.Run(()=>Request(new Dictionary<string,object>{{"action",action}}));
   if(!Flag(response,"ok")){
    ShowError(action=="google"?Convert.ToString(response["message"]):"La vérification n’a pas abouti. Vérifiez les connexions ci-dessus puis réessayez.");
    return;
   }
   if(action=="status")ApplyStatus(response);
   else if(action=="google"||action=="simulate"){
    if(action=="google"){googleBadge.Text="✅ Google connecté";googleBadge.ForeColor=Color.ForestGreen;status.Text="✅ Google connecté";}
    var refreshed=await Task.Run(()=>Request(new Dictionary<string,object>{{"action","status"}}));
    if(Flag(refreshed,"ok"))ApplyStatus(refreshed);
    else ShowError("La vérification est temporairement indisponible. Réessayez.");
   }else status.Text="Terminez la connexion dans votre navigateur, puis cliquez sur Tester le système.";
  }catch{ShowError(action=="google"?"La connexion Google ne peut pas démarrer. Vérifiez votre connexion Internet puis réessayez. Si le problème persiste, contactez votre distributeur.":"La vérification est indisponible. Relancez Assistant Planning puis réessayez.");}
  finally{busy=false;foreach(Button b in buttons)b.Enabled=true;}
 }
 void ShowError(string message){
  status.ForeColor=Color.Firebrick;status.Text=message;
  MessageBox.Show(this,message,"Assistant Planning",MessageBoxButtons.OK,MessageBoxIcon.Warning);
 }
 static bool Flag(Dictionary<string,object> value,string key){return value!=null&&value.ContainsKey(key)&&Convert.ToBoolean(value[key]);}
 bool Badge(Label label,string name,Dictionary<string,object> state){
  bool connected=Flag(state,"connected");
  label.Text=connected?"✅ "+name+" connecté":(Flag(state,"temporary")?name+" : réessayez plus tard":(Flag(state,"reconnect")?name+" : reconnexion nécessaire":name+" : à connecter"));
  label.ForeColor=connected?Color.ForestGreen:Color.DimGray;return connected;
 }
 void ApplyStatus(Dictionary<string,object> response){
  bool google=Badge(googleBadge,"Google",response["googleStatus"] as Dictionary<string,object>);
  bool agatt=Badge(agattBadge,"AGATT",response["agattStatus"] as Dictionary<string,object>);
  bool dendreo=Badge(dendreoBadge,"Dendreo",response["dendreoStatus"] as Dictionary<string,object>);
  summary.Text=google&&agatt&&dendreo?"Assistant Planning est prêt.":"Connectez vos trois services pour commencer.";
  lastCheck.Text="Dernière vérification : "+DateTime.Now.ToString("dd/MM/yyyy à HH:mm");
  status.Text=google&&agatt&&dendreo?"Assistant Planning est prêt.":"";
 }
}
`;
fs.writeFileSync(file,old.slice(0,old.indexOf('internal sealed class MainForm:Form'))+ui);
