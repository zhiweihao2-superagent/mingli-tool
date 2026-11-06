"use strict";

const assertRaw = require("node:assert/strict");
// 统计断言次数：验证脚本据此确认「真的跑了断言」，而不是只看退出码。
let __checks = 0;
const assert = new Proxy(assertRaw, {
  get(target, key) {
    const value = target[key];
    if (typeof value !== "function") return value;
    return (...args) => {
      __checks += 1;
      return value.apply(target, args);
    };
  },
});

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

global.self = global;
global.iztro = require(path.join(__dirname, "../web/vendor/iztro-v2.6.2.min.js"));
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../web/ziwei-facts.js"), "utf8"));
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../web/ziwei-adapter.js"), "utf8"));
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../web/ziwei-interpretation.js"), "utf8"));

const chart = global.MingliZiwei.calculate({
  calendar: "solar",
  date: "1990-05-15",
  is_leap_month: false,
  time: { precision: "minute", value: "09:30", branch: null },
  sex_for_calculation: "male"
}, { asOfYear: 2026 });
const reading = global.MingliZiweiInterpretation.interpret(chart);

assert.equal(reading.themes.length, 6);
assert.equal(reading.facts.length, 3);
assert.match(reading.facts[0].value, /命宫在子/);
assert.match(reading.facts[1].value, /夫妻宫/);
assert.match(reading.facts[2].explanation, /不是五行强弱评分/);

const identity = reading.themes.find(theme => theme.palace === "命宫");
assert.match(identity.evidence, /破军/);
assert.match(identity.summary, /改变、重组和告别旧做法/);
assert.match(identity.question, /自我核对/);

assert.match(reading.boundary, /不.*预测吉凶或具体事件/);
assert.equal(global.MingliZiweiInterpretation.interpret({ status: "unavailable" }), null);

if (__checks === 0) {
  console.error("没有任何断言执行");
  process.exit(1);
}
console.log(`===== Zi Wei plain-language interpretation checks passed. ${__checks} 项 =====`);
