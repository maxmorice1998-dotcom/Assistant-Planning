"use strict";
function expectedView(url){try{const parsed=new URL(String(url));return parsed.hostname.toLowerCase()==="agatt.sdis14.fr"&&parsed.pathname==="/register/index.php"&&parsed.searchParams.get("a")==="gardeExercice";}catch{return false;}}
function guardCode(value){const code=String(value||"").trim().toUpperCase();if(code==="G"||code==="J"||code==="N"||code==="S"||code.includes("SHR"))return code;return "";}
function validateView(url,cells,window,agentId){
 if(!expectedView(url))return {ok:false,reason:"wrong_view",message:"AGATT — mauvaise vue, navigation vers le planning garde/exercice."};
 const agent=String(agentId||"");const agentCells=(Array.isArray(cells)?cells:[]).filter(x=>new RegExp("^"+agent.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"_\\d{8}$").test(String(x&&x.id||"")));
 if(!agentCells.length)return {ok:false,reason:"agent_missing",message:"AGATT — agent configuré absent de la période affichée."};
 const dates=agentCells.map(x=>String(x.id).split("_")[1]).filter(x=>/^\d{8}$/.test(x)).sort();
 if(!dates.length)return {ok:false,reason:"period_missing",message:"AGATT — période affichée insuffisante."};
 // Les cellules AGATT n'existent que les jours comportant une garde.
 // Une première ou dernière garde éloignée de la fenêtre ne rend pas
 // la période incomplète.
 const guards=agentCells.filter(x=>guardCode(x.code||x.text)).map(x=>({...x,code:guardCode(x.code||x.text)}));
 return {ok:true,reason:guards.length?"guards":"empty",message:guards.length?`AGATT — planning chargé, ${guards.length} gardes détectées`:`AGATT — planning valide mais aucune garde sur la période`,agentCells,guards,dates};
}
module.exports={expectedView,guardCode,validateView};
