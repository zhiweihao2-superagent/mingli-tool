const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
global.self = global;
global.iztro = require(path.join(__dirname, "..", "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js"].forEach(n => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "web", n), "utf8")));
const chart = global.MingliZiwei.calculate(
  { calendar: "solar", date: "1990-05-15", time: { precision: "minute", value: "12:30", branch: null }, sex_for_calculation: "male" },
  { asOfYear: 2026, asOfDate: "2026-11-08", asOfTimeIndex: 6 }
);
const a = chart.astrolabe || {};
console.log("astrolabe keys:", Object.keys(a).join(","));
console.log("soul/body:", a.soul, a.body, "| fiveElementsClass:", a.fiveElementsClass, "| earthlyBranchOfSoulPalace:", a.earthlyBranchOfSoulPalace);
console.log("decadal:", JSON.stringify(a.decadal || chart.decadal || null).slice(0, 300));
for (const p of chart.palaces) {
  const major = (p.majorStars || []).map(s => s.name + (s.brightness ? "(" + s.brightness + ")" : "") + (s.transformation ? "·" + s.transformation : "")).join(" ");
  const minor = (p.minorStars || []).map(s => s.name).join(" ");
  const aux = (p.auxiliaryStars || []).map(s => s.name).join(" ");
  const dec = p.decadal || p.decadalRange || null;
  console.log([p.name, p.heavenlyStem + p.earthlyBranch, major || "-", minor || "-", aux || "-", JSON.stringify(dec)].join(" | "));
}
