const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
global.self=global;
global.iztro=require(path.join(__dirname,"..","web","vendor","iztro-v2.6.2.min.js"));
["ziwei-facts.js","ziwei-adapter.js"].forEach(n=>vm.runInThisContext(fs.readFileSync(path.join(__dirname,"..","web",n),"utf8")));
const c=global.MingliZiwei.calculate({calendar:"solar",date:"1992-09-21",time:{precision:"minute",value:"07:15",branch:null},sex_for_calculation:"male"},{asOfYear:2026,asOfDate:"2026-11-08",asOfTimeIndex:6});
console.log("chart keys:", Object.keys(c).join(","));
console.log("has aiFacts:", !!c.aiFacts, "| has facts:", !!c.facts);
