"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const ROOT=path.join(__dirname,"..");
global.self=global;
global.iztro=require(path.join(ROOT,"web","vendor","iztro-v2.6.2.min.js"));
["ziwei-facts.js","ziwei-adapter.js"].forEach(n=>vm.runInThisContext(fs.readFileSync(path.join(ROOT,"web",n),"utf8")));
const chart=global.MingliZiwei.calculate({calendar:"solar",date:"1990-05-15",time:{precision:"minute",value:"12:30",branch:null},sex_for_calculation:"male"},{asOfYear:2026,asOfDate:"2026-10-30",asOfTimeIndex:6});
const tl=global.MingliZiweiFacts.buildAnnualTimeline(chart.astrolabe, chart.palaces, 2026);
console.log("natalHua", JSON.stringify(tl.years[0].activation.natalHua));
for(const y of tl.years){
  const ov=y.activation.natalOverlapRows.map(r=>r.kind+"与生年"+r.overlapsNatal.map(o=>o.natalKind+"("+o.relation+")").join("/")).join(" ");
  const g=y.decadalAnnualRelation;
  console.log(y.year,y.ganzhi,"同干:"+(g.sameStem?1:0),"同支:"+(g.sameBranch?1:0),"干克:"+(g.stemClash?1:0),"支冲:"+(g.branchClash?1:0),"|生年:",ov||"-");
}
