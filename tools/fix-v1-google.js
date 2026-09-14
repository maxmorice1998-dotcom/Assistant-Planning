const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const file = path.join(root, 'google-oauth-v2.js');
let s = fs.readFileSync(file, 'utf8');
s = s.replace('if(!id)throw new Error("OAuth Google non configure par le distributeur.");', 'if(!id || !String(x.clientSecret||" ").trim())throw new Error("La connexion Google ne peut pas démarrer : cette installation est incomplète. Contactez votre distributeur pour obtenir une version corrigée.");');
s = s.replace('clientSecret:"",scopes', 'clientSecret:String(x.clientSecret).trim(),scopes');
s = s.replace(/function openBrowser\(url\)\{[^\n]+/, `function openBrowser(url){return new Promise((resolve,reject)=>{
 const p=spawn("rundll32.exe",["url.dll,FileProtocolHandler",url],{windowsHide:true,stdio:"ignore"});
 p.once("error",()=>reject(new Error("Impossible d’ouvrir le navigateur. Vérifiez qu’un navigateur par défaut est installé, puis réessayez.")));
 p.once("exit",code=>code===0?resolve():reject(new Error("Impossible d’ouvrir le navigateur. Vérifiez votre navigateur par défaut, puis réessayez.")));
});}`);
const a = s.indexOf('function waitCode('), b = s.indexOf('function authFailure(', a);
s = s.slice(0,a) + `function waitCode(server,state,exchange){
 let cancel;
 const promise=new Promise((resolve,reject)=>{
  let done=false,processing=false;
  const timer=setTimeout(()=>finish(new Error("L’autorisation Google a expiré. Cliquez à nouveau sur Connecter Google.")),300000);
  function finish(error,value){if(done)return;done=true;clearTimeout(timer);server.close();error?reject(error):resolve(value);}
  cancel=error=>finish(error);
  server.on("request",async(req,res)=>{
   const u=new URL(req.url,"http://127.0.0.1");
   if(u.pathname!=="/oauth2callback"){res.writeHead(404);res.end();return;}
   if(u.searchParams.get("state")!==state){res.writeHead(400);res.end("Réponse non reconnue.");return;}
   if(done||processing){res.writeHead(409);res.end();return;}
   processing=true;
   try {
    if(u.searchParams.has("error"))throw new Error("Connexion Google annulée. Vous pouvez réessayer.");
    const code=u.searchParams.get("code");
    if(!code)throw new Error("Google n’a pas renvoyé l’autorisation. Réessayez.");
    const result=await exchange(code);
    if(done){res.writeHead(408);res.end("Délai dépassé. Revenez dans Assistant Planning.");return;}
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(successPage());finish(null,result);
   }catch(error){res.writeHead(400,{"Content-Type":"text/html; charset=utf-8"});res.end("<h1>Connexion Google non terminée</h1><p>Revenez dans Assistant Planning pour réessayer.</p>");finish(error);}
  });
 });
 return {promise,cancel};
}
` + s.slice(b);
const c = s.indexOf('async function connectGoogle()'), d = s.indexOf('async function authorizedClient()',c);
s = s.slice(0,c) + `async function connectGoogle(){
 rt.initialize();const cfg=config();
 const server=http.createServer();
 try{await new Promise((resolve,reject)=>server.listen(0,"127.0.0.1",resolve).once("error",reject));}
 catch{throw new Error("La connexion Google ne peut pas démarrer. Fermez puis relancez Assistant Planning et réessayez.");}
 let waiting;
 try{
  const redirect=\`http://127.0.0.1:\${server.address().port}/oauth2callback\`;
  const auth=new google.auth.OAuth2({clientId:cfg.clientId,clientSecret:cfg.clientSecret,redirectUri:redirect,clientAuthentication:"ClientSecretPost"});
  const state=crypto.randomBytes(32).toString("hex"),pkce=await auth.generateCodeVerifierAsync();
  waiting=waitCode(server,state,async code=>{
   let tokens;
   try{tokens=(await auth.getToken({code,codeVerifier:pkce.codeVerifier,redirect_uri:redirect})).tokens;}
   catch(error){tokenExchangeDiagnostic(error,{code,codeVerifier:pkce.codeVerifier,clientId:cfg.clientId,redirectUri:redirect});throw new Error("Google n’a pas pu terminer la connexion. Réessayez ; si le problème persiste, contactez votre distributeur.");}
   if(!tokens.refresh_token&&rt.hasSecret("google-token"))tokens.refresh_token=rt.token().refresh_token;
   if(!tokens.refresh_token)throw new Error("Google n’a pas confirmé l’accès durable. Cliquez à nouveau sur Connecter Google.");
   auth.setCredentials(tokens);
   const email=await accountEmail(auth);
   const dry=rt.readJson("dendreo-config.json",{dryRun:true}).dryRun;
   const calendar=await ensureCalendar(auth,cfg,!dry);
   rt.saveSecret("google-token",JSON.stringify(tokens));saveAccountEmail(email);
   return {...calendar,email};
  });
  // Install the callback handler before opening the browser.
  const opened=openBrowser(auth.generateAuthUrl({access_type:"offline",prompt:"consent",scope:cfg.scopes,state,code_challenge:pkce.codeChallenge,code_challenge_method:"S256"}));
  opened.catch(error=>waiting.cancel(error));
  const [result]=await Promise.all([waiting.promise,opened]);return result;
 }finally{if(waiting)waiting.cancel(new Error("Connexion Google interrompue."));server.close();}
}
` + s.slice(d);
s = s.replace('if(!rt.hasSecret("google-client-secret"))throw new Error("Configuration Google requise.");','');
s = s.replace('const secret=rt.secret("google-client-secret"),auth=', 'const secret=cfg.clientSecret,auth=');
s = s.replace('clientAuthentication:"None"','clientAuthentication:"ClientSecretPost"');
fs.writeFileSync(file,s);
const runtime=path.join(root,'runtime-config.js');
let r=fs.readFileSync(runtime,'utf8');
r=r.replace(/ \/\/ Le secret client reste[^]*?const clientSecret=hasSecret\("google-client-secret"\)\?secret\("google-client-secret"\):"";/, ' // OAuth Desktop application credentials ship with the application; user tokens remain DPAPI protected.\n const clientSecret=String(cfg.clientSecret||"").trim();\n if(!clientSecret)throw new Error("Installation Google incomplète. Contactez votre distributeur.");');
fs.writeFileSync(runtime,r);
