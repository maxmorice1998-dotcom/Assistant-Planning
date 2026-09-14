const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
for(const file of ['sync.js','cleanup-dendreo-stale.js','sync-dendreo.js','check-dendreo-alerts.js']){
 const source=fs.readFileSync(path.join(root,file),'utf8');
 assert.match(source,/runtime\.(?:calendarId|resolveCalendarId)\(/,`${file} n'utilise pas la source runtime commune`);
 assert.doesNotMatch(source,/calendarId\s*:\s*["']primary["']/,`${file} contient encore primary`);
}
const cfg=JSON.parse(fs.readFileSync(path.join(root,'google-oauth-config.json'),'utf8').replace(/^\uFEFF/,''));
assert.ok(cfg.clientId);
console.log('PASS: tous les scripts Dendreo/Google utilisent runtime.calendarId() et aucun calendarId primary codé en dur.');
