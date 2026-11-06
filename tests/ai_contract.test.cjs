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

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../web/report-structure.js"), "utf8"));
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../web/ai-contract.js"), "utf8"));

const bazi = {
  status: "ok",
  calculation: { engine: { name: "bazi" }, rule_profile: { id: "fixed" }, pillars: {} },
  warnings: [],
  ai_facts: {
    fingerprint: "bz1-test",
    validation: { status: "pass" },
    derived_rules: { validation: { status: "pass" } },
    readiness: { ai_may_interpret: true, supported_scopes: ["pillars"], unsupported_scopes: ["pattern"] }
  }
};
const ziwei = {
  status: "ok",
  engine: { name: "iztro" },
  ruleProfile: { id: "fixed" }, normalizedInput: {}, calendarDisplay: {}, basics: {}, palaces: [],
  aiFacts: {
    fingerprint: "zw4-test",
    validation: { status: "pass" },
    flyingValidation: { status: "pass" },
    periods: { validation: { decadal: { status: "pass" }, annual: { status: "pass" } } },
    fineTiming: { status: "pass" },
    readiness: { aiMayInterpret: true, supportedScopes: ["basic-natal-education"], unsupportedScopes: ["true-solar-time"] }
  }
};

// 规矩：一份合同只装一套体系，八字与紫微分别构建、分别喂给模型。
const baziContract = global.MingliAiContract.build({ bazi });
assert.equal(baziContract.schemaVersion, "mingli-ai-input/v1");
assert.equal(baziContract.mode, "facts-only");
assert.deepEqual(Object.keys(baziContract.systems), ["bazi"]);
assert.deepEqual(baziContract.requestedScopes, ["bazi:pillars"]);
assert.equal(baziContract.systems.bazi.fingerprint, "bz1-test");
assert.ok(baziContract.modelPolicy.mustNot.includes("补造缺失字段"));
assert.equal(baziContract.reportPlan.schemaVersion, "mingli-report-plan/v2");
assert.equal(baziContract.reportPlan.topicCounts.bazi, 7);
assert.equal(baziContract.reportPlan.topics.filter(topic => topic.system === "bazi").length, 7);

const ziweiContract = global.MingliAiContract.build({ ziwei });
assert.deepEqual(Object.keys(ziweiContract.systems), ["ziwei"]);
assert.deepEqual(ziweiContract.requestedScopes, ["ziwei:basic-natal-education"]);
assert.equal(ziweiContract.systems.ziwei.fingerprint, "zw4-test");
assert.equal(ziweiContract.reportPlan.topicCounts.ziwei, 13);
assert.equal(ziweiContract.reportPlan.topics.filter(topic => topic.system === "ziwei").length, 13);

// 合成一份必须当场拒绝，不能等模型把两套句式缝在一起才发现。
assert.throws(
  () => global.MingliAiContract.build({ bazi, ziwei }),
  error => error.code === "CONTRACT_MULTI_SYSTEM" && error.details.systems.length === 2
);

assert.throws(
  () => global.MingliAiContract.build({ bazi, requestedScopes: ["bazi:pattern"] }),
  error => error.code === "UNSUPPORTED_AI_SCOPE" && error.details.denied[0] === "bazi:pattern"
);
assert.throws(
  () => global.MingliAiContract.build({ bazi: { ...bazi, ai_facts: { ...bazi.ai_facts, validation: { status: "fail" } } } }),
  error => error.code === "FACTS_VALIDATION_FAILED"
);

if (__checks === 0) {
  console.error("没有任何断言执行");
  process.exit(1);
}
console.log(`===== AI contract checks passed. ${__checks} 项 =====`);
