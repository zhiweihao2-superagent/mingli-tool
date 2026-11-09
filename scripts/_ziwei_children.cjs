const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js"].forEach(n => vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", n), "utf8")));
const chart = global.MingliZiwei.calculate(
  { calendar: "solar", date: "1990-05-15", time: { precision: "minute", value: "12:30", branch: null }, sex_for_calculation: "male" },
  { asOfYear: 2026, asOfDate: "2026-11-08", asOfTimeIndex: 6 }
);
const palaces = chart.palaces || [];
console.log("palaces:", palaces.map(p => p.name || p.palace).join(","));
const target = palaces.find(p => /^子女/.test(String(p.name || p.palace)));
console.log("--- 子女宫 ---");
console.log(JSON.stringify(target, null, 2).slice(0, 2200));

