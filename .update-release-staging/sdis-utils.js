const fs = require('fs');
const path = require('path');
async function listAllEvents(api, params) {
 const items=[]; let pageToken; const seen=new Set();
 do { const res=await api.events.list({...params,pageToken});
 items.push(...(res.data.items || [])); pageToken=res.data.nextPageToken;
 if(pageToken && seen.has(pageToken)) throw new Error('Pagination Google repetee');
 if(pageToken) seen.add(pageToken);
 } while(pageToken);
 return {data:{items}};
}
function readFreshSnapshot(file, dryRun=false) {
 if(dryRun || !fs.existsSync(file)) return null;
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 const age=Date.now()-Date.parse(data.capturedAt);
 if(!Number.isFinite(age) || age<0 || age>15*60*1000) return null;
 return data;
}
function executionCacheFile() {
 const file=String(process.env.SDIS_RUN_CACHE||'').trim();
 return file && path.isAbsolute(file) ? file : null;
}
function readExecutionSnapshot() {
 const file=executionCacheFile();
 if(!file || !fs.existsSync(file)) return null;
 try {
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(value.runId && process.env.SDIS_RUN_ID && value.runId!==process.env.SDIS_RUN_ID) return null;
  return value;
 } catch { return null; }
}
function writeExecutionSnapshot(patch) {
 const file=executionCacheFile();
 if(!file) return;
 let value=readExecutionSnapshot()||{runId:String(process.env.SDIS_RUN_ID||''),createdAt:new Date().toISOString()};
 if(value.dendreoWrites || patch.dendreoWrites) patch={...patch,dendreoWrites:true,dendreo:null};
 value={...value,...patch,runId:value.runId||String(process.env.SDIS_RUN_ID||'')};
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,JSON.stringify(value),'utf8');
}
module.exports={listAllEvents,readFreshSnapshot,readExecutionSnapshot,writeExecutionSnapshot};
