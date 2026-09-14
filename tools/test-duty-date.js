const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..');
function extract(file,name){const s=fs.readFileSync(path.join(root,file),'utf8'),start=s.indexOf('function '+name+'('),end=s.indexOf('\n}',start)+2;return vm.runInNewContext('('+s.slice(start,end)+')');}
const dutyDate=extract('sync-dendreo.js','dutyDate');
const event={start:{dateTime:'2026-10-16T08:00:00+02:00'},end:{dateTime:'2026-10-17T08:00:00+02:00'},extendedProperties:{private:{agattId:'p123_20261016_G'}}};
assert.equal(dutyDate(event),'2026-10-16');
assert.equal(dutyDate({...event,extendedProperties:{private:{agattId:'p123_20261016'}}}),'2026-10-16');
assert.equal(dutyDate({start:{date:'2026-10-16'},extendedProperties:{private:{}}}),'2026-10-16');
console.log('PASS: une garde traversant minuit reste rattachée à sa date de début.');
