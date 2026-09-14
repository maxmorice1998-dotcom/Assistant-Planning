const fs=require('fs'),path=require('path'),crypto=require('crypto');
process.env.SDIS_COLLEAGUES_TEST_DIR=path.join(__dirname,'..','.google-clean-'+crypto.randomBytes(4).toString('hex'));
const rt=require('../runtime-config');
if(fs.existsSync(rt.dataDir))throw Error('Profile not clean');
require('../ui-backend').handle({action:'google'}).then(result=>{
 const report={profile:rt.dataDir,result,token:rt.hasSecret('google-token'),clientSecretDPAPI:rt.hasSecret('google-client-secret'),agentId:rt.config().agentId,calendarId:rt.readJson('google-calendar.json',{}).calendarId||'',profiles:fs.existsSync(path.join(rt.dataDir,'profiles'))};
 fs.writeFileSync(path.join(__dirname,'..','google-first-run-result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}).catch(error=>{console.error(error.message);process.exitCode=1;});
