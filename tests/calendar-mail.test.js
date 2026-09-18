"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {compose,rawMail}=require("../send-combined-alerts");
const calendar={ok:true,from:"2026-09-18",to:"2026-10-15",events:[
 {dates:["2026-10-02","2026-10-03"],text:"[SDIS-BOT] Garde + repos compensatoire",startTime:"00:00",endTime:"00:00",indispo:true},
 {dates:["2026-10-03"],text:"Formation <PSC> & réunion",startTime:"09:00",endTime:"17:00",indispo:false}
]};
test("email shows the final 28 days including both days of an unavailability",()=>{
 const mail=compose({ok:true,calendar,changes:[{service:"Dendreo",operation:"removed",date:"2026-10-02"},{service:"Dendreo",operation:"added",date:"2026-10-02"}]});
 assert.equal((mail.html.match(/<td /g)||[]).length,28);assert.equal((mail.html.match(/<tr>/g)||[]).length,4);
 assert.equal((mail.body.match(/Garde \+ repos compensatoire/g)||[]).length,2);
 assert.match(mail.body,/du 02\/10\/2026 au 03\/10\/2026/);assert.match(mail.body,/09:00 – 17:00/);
 assert.match(mail.html,/CONFLIT/);assert.match(mail.html,/#fce8e6/);assert.match(mail.html,/#d2e3fc/);
 assert.match(mail.html,/Formation &lt;PSC&gt; &amp; réunion/);
 assert.doesNotMatch(mail.body,/INDISPONIBILITÉS DENDREO|indisponibilité créée|indisponibilité supprimée/);
 assert.match(mail.body,/15\/10/);assert.doesNotMatch(mail.body,/16\/10/);
});
test("Gmail message contains readable text and HTML alternatives with intact accents",()=>{
 const mail=compose({ok:true,calendar});const raw=Buffer.from(rawMail(mail,"test@example.com"),"base64url").toString("utf8");
 assert.match(raw,/multipart\/alternative/);assert.match(raw,/Content-Type: text\/plain/);assert.match(raw,/Content-Type: text\/html/);
 const bodies=[...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?=\r\n--)/g)].map(m=>Buffer.from(m[1],"base64").toString("utf8"));
 assert.deepEqual(bodies,[mail.body,mail.html]);
});
test("recap precedes the calendar and conflicts are prominent in both mail formats",()=>{
 const mail=compose({ok:true,calendar,changes:[
  {service:"Dendreo",operation:"added",date:"2026-10-02"},
  {service:"Google Agenda",operation:"added",date:"2026-10-02"},
  {service:"Dendreo",operation:"removed",date:"2026-10-01"},
  {service:"Dendreo",operation:"added",date:"2026-10-02"}
 ]});
 assert.match(mail.body,/GARDES AGATT\n02\/10\/2026 : garde ajoutée\./);
 assert.doesNotMatch(mail.body,/INDISPONIBILITÉS DENDREO|indisponibilité créée|indisponibilité supprimée/);
 assert.doesNotMatch(mail.html,/INDISPONIBILITÉS DENDREO|indisponibilité créée|indisponibilité supprimée/);
 assert.ok(mail.body.indexOf("GARDES AGATT")<mail.body.indexOf("28 prochains jours"));
 assert.ok(mail.html.indexOf("GARDES AGATT")<mail.html.indexOf("<table"));
 assert.match(mail.subject,/ATTENTION : CONFLIT/);
 assert.match(mail.body,/^ATTENTION : CONFLIT\nDates concernées : 03\/10\/2026\./);
 assert.match(mail.html,/font-size:28px">ATTENTION : CONFLIT/);
 const clear=compose({ok:true,calendar:{...calendar,events:[]},changes:[]});
 assert.doesNotMatch(clear.subject,/CONFLIT/);
 assert.match(clear.body,/GARDES AGATT\nAucune modification\./);
});
test("failed synchronization keeps the existing error email instead of a success calendar",()=>{
 const mail=compose({ok:false,calendar});assert.match(mail.subject,/incomplète/);assert.equal(mail.html,undefined);
});
test("selected A layout keeps a 7-column calendar on mobile with complete details",()=>{
 const mail=compose({ok:true,calendar});
 assert.match(mail.html,/@media only screen and \(max-width:600px\)/);
 assert.match(mail.html,/name="viewport"/);assert.match(mail.html,/Détails du calendrier/);
 assert.equal((mail.html.match(/<td /g)||[]).length,28);
 assert.match(mail.html,/Formation &lt;PSC&gt; &amp; réunion/);
 assert.ok(Buffer.byteLength(mail.html,"utf8")<100000);
 assert.match(mail.html,/mso-hide:all">Indispo<\/div>/);
 assert.match(mail.html,/mso-hide:all">Formation &lt;PSC&gt; &amp; réunion<\/div>/);
});
