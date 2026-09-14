const http=require('http'),{spawn}=require('child_process'),fs=require('fs'),path=require('path');
const report={selfCheck:false,launcherStarted:false,launcherExit:null,browserReachedLocalPage:false};
const server=http.createServer((req,res)=>{
 if(req.url==='/self-check')report.selfCheck=true;
 if(req.url==='/browser-check')report.browserReachedLocalPage=true;
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.end('<h1>Assistant Planning</h1><p>Test local du navigateur terminé. Vous pouvez fermer cet onglet.</p>');
});
server.listen(0,'127.0.0.1',()=>{
 const base='http://127.0.0.1:'+server.address().port;
 http.get(base+'/self-check',res=>res.resume()).on('error',e=>{report.selfError=e.code;});
 const p=spawn('rundll32.exe',['url.dll,FileProtocolHandler',base+'/browser-check'],{windowsHide:true,stdio:'ignore'});
 p.on('spawn',()=>{report.launcherStarted=true;});
 p.on('error',e=>{report.launcherError=e.code;});
 p.on('exit',code=>{report.launcherExit=code;});
 setTimeout(()=>{server.close();fs.writeFileSync(path.join(__dirname,'..','browser-callback-diagnostic.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));},15000);
});
