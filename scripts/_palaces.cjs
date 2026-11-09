const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
global.self = global;
global.iztro = require(path.join(__dirname, "..", "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js"].forEach(n => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "web", n), "utf8")));
const chart = global.MingliZiwei.calculate(
  { calendar: "solar", date: "1990-05-15", time: { precision: "minute", value: "12:30", branch: null }, sex_for_calculation: "male" },
  { asOfYear: 2026, asOfDate: "2026-11-08", asOfTimeIndex: 6 }
);
for (const p of chart.palaces) {
  const major = (p.majorStars || []).map(s => s.name + (s.brightness ? "(" + s.brightness + ")" : "")).join(" ") || "—";
  const minor = (p.minorStars || []).map(s => s.name).join(" ");
  console.log(`${p.name}\t${p.heavenlyStem}${p.earthlyBranch}\t${major}\t${minor}`);
}

