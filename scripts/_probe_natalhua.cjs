"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const ROOT=path.join(__dirname,"..");
global.self=global;
global.iztro=require(path.join(ROOT,"web","vendor","iztro-v2.6.2.min.js"));
["ziwei-facts.js","ziwei-adapter.js"].forEach(n=>vm.runInThisContext(fs.readFileSync(path.join(ROOT,"web",n),"utf8")));
const chart=global.MingliZiwei.calculate({calendar:"solar",date:"1990-05-15",time:{precision:"minute",value:"12:30",branch:null},sex_for_calculation:"male"},{asOfYear:2026,asOfDate:"2026-10-30",asOfTimeIndex:6});
const out=[];
for(const p of chart.palaces){
  for(const g of ["majorStars","minorStars","auxiliaryStars"]){
    for(const s of p[g]||[]){ if(s.transformation) out.push([s.name,s.transformation,p.name,p.earthlyBranch,g]); }
  }
}
console.log(JSON.stringify(out,null,1));
console.log("soulPalace", chart.palaces.find(p=>p.name==="命宫")?.earthlyBranch);
