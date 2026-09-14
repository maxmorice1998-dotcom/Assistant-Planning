"use strict";
const http=require("http"),crypto=require("crypto"),fs=require("fs"),path=require("path");
const {spawn}=require("child_process");
const {google}=require("googleapis");
const rt=require("./runtime-config");
function config(){
 const x=rt.readProgramJson("google-oauth-config.json",{}),id=String(x.clientId||"").trim();
 if(!id || !String(x.clientSecret||" ").trim())throw new Error("La connexion Google ne peut pas démarrer : cette installation est incomplète. Contactez votre distributeur pour obtenir une version corrigée.");
 const scopes=Array.isArray(x.scopes)&&x.scopes.length?x.scopes.map(String):["https://www.googleapis.com/auth/calendar.app.created","https://www.googleapis.com/auth/calendar.calendarlist.readonly","https://www.googleapis.com/auth/userinfo.email"];
 return {clientId:id,clientSecret:String(x.clientSecret).trim(),scopes,calendarSummary:String(x.calendarSummary||"SDIS-BOT"),calendarMarker:String(x.calendarMarker||"[SDIS-BOT]")};
}
function isConfigured(){try{config();return true;}catch{return false;}}
function openBrowser(url){return new Promise((resolve,reject)=>{
 const p=spawn("rundll32.exe",["url.dll,FileProtocolHandler",url],{windowsHide:true,stdio:"ignore"});
 p.once("error",()=>reject(new Error("Impossible d’ouvrir le navigateur. Vérifiez qu’un navigateur par défaut est installé, puis réessayez.")));
 p.once("exit",code=>code===0?resolve():reject(new Error("Impossible d’ouvrir le navigateur. Vérifiez votre navigateur par défaut, puis réessayez.")));
});}
function successPage(){let logo="";try{logo="data:image/png;base64,"+fs.readFileSync(path.join(__dirname,"assets","udsp14-logo.png")).toString("base64");}catch{}const logoHtml=logo?`<img class="logo" src="${logo}" alt="UDSP14">`:"";return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connexion Google réussie</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7f8;color:#0e0e0e;font-family:"Segoe UI",Arial,sans-serif}.card{box-sizing:border-box;width:min(92vw,520px);padding:42px 38px;text-align:center;background:#fff;border-top:5px solid #ff0000;border-radius:14px;box-shadow:0 12px 35px #032e4222}.logo{display:block;max-width:210px;max-height:82px;width:auto;height:auto;margin:0 auto 24px}.check{width:62px;height:62px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;background:#e7f6ed;color:#198754;font-size:38px;font-weight:700}.eyebrow{margin:0 0 9px;color:#5e6b71;font-size:12px;letter-spacing:.14em;font-weight:700}.title{margin:0;color:#032e42;font-size:27px;line-height:1.2}.text{margin:16px 0 0;color:#5e6b71;font-size:16px;line-height:1.5}.close{margin:24px 0 0;color:#5e6b71;font-size:13px}.fallback{display:none;margin:12px 0 0;color:#5e6b71;font-size:13px}</style></head><body><main class="card">${logoHtml}<div class="check" aria-label="Succès">✓</div><p class="eyebrow">CENTRE DE FORMATION UDSP14</p><h1 class="title">✅ Connexion Google réussie</h1><p class="text">Retour à Assistant Planning…</p><p class="close">Cette fenêtre va se fermer automatiquement.</p><p id="fallback" class="fallback">✅ Google est connecté. Vous pouvez fermer cette page.</p></main><script>setTimeout(function(){window.close();},1000);setTimeout(function(){var e=document.getElementById('fallback');if(e)e.style.display='block';},2500);</script></body></html>`;}
function waitCode(server,state,exchange){
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
function authFailure(error){const status=error&&error.response&&error.response.status;const body=JSON.stringify(error&&error.response&&error.response.data||"");const text=String(error&&error.message||"");return status===401||status===403||/invalid_grant|unauthorized_client|access_denied|revoked|invalid_token|Reconnecter Google/i.test(text+body);}
function networkFailure(error){const status=error&&error.response&&error.response.status;return !status||/ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(String(error&&error.message||""));}
async function listCalendars(api){const out=[];let pageToken;do{const r=await api.calendarList.list({minAccessRole:"writer",showDeleted:false,maxResults:250,pageToken});out.push(...(r.data.items||[]));pageToken=r.data.nextPageToken;}while(pageToken);return out;}
async function accountEmail(auth){const r=await google.oauth2({version:"v2",auth}).userinfo.get();const email=String(r.data&&r.data.email||"").trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Adresse Google indisponible. Reconnecter Google.");return email;}
function saveAccountEmail(email){const cfg=rt.config();rt.writeJson("colleague-config.json",{...cfg,googleEmail:email});const alert=rt.alert();rt.writeJson("alert.json",{...alert,smtpUser:email,to:email});}
async function ensureCalendar(auth,cfg,allowCreate){const api=google.calendar({version:"v3",auth}),saved=rt.readJson("google-calendar.json",{});if(saved.calendarId){try{const savedCalendar=await api.calendars.get({calendarId:saved.calendarId});if(String(savedCalendar.data.description||"").includes(cfg.calendarMarker))return {calendarId:saved.calendarId,created:false,pendingCreate:false};}catch(error){if(authFailure(error))throw new Error("Reconnecter Google.");if(!networkFailure(error))throw error;}}const existing=(await listCalendars(api)).find(x=>String(x.description||"").includes(cfg.calendarMarker));if(existing&&existing.id){rt.writeJson("google-calendar.json",{calendarId:existing.id,summary:existing.summary});return {calendarId:existing.id,created:false,pendingCreate:false};}if(!allowCreate)return {calendarId:"",created:false,pendingCreate:true};const created=await api.calendars.insert({requestBody:{summary:cfg.calendarSummary,description:`${cfg.calendarMarker} Calendrier gere par SDIS-BOT`,timeZone:"Europe/Paris"}});rt.writeJson("google-calendar.json",{calendarId:created.data.id,summary:created.data.summary});return {calendarId:created.data.id,created:true,pendingCreate:false};}
function tokenExchangeDiagnostic(error,meta){const data=error&&error.response&&error.response.data||{};const message=String(error&&error.message||"");const rawName=String(error&&error.name||"Error");const allowed=/^(invalid_client|invalid_grant|redirect_uri_mismatch|unauthorized_client|access_denied|invalid_request|invalid_scope)$/i;const oauthError=String(data.error||"");const description=String(data.error_description||"");const risky=/(access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|code[_ -]?verifier|authorization code|\bcode\s*=|cookie|session|bearer|eyJ[a-z0-9_-]{10,})/i.test(description)||description.length>500;const diagnostic={stage:"token_exchange",errorName:rawName,httpStatus:error&&error.response&&error.response.status||null,oauthError:allowed.test(oauthError)?oauthError:"",errorDescription:risky?"[omitted]":description,codePresent:Boolean(meta&&meta.code),codeVerifierPresent:Boolean(meta&&meta.codeVerifier),codeVerifierLength:meta&&meta.codeVerifier?String(meta.codeVerifier).length:0,clientIdPresent:Boolean(meta&&meta.clientId),redirectUri:String(meta&&meta.redirectUri||""),clientAuthentication:"ClientSecretPost"};try{rt.writeJson("google-oauth-diagnostic.json",diagnostic);}catch{}return diagnostic;}
async function connectGoogle(){
 rt.initialize();const cfg=config();
 const server=http.createServer();
 try{await new Promise((resolve,reject)=>server.listen(0,"127.0.0.1",resolve).once("error",reject));}
 catch{throw new Error("La connexion Google ne peut pas démarrer. Fermez puis relancez Assistant Planning et réessayez.");}
 let waiting;
 try{
  const redirect=`http://127.0.0.1:${server.address().port}/oauth2callback`;
  const auth=new google.auth.OAuth2({clientId:cfg.clientId,clientSecret:cfg.clientSecret,redirectUri:redirect,clientAuthentication:"ClientSecretPost"});
  const state=crypto.randomBytes(32).toString("hex"),pkce=await auth.generateCodeVerifierAsync();
  waiting=waitCode(server,state,async code=>{
   let tokens;
   try{tokens=(await auth.getToken({code,codeVerifier:pkce.codeVerifier,redirect_uri:redirect})).tokens;}
   catch(error){tokenExchangeDiagnostic(error,{code,codeVerifier:pkce.codeVerifier,clientId:cfg.clientId,redirectUri:redirect});throw new Error("Google n’a pas pu terminer la connexion. Réessayez ; si le problème persiste, contactez votre distributeur.");}
   if(!tokens.refresh_token&&rt.hasSecret("google-token")){try{tokens.refresh_token=rt.token().refresh_token;}catch{}}
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
  // Le retour OAuth suffit pour liberer l'interface. Le processus du
  // navigateur peut rester ouvert ou se fermer plus tard sans bloquer la
  // connexion confirmee.
  const result=await waiting.promise;return result;
 }finally{if(waiting)waiting.cancel(new Error("Connexion Google interrompue."));server.close();}
}
async function authorizedClient(){const cfg=config();if(!rt.hasSecret("google-token"))throw new Error("Reconnecter Google.");const secret=cfg.clientSecret,auth=new google.auth.OAuth2({clientId:cfg.clientId,clientSecret:secret,redirectUri:"http://127.0.0.1",clientAuthentication:"ClientSecretPost"});try{auth.setCredentials(rt.token());await auth.getAccessToken();}catch(error){if(authFailure(error))throw new Error("Reconnecter Google.");throw new Error("Google temporairement inaccessible.");}rt.bindGoogleAuth(auth);return {auth,cfg};}
async function status(){if(!isConfigured())return {configured:false,connected:false,reconnect:true,temporary:false};if(!rt.hasSecret("google-token"))return {configured:true,connected:false,reconnect:true,temporary:false};try{const {auth}=await authorizedClient();const api=google.calendar({version:"v3",auth});await api.calendarList.list({maxResults:1,showDeleted:false});const saved=rt.readJson("google-calendar.json",{});return {configured:true,connected:true,reconnect:false,temporary:false,calendarId:saved.calendarId||""};}catch(error){if(authFailure(error))return {configured:true,connected:false,reconnect:true,temporary:false};if(networkFailure(error))return {configured:true,connected:false,reconnect:false,temporary:true};return {configured:true,connected:false,reconnect:true,temporary:false};}}
module.exports={isConfigured,connectGoogle,authorizedClient,ensureCalendar,status,authFailure,networkFailure};
