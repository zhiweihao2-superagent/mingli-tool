const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
global.self = global;
global.iztro = require(path.join(__dirname, "..", "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js"].forEach(n => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "web", n), "utf8")));
const chart = global.MingliZiwei.calculate(
  { calendar: "solar", date: "1988-03-02", time: { precision: "minute", value: "05:40", branch: null }, sex_for_calculation: "female" },
  { asOfYear: 2026, asOfDate: "2026-11-08", asOfTimeIndex: 6 }
);
const a = chart.astrolabe || {};
console.log("astrolabe:", JSON.stringify({gender:a.gender, soul:a.soul, body:a.body, five:a.fiveElementsClass, soulBranch:a.earthlyBranchOfSoulPalace, bodyBranch:a.earthlyBranchOfBodyPalace}));
console.log("palace keys:", Object.keys(chart.palaces[0]).join(","));
for (const p of chart.palaces) {
  console.log(`${p.name}\t${p.heavenlyStem}${p.earthlyBranch}\t${(p.majorStars||[]).map(s=>s.name+(s.brightness||"")).join("/") || "-"}\tdecadal=${JSON.stringify(p.decadal||null)}`);
}
