"use strict";
const rt=require("./runtime-config");
module.exports.connect=async options=>{
 const url=new URL(options.browserURL||"http://invalid");
 const kind=Object.keys(rt.ports).find(k=>String(rt.ports[k])===url.port);
 if(url.hostname!=="127.0.0.1"||!kind)throw new Error("Connexion navigateur interdite.");
 rt.verifyBrowser(kind);
 return require("puppeteer").connect(options);
};
