"use strict";

// 报告库：本机保存与读取的口径。
// 这里只测纯数据层，不碰 DOM，也不发网络请求。

const assert = require("node:assert/strict");
const path = require("node:path");

let assertionCount = 0;
function count(fn) {
  return (...args) => {
    fn(...args);
    assertionCount += 1;
  };
}
const check = {
  ok: count(assert.ok),
  equal: count(assert.equal),
  deepEqual: count(assert.deepEqual),
};

function createStorage(options = {}) {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem(key, value) {
      if (options.failWrite) throw new Error("write denied");
      map.set(key, String(value));
    },
    removeItem: key => map.delete(key),
    get size() {
      return map.size;
    },
    raw: map,
  };
}

function freshModule(storage) {
  delete require.cache[require.resolve(path.join(__dirname, "..", "web", "report-archive.js"))];
  global.window = { localStorage: storage };
  require(path.join(__dirname, "..", "web", "report-archive.js"));
  return global.window.MingliReportArchive;
}

function section(topic, extra = {}) {
  return {
    topic,
    title: `${topic} 标题`,
    oneLineSummary: `${topic} 一句话`,
    plainLanguage: `${topic} 白话正文`,
    evidenceExplanation: `${topic} 为什么`,
    practicalAdvice: ["先观察", "再行动"],
    reflectionQuestion: "你准备怎么验证？",
    evidencePaths: [`bazi.${topic}.one`],
    knowledgeCitations: [`bazi:${topic}`],
    ...extra,
  };
}

function report(system, topics) {
  return {
    system,
    systemLabel: system === "bazi" ? "八字" : "紫微",
    requirementId: "req-1",
    title: `${system}报告`,
    sections: topics.map(topic => section(topic)),
    summary: { plainLanguage: "整体先看这里", evidencePaths: ["bazi.x"], confidence: "medium" },
    audit: { status: "pass", evidenceCount: 12 },
  };
}

// 1. 导出面
{
  const api = freshModule(createStorage());
  check.equal(api.SCHEMA, "mingli.reports/v1");
  check.equal(api.STORAGE_KEY, "mingli.reports.v1");
  check.equal(api.STORAGE_VERSION, 1);
  check.equal(api.MAX_RECORDS, 8);
  ["save", "list", "find", "remove", "clear", "fingerprintOf"].forEach(name => {
    check.equal(typeof api[name], "function");
  });
}

// 2. 没有 localStorage：保存失败但不抛，列表可读为空
{
  global.window = {};
  delete require.cache[require.resolve(path.join(__dirname, "..", "web", "report-archive.js"))];
  require(path.join(__dirname, "..", "web", "report-archive.js"));
  const api = global.window.MingliReportArchive;
  const saved = api.save(report("bazi", ["bazi-foundation"]));
  check.equal(saved.ok, false);
  check.ok(/本地存储/.test(saved.reason));
  const listed = api.list();
  check.equal(listed.available, false);
  check.equal(listed.records.length, 0);
}

// 3. 保存成功后读回，字段被归一化
{
  const api = freshModule(createStorage());
  const saved = api.save(report("bazi", ["bazi-foundation", "bazi-strength"]));
  check.equal(saved.ok, true);
  check.equal(saved.count, 1);
  const listed = api.list();
  check.equal(listed.records.length, 1);
  const record = listed.records[0];
  check.equal(record.system, "bazi");
  check.equal(record.systemLabel, "八字");
  check.equal(record.sections.length, 2);
  check.deepEqual(record.sections[0].practicalAdvice, ["先观察", "再行动"]);
  check.deepEqual(record.sections[0].evidencePaths, ["bazi.bazi-foundation.one"]);
  check.deepEqual(record.sections[0].knowledgeCitations, ["bazi:bazi-foundation"]);
  check.equal(record.audit.evidenceCount, 12);
  check.equal(record.schema, "mingli.reports/v1");
  check.ok(record.createdAt && !Number.isNaN(new Date(record.createdAt).getTime()));
}

// 4. 同一体系同一主题序列：覆盖而不是堆积
{
  const api = freshModule(createStorage());
  const first = api.save(report("bazi", ["bazi-foundation"]));
  const second = api.save(report("bazi", ["bazi-foundation"]));
  check.equal(second.count, 1);
  check.ok(first.record.id !== second.record.id);
  check.equal(api.list().records.length, 1);
}

// 5. 不同体系各留一份
{
  const api = freshModule(createStorage());
  api.save(report("bazi", ["bazi-foundation"]));
  api.save(report("ziwei", ["ziwei-minggong"]));
  check.equal(api.list().records.length, 2);
  check.equal(api.list().records[0].system, "ziwei");
}

// 6. 上限：最多 8 份，新的在前
{
  const api = freshModule(createStorage());
  for (let index = 0; index < 10; index += 1) {
    api.save(report("bazi", [`topic-${index}`]));
  }
  const records = api.list().records;
  check.equal(records.length, 8);
  check.equal(records[0].sections[0].topic, "topic-9");
  check.equal(records[7].sections[0].topic, "topic-2");
}

// 7. 删除与清空
{
  const api = freshModule(createStorage());
  const saved = api.save(report("bazi", ["bazi-foundation"]));
  api.save(report("ziwei", ["ziwei-minggong"]));
  check.equal(api.find(saved.record.id).system, "bazi");
  check.equal(api.find("missing"), null);
  check.equal(api.remove(saved.record.id).count, 1);
  check.equal(api.find(saved.record.id), null);
  check.equal(api.clear().count, 0);
  check.equal(api.list().records.length, 0);
}

// 8. 坏数据与版本不符都按空处理，不抛
{
  const storage = createStorage();
  storage.setItem("mingli.reports.v1", "{not json");
  const api = freshModule(storage);
  const listed = api.list();
  check.equal(listed.corrupt, true);
  check.equal(listed.records.length, 0);
}
{
  const storage = createStorage();
  storage.setItem("mingli.reports.v1", JSON.stringify({ schema: "mingli.reports/v1", version: 99, records: [] }));
  const api = freshModule(storage);
  check.equal(api.list().corrupt, true);
}

// 9. 空报告不保存
{
  const api = freshModule(createStorage());
  const saved = api.save({ system: "bazi", sections: [] });
  check.equal(saved.ok, false);
  check.ok(/没有可保存/.test(saved.reason));
  check.equal(api.list().records.length, 0);
}

// 10. 写失败降级：只影响报告库，不影响调用方
{
  const api = freshModule(createStorage({ failWrite: true }));
  const saved = api.save(report("bazi", ["bazi-foundation"]));
  check.equal(saved.ok, false);
  check.ok(/本地存储/.test(saved.reason));
}

// 11. 指纹区分体系与主题序列
{
  const api = freshModule(createStorage());
  const a = api.fingerprintOf({ system: "bazi", sections: [{ topic: "x" }] });
  const b = api.fingerprintOf({ system: "ziwei", sections: [{ topic: "x" }] });
  const c = api.fingerprintOf({ system: "bazi", sections: [{ topic: "y" }] });
  check.ok(a !== b);
  check.ok(a !== c);
}

console.log(`报告库检查 ${assertionCount} 项全部通过`);
