const {spawnSync,spawn}=require('child_process');
const path=require('path');
const bridge=path.resolve(__dirname,'..','SDIS-Collegues-Bridge.exe');
function sync(label,file,args,options){
 const r=spawnSync(file,args,{windowsHide:true,timeout:10000,...options});
 console.log(JSON.stringify({label,file,error:r.error&&{code:r.error.code,errno:r.error.errno,syscall:r.error.syscall},status:r.status,signal:r.signal,outputBytes:r.stdout&&r.stdout.length}));
}
sync('node with pipes',process.execPath,['--version'],{});
sync('node without pipes',process.execPath,['--version'],{stdio:'ignore'});
sync('bridge with pipes',bridge,['--protect'],{input:'diagnostic-non-secret',encoding:'utf8'});
sync('bridge without pipes',bridge,[],{stdio:'ignore'});
const p=spawn(bridge,['--protect'],{windowsHide:true});
p.on('error',e=>console.log(JSON.stringify({label:'bridge async with pipes',error:e.code})));
let output='';if(p.stdout)p.stdout.on('data',x=>output+=x);
p.on('close',code=>console.log(JSON.stringify({label:'bridge async with pipes',status:code,outputBytes:output.length})));
if(p.stdin){p.stdin.on('error',()=>{});p.stdin.end('diagnostic-non-secret');}
