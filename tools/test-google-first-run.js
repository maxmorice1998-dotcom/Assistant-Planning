const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),vm=require('vm'),http=require('http');
const {EventEmitter}=require('events');
const {google}=require('googleapis');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'google-oauth-v2.js'),'utf8');
function scenario(options={}){
 const store={},saved={},calls={opened:0,exchange:0};let callback;
 const rt={initialize(){},readProgramJson(){return {clientId:'test.apps.googleusercontent.com',clientSecret:options.missing?'':'test-desktop-parameter'};},
  hasSecret(){return false;},secret(){throw Error('No previous DPAPI allowed');},
  readJson(name,fallback){return fallback;},writeJson(name,value){saved[name]=value;},config(){return {};},alert(){return {};},saveSecret(name,value){store[name]=value;}};
 class Auth extends google.auth.OAuth2 {
  async getToken(args){calls.exchange++;assert.ok(args.codeVerifier);assert.equal(this._clientSecret,'test-desktop-parameter');if(options.exchangeError)throw Error('invalid_client');return {tokens:{refresh_token:'test-refresh',access_token:'test-access'}};}
 }
 const child={spawn(exe,args){calls.opened++;assert.equal(exe,'rundll32.exe');const p=new EventEmitter();
  setImmediate(()=>{
   if(options.browserError){p.emit('error',Error('ENOENT'));return;}
   const url=new URL(args[1]);assert.equal(url.hostname,'accounts.google.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('code_challenge'));
   assert.equal(url.searchParams.has('client_secret'),false);
   const redirect=new URL(url.searchParams.get('redirect_uri'));assert.equal(redirect.hostname,'127.0.0.1');
   redirect.searchParams.set('state',url.searchParams.get('state'));redirect.searchParams.set(options.cancel?'error':'code',options.cancel?'access_denied':'test-code');
   callback=new Promise((resolve,reject)=>http.get(redirect,res=>{let text='';res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode,text}));}).on('error',reject));
   p.emit('exit',0);
  });return p;}};
 const mockGoogle={auth:{OAuth2:Auth},oauth2(){return {userinfo:{get:async()=>({data:{email:'test@example.org'}})}};},calendar(){return {calendarList:{list:async()=>({data:{items:[]}})}};}};
 const module={exports:{}};
 vm.runInNewContext(source,{require(name){if(name==='./runtime-config')return rt;if(name==='child_process')return child;if(name==='googleapis')return {google:mockGoogle};return require(name);},module,exports:module.exports,__dirname:root,URL,Buffer,setTimeout,clearTimeout});
 return {oauth:module.exports,calls,store,callback:()=>callback};
}
test('fresh profile without packaged Desktop credentials reports startup failure',async()=>{
 const x=scenario({missing:true});await assert.rejects(x.oauth.connectGoogle(),/installation est incomplète/);assert.equal(x.calls.opened,0);
});
test('fresh profile uses package credentials and PKCE, callback succeeds before success page',async()=>{
 const x=scenario();const result=await x.oauth.connectGoogle();const callback=await x.callback();
 assert.equal(x.calls.opened,1);assert.equal(x.calls.exchange,1);assert.equal(result.email,'test@example.org');assert.equal(callback.status,200);assert.match(callback.text,/Connexion Google réussie/);assert.ok(x.store['google-token']);
});
test('browser startup error is visible and callback listener is released',async()=>{
 const x=scenario({browserError:true});await assert.rejects(x.oauth.connectGoogle(),/Impossible d’ouvrir le navigateur/);assert.equal(x.calls.exchange,0);
});
test('Google exchange failure never produces a success page or saves a token',async()=>{
 const x=scenario({exchangeError:true});await assert.rejects(x.oauth.connectGoogle(),/n’a pas pu terminer/);assert.equal((await x.callback()).status,400);assert.equal(x.store['google-token'],undefined);
});
test('consent cancellation is visible and does not save a token',async()=>{
 const x=scenario({cancel:true});await assert.rejects(x.oauth.connectGoogle(),/annulée/);assert.equal((await x.callback()).status,400);assert.equal(x.calls.exchange,0);
});
