"use strict";
const http=require("http"),crypto=require("crypto"),fs=require("fs"),path=require("path");
const {spawn}=require("child_process");
const {google}=require("googleapis");
const rt=require("./runtime-config");
const GMAIL_SEND_SCOPE="https://www.googleapis.com/auth/gmail.send";
function oauthLog(stage,message=""){
 try{
  const clean=String(message||"").replace(/[\r\n]+/g," ").replace(/(?:access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|authorization code|code_verifier|cookie|bearer|eyJ[a-z0-9_-]{10,})[^\s]*/ig,"[masque]").slice(0,300);
  fs.mkdirSync(rt.dataDir,{recursive:true});
  fs.appendFileSync(rt.dataPath("assistant-planning.log"),"[OAUTH] "+new Date().toISOString()+" | "+stage+(clean?" | "+clean:"")+"\n","utf8");
 }catch{}
}

function config(){
 const x=rt.readProgramJson("google-oauth-config.json",{}),id=String(x.clientId||"").trim();
 if(!id || !String(x.clientSecret||" ").trim())throw new Error("La connexion Google ne peut pas démarrer : cette installation est incomplète. Contactez votre distributeur pour obtenir une version corrigée.");
 const scopes=Array.isArray(x.scopes)&&x.scopes.length?x.scopes.map(String):["https://www.googleapis.com/auth/calendar.app.created","https://www.googleapis.com/auth/calendar.calendarlist.readonly","https://www.googleapis.com/auth/userinfo.email","https://www.googleapis.com/auth/gmail.send"];
 return {clientId:id,clientSecret:String(x.clientSecret).trim(),scopes,calendarSummary:String(x.calendarSummary||"SDIS-BOT"),calendarMarker:String(x.calendarMarker||"[SDIS-BOT]")};
}
function isConfigured(){try{config();return true;}catch{return false;}}
function openBrowser(url,options={}){return new Promise((resolve,reject)=>{
 let profile,executable;
 try{profile=path.join(rt.dataDir,"profiles","google");fs.mkdirSync(profile,{recursive:true});executable=rt.browserExe();}
 catch{reject(new Error("Impossible d\u2019ouvrir le navigateur d Assistant Planning."));return;}
 let p;
 const bounds=options&&options.windowBounds&&typeof options.windowBounds==='object'?options.windowBounds:null;
 const windowArgs=bounds?[`--window-position=${Math.trunc(Number(bounds.x)||0)},${Math.trunc(Number(bounds.y)||0)}`,`--window-size=${Math.max(320,Math.trunc(Number(bounds.width)||640))},${Math.max(240,Math.trunc(Number(bounds.height)||700))}`]:[];
 try{p=spawn(executable,["--app="+url,...windowArgs,"--user-data-dir="+profile,"--no-first-run","--no-default-browser-check","--disable-background-networking"],{windowsHide:false,stdio:"ignore"});}
 catch{reject(new Error("Impossible d\u2019ouvrir le navigateur embarque."));return;}
 // Détacher le handle Node : l'interface ne doit pas attendre la fermeture de Chromium.
 try{if(typeof p.unref==="function")p.unref();}catch{}
 let settled=false;
 p.once("error",()=>{if(!settled){settled=true;reject(new Error("Impossible d\u2019ouvrir le navigateur embarque."));}});
 p.once("exit",code=>{if(!settled&&code!==0){settled=true;reject(new Error("Impossible d\u2019ouvrir le navigateur embarque."));}});
 setImmediate(()=>{if(!settled){settled=true;resolve({pid:p.pid,child:p,profile,executable});}});
 });}
function closeLaunchedBrowser(opened){
 if(!opened||!opened.child)return;
 try{if((opened.child.exitCode===null||typeof opened.child.exitCode==="undefined")&&typeof opened.child.kill==="function"){opened.child.kill();oauthLog("fenetre OAuth dediee fermee","PID="+String(opened.pid||""));}}catch{}
}
function successPage(){let logo="";try{logo="data:image/png;base64,"+fs.readFileSync(path.join(__dirname,"assets","udsp14-logo.png")).toString("base64");}catch{}const logoHtml=logo?`<img class="logo" src="${logo}" alt="UDSP14">`:"";return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connexion Google réussie</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7f8;color:#0e0e0e;font-family:"Segoe UI",Arial,sans-serif}.card{box-sizing:border-box;width:min(92vw,520px);padding:42px 38px;text-align:center;background:#fff;border-top:5px solid #ff0000;border-radius:14px;box-shadow:0 12px 35px #032e4222}.logo{display:block;max-width:210px;max-height:82px;width:auto;height:auto;margin:0 auto 24px}.check{width:62px;height:62px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;background:#e7f6ed;color:#198754;font-size:38px;font-weight:700}.eyebrow{margin:0 0 9px;color:#5e6b71;font-size:12px;letter-spacing:.14em;font-weight:700}.title{margin:0;color:#032e42;font-size:27px;line-height:1.2}.text{margin:16px 0 0;color:#5e6b71;font-size:16px;line-height:1.5}.close{margin:24px 0 0;color:#5e6b71;font-size:13px}.fallback{display:none;margin:12px 0 0;color:#5e6b71;font-size:13px}</style></head><body><main class="card">${logoHtml}<div class="check" aria-label="Succès">✓</div><p class="eyebrow">CENTRE DE FORMATION UDSP14</p><h1 class="title">✅ Connexion Google réussie</h1><p class="text">Retour à Assistant Planning…</p><p class="close">Cette fenêtre va se fermer automatiquement.</p><p id="fallback" class="fallback">✅ Google est connecté. Vous pouvez fermer cette page.</p></main><script>setTimeout(function(){window.close();},400);setTimeout(function(){var e=document.getElementById('fallback');if(e)e.style.display='block';},1800);</script></body></html>`;}
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
async function grantedScopes(auth,credentials){
 const value=credentials||auth.credentials||{};
 const direct=String(value.scope||"").trim();
 if(direct)return new Set(direct.split(/\s+/).filter(Boolean));
 let accessToken=String(value.access_token||"").trim();
 if(!accessToken){const fresh=await auth.getAccessToken();accessToken=String(fresh&&fresh.token||fresh||"").trim();}
 if(!accessToken)return null;
 const result=await google.oauth2({version:"v2",auth}).tokeninfo({access_token:accessToken});
 const scope=String(result.data&&result.data.scope||"").trim();
 return scope?new Set(scope.split(/\s+/).filter(Boolean)):null;
}
async function hasGmailSendScope(auth,credentials){try{const scopes=await grantedScopes(auth,credentials);return scopes?scopes.has(GMAIL_SEND_SCOPE):null;}catch{return null;}}
async function requireGmailSendScope(auth,credentials){let scopes=null;try{scopes=await grantedScopes(auth,credentials);}catch{}if(scopes&& !scopes.has(GMAIL_SEND_SCOPE)){const error=new Error("Autorisation Gmail manquante — reconnectez votre compte Google une fois.");error.code="GMAIL_SCOPE_REQUIRED";throw error;}return scopes;}
async function needsConsent(auth){
 if(!rt.hasSecret("google-token"))return true;
 try{const saved=rt.token();auth.setCredentials(saved);const granted=await hasGmailSendScope(auth,saved);return granted!==true;}catch{return true;}
}
function saveAccountEmail(email){const cfg=rt.config();rt.writeJson("colleague-config.json",{...cfg,googleEmail:email});const alert=rt.alert();rt.writeJson("alert.json",{...alert,smtpUser:email,to:email});}
async function ensureCalendar(auth,cfg,allowCreate){const api=google.calendar({version:"v3",auth}),saved=rt.readJson("google-calendar.json",{});if(saved.calendarId){try{const savedCalendar=await api.calendars.get({calendarId:saved.calendarId});if(String(savedCalendar.data.description||"").includes(cfg.calendarMarker))return {calendarId:saved.calendarId,created:false,pendingCreate:false};}catch(error){if(authFailure(error))throw new Error("Reconnecter Google.");if(!networkFailure(error))throw error;}}const existing=(await listCalendars(api)).find(x=>String(x.description||"").includes(cfg.calendarMarker));if(existing&&existing.id){rt.writeJson("google-calendar.json",{calendarId:existing.id,summary:existing.summary});return {calendarId:existing.id,created:false,pendingCreate:false};}if(!allowCreate)return {calendarId:"",created:false,pendingCreate:true};const created=await api.calendars.insert({requestBody:{summary:cfg.calendarSummary,description:`${cfg.calendarMarker} Calendrier gere par SDIS-BOT`,timeZone:"Europe/Paris"}});rt.writeJson("google-calendar.json",{calendarId:created.data.id,summary:created.data.summary});return {calendarId:created.data.id,created:true,pendingCreate:false};}
function tokenExchangeDiagnostic(error,meta){const data=error&&error.response&&error.response.data||{};const message=String(error&&error.message||"");const rawName=String(error&&error.name||"Error");const allowed=/^(invalid_client|invalid_grant|redirect_uri_mismatch|unauthorized_client|access_denied|invalid_request|invalid_scope)$/i;const oauthError=String(data.error||"");const description=String(data.error_description||"");const risky=/(access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|code[_ -]?verifier|authorization code|\bcode\s*=|cookie|session|bearer|eyJ[a-z0-9_-]{10,})/i.test(description)||description.length>500;const diagnostic={stage:"token_exchange",errorName:rawName,httpStatus:error&&error.response&&error.response.status||null,oauthError:allowed.test(oauthError)?oauthError:"",errorDescription:risky?"[omitted]":description,codePresent:Boolean(meta&&meta.code),codeVerifierPresent:Boolean(meta&&meta.codeVerifier),codeVerifierLength:meta&&meta.codeVerifier?String(meta.codeVerifier).length:0,clientIdPresent:Boolean(meta&&meta.clientId),redirectUri:String(meta&&meta.redirectUri||""),clientAuthentication:"ClientSecretPost"};try{rt.writeJson("google-oauth-diagnostic.json",diagnostic);}catch{}return diagnostic;}
async function connectGoogle(options={}){
 const startedAt=Date.now();oauthLog("OAuth clic recu");
 rt.initialize();const cfg=config();oauthLog("configuration OAuth prete",(Date.now()-startedAt)+" ms");
 const server=http.createServer();
 try{await new Promise((resolve,reject)=>server.listen(0,"127.0.0.1",resolve).once("error",reject));}
 catch{throw new Error("La connexion Google ne peut pas demarrer. Fermez puis relancez Assistant Planning et reessayez.");}
 let waiting;
 try{
  const redirect=`http://127.0.0.1:${server.address().port}/oauth2callback`;
  oauthLog("callback listener pret",(Date.now()-startedAt)+" ms");
  const auth=new google.auth.OAuth2({clientId:cfg.clientId,clientSecret:cfg.clientSecret,redirectUri:redirect,clientAuthentication:"ClientSecretPost"});
  const state=crypto.randomBytes(32).toString("hex"),pkce=await auth.generateCodeVerifierAsync();
  oauthLog("PKCE pret",(Date.now()-startedAt)+" ms");
  waiting=waitCode(server,state,async code=>{
   oauthLog("callback OAuth recu",(Date.now()-startedAt)+" ms");
   let tokens;
   try{tokens=(await auth.getToken({code,codeVerifier:pkce.codeVerifier,redirect_uri:redirect})).tokens;}
   catch(error){tokenExchangeDiagnostic(error,{code,codeVerifier:pkce.codeVerifier,clientId:cfg.clientId,redirectUri:redirect});throw new Error("Google n\u2019a pas pu terminer la connexion. Reessayez.");}
   if(!tokens.refresh_token&&rt.hasSecret("google-token")){try{tokens.refresh_token=rt.token().refresh_token;}catch{}}
   if(!tokens.refresh_token)throw new Error("Google n\u2019a pas confirme l\u2019acces durable. Cliquez a nouveau sur Connecter Google.");
   auth.setCredentials(tokens);
   const granted=await requireGmailSendScope(auth,tokens);
   if(granted instanceof Set)tokens.scope=[...granted].join(" ");
   const email=await accountEmail(auth);
   const dry=rt.readJson("dendreo-config.json",{dryRun:true}).dryRun;
   const calendar=await ensureCalendar(auth,cfg,!dry);
   rt.saveSecret("google-token",JSON.stringify(tokens));saveAccountEmail(email);
   oauthLog("tokens valides et enregistres",(Date.now()-startedAt)+" ms");
   return {...calendar,email};
  });
  const authOptions={access_type:"offline",include_granted_scopes:true,scope:cfg.scopes,state,code_challenge:pkce.codeChallenge,code_challenge_method:"S256"};
  if(await needsConsent(auth))authOptions.prompt="consent";
  const authUrl=auth.generateAuthUrl(authOptions);
  oauthLog("URL Google generee",(Date.now()-startedAt)+" ms");
  const opened=await openBrowser(authUrl,options);
  oauthLog("commande Chromium lancee",(Date.now()-startedAt)+" ms");
  oauthLog("Chromium PID obtenu","PID="+String(opened.pid||"")+"; "+(Date.now()-startedAt)+" ms");
  oauthLog("URL Google ouverte",(Date.now()-startedAt)+" ms");
  const result=await waiting.promise;
  setTimeout(()=>closeLaunchedBrowser(opened),400);
  return result;
 }finally{if(waiting){waiting.promise.catch(()=>{});waiting.cancel(new Error("Connexion Google interrompue."));}server.close();}
}
async function authorizedClient(){const cfg=config();if(!rt.hasSecret("google-token"))throw new Error("Reconnecter Google.");const secret=cfg.clientSecret,auth=new google.auth.OAuth2({clientId:cfg.clientId,clientSecret:secret,redirectUri:"http://127.0.0.1",clientAuthentication:"ClientSecretPost"});try{auth.setCredentials(rt.token());await auth.getAccessToken();}catch(error){if(authFailure(error))throw new Error("Reconnecter Google.");throw new Error("Google temporairement inaccessible.");}rt.bindGoogleAuth(auth);return {auth,cfg};}
async function status(){if(!isConfigured())return {configured:false,connected:false,reconnect:true,temporary:false};if(!rt.hasSecret("google-token"))return {configured:true,connected:false,reconnect:true,temporary:false};try{const {auth}=await authorizedClient();const api=google.calendar({version:"v3",auth});await api.calendarList.list({maxResults:1,showDeleted:false});const saved=rt.readJson("google-calendar.json",{});return {configured:true,connected:true,reconnect:false,temporary:false,calendarId:saved.calendarId||""};}catch(error){if(authFailure(error))return {configured:true,connected:false,reconnect:true,temporary:false};if(networkFailure(error))return {configured:true,connected:false,reconnect:false,temporary:true};return {configured:true,connected:false,reconnect:true,temporary:false};}}
module.exports={isConfigured,connectGoogle,authorizedClient,ensureCalendar,status,authFailure,networkFailure,hasGmailSendScope,requireGmailSendScope,grantedScopes,GMAIL_SEND_SCOPE,needsConsent};
