const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {spawnSync}=require('child_process');
const root=path.join(__dirname,'..');
process.env.SDIS_COLLEAGUES_TEST_DIR=path.join(root,'.binding-'+crypto.randomBytes(4).toString('hex'));
const rt=require('../runtime-config');
rt.initialize();
function putToken(value){
 const p=spawnSync(path.join(root,'SDIS-Collegues-Bridge.exe'),['--protect'],{input:JSON.stringify(value),encoding:'utf8',windowsHide:true});
 if(p.error)throw new Error('DPAPI bridge launch blocked: '+p.error.code);
 assert.equal(p.status,0,'DPAPI bridge failed');
 fs.writeFileSync(path.join(rt.dataDir,'secrets','google-token.dpapi'),p.stdout);
}
putToken({refresh_token:'test-fixture'});
assert.throws(()=>rt.token(),/Reconnecter Google/);
putToken({refresh_token:'test-fixture',_oauthClientId:'different-client'});
assert.throws(()=>rt.token(),/Reconnecter Google/);
rt.saveSecret('google-token',JSON.stringify({refresh_token:'test-fixture'}));
assert.equal(rt.token().refresh_token,'test-fixture');
assert.equal(rt.token()._oauthClientId,undefined);
console.log('PASS: anciens tokens et autre client refusés ; nouveau client accepté ; DPAPI réel.');
