"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const ROOT=path.join(__dirname,"..");
global.self=global;
global.iztro=require(path.join(ROOT,"web","vendor","iztro-v2.6.2.min.js"));
["ziwei-facts.js","ziwei-adapter.js"].forEach(n=>vm.runInThisContext(fs.readFileSync(path.join(ROOT,"web",n),"utf8")));
const chart=global.MingliZiwei.calculate({calendar:"solar",date:"1990-05-15",time:{precision:"minute",value:"12:30",branch:null},sex_for_calculation:"male"},{asOfYear:2026,asOfDate:"2026-10-30",asOfTimeIndex:6});
const tl=global.MingliZiweiFacts.buildAnnualTimeline(chart.astrolabe, chart.palaces, 2026);
console.log("status",tl.status);
console.log("decadal",JSON.stringify(tl.decadal.ganzhi),JSON.stringify(tl.decadal.ageRange),JSON.stringify(tl.decadal.yearRange),"soul",tl.decadal.natalAnchorPalace);
console.log("boundary",tl.boundaryAudit.status,tl.boundaryAudit.hardFailures.join(","));
console.log("years",tl.years.length);
for(const y of tl.years){
  const act=y.activation;
  const stacked=act.stackedRows.map(r=>r.kind+"@"+r.natalPalace).join("|")||"-";
  const soul=act.onDecadalSoulRows.map(r=>r.kind+"@"+r.natalPalace+(r.onDecadalSoul?"(命)":"(冲)")).join("|")||"-";
  const rel=y.decadalAnnualRelation.relation.map(r=>r.kind).join("|")||"-";
  console.log(y.year,y.ganzhi,"虚"+y.nominalAge,y.status,"叠:"+stacked,"引:"+soul,"干:"+rel);
}
console.log("sample year fourHua:",JSON.stringify(tl.years[0].fourTransformations.map(r=>[r.kind,r.star,r.natalPalace,r.decadalPalace,r.periodPalace])));
