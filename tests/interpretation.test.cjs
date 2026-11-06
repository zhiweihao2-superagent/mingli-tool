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
const vm = require("node:vm");

const source = fs.readFileSync(require("node:path").join(__dirname, "../web/interpretation.js"), "utf8");
const context = {};
vm.runInNewContext(source, context);
const { describe, explainCycle, stemRelation } = context.MingliInterpretation;

const chart = {
  derived: { day_master: "庚" },
  pillars: {
    year: {
      ganzhi: "庚午", stem: "庚", branch: "午", ten_god: "比肩",
      hidden_stems: [{ stem: "丁", element: "火", ten_god: "正官" }]
    },
    month: { ganzhi: "辛巳", stem: "辛", branch: "巳", ten_god: "劫财", hidden_stems: [] },
    day: {
      ganzhi: "庚辰", stem: "庚", branch: "辰", ten_god: null,
      hidden_stems: [{ stem: "戊", element: "土", ten_god: "偏印" }]
    },
    hour: null
  }
};

const reading = describe(chart);
assert.equal(reading.dayMaster.element, "金");
assert.equal(reading.pillars.length, 4);
assert.match(reading.pillars[0].headline, /比肩/);
assert.match(reading.pillars[0].reading, /这张盘的年柱是庚午/);
assert.match(reading.pillars[0].reading, /哪些事自己做更合适，哪些要先谈清分工/);
assert.match(reading.pillars[0].hiddenStems[0].meaning, /规则|责任|秩序/);
assert.equal(reading.pillars[2].tenGod, null);
assert.match(reading.pillars[2].reading, /日主/);
assert.equal(reading.pillars[3].unknown, true);
assert.match(reading.pillars[3].reading, /保持未知/);
assert.match(reading.note, /不是科学测评/);
assert.match(reading.dayMaster.reading, /关系的参照/);

assert.deepEqual(
  JSON.parse(JSON.stringify(stemRelation("庚", "丙"))),
  { tenGod: "偏官", element: "火" }
);
assert.match(explainCycle("丙午", "庚", "第 1 步大运"), /第 1 步大运对应干支丙午/);
assert.match(explainCycle("丙午", "庚", "2026 年这一流年"), /传统关系标签是“偏官”/);
assert.match(explainCycle("未知", null, "流年"), /无法给出对应关系说明/);

for (const stem of "甲乙丙丁戊己庚辛壬癸") {
  const output = describe({ derived: { day_master: stem }, pillars: {} });
  assert.ok(output, `missing day-master reading for ${stem}`);
  assert.equal(output.pillars.length, 4);
  assert.ok(output.pillars.every(pillar => pillar.unknown));
}

for (const tenGod of ["比肩", "劫财", "食神", "伤官", "正财", "偏财", "正官", "偏官", "正印", "偏印"]) {
  const output = describe({
    derived: { day_master: "甲" },
    pillars: {
      year: { ganzhi: "甲子", branch: "子", ten_god: tenGod, hidden_stems: [] }
    }
  });
  assert.ok(output.pillars[0].tenGodReading.length > 0, "missing explanation for " + tenGod);
}

if (__checks === 0) {
  console.error("没有任何断言执行");
  process.exit(1);
}
console.log(`===== Plain-language interpretation checks passed. ${__checks} 项 =====`);
