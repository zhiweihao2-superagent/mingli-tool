// 首页「最近解读」列表：读本机真实解读记录，没有就如实说没有。
// 这里用最小 DOM 沙箱跑 home-recent.js，验证三件事：
//   1. 没记录 → 提示可见、列表隐藏（不摆假条目）
//   2. 有记录 → 取最新三条、按时间倒序、链到 report.html?id=
//   3. 只有旧版「最近一份」时也能显示
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "design", "miniprogram", "home-recent.js");

let assertionCount = 0;
function ok(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  assertionCount += 1;
}
function eq(actual, expected, message) {
  ok(actual === expected, `${message}（实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}）`);
}

function makeEl(id) {
  return { id, hidden: false, innerHTML: "", textContent: "" };
}

function run(storage) {
  const nodes = {
    "recent-list": makeEl("recent-list"),
    "recent-note": makeEl("recent-note"),
  };
  const store = Object.assign({}, storage);
  const sandbox = {
    console,
    localStorage: {
      getItem: (key) => (key in store ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: (key) => { delete store[key]; },
    },
    document: {
      getElementById: (id) => nodes[id] || null,
    },
    Date,
    JSON,
    String,
    Number,
    Array,
    Object,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, "utf8"), sandbox, { filename: "home-recent.js" });
  return nodes;
}

function report(id, system, title, createdAt, topics) {
  const sections = [];
  for (let i = 0; i < topics; i += 1) sections.push({ topic: `t${i}`, title: `主题${i}` });
  return { id, system, systemLabel: system, title, createdAt, sections, audit: { evidenceCount: 3 } };
}

// —— 1. 什么都没存 ——
{
  const nodes = run({});
  eq(nodes["recent-note"].hidden, false, "无记录时提示可见");
  eq(nodes["recent-list"].hidden, true, "无记录时列表隐藏");
  eq(nodes["recent-list"].innerHTML, "", "无记录时不渲染任何条目");
}

// —— 2. 存了四条，只取最新三条 ——
{
  const list = [
    report("r1", "八字", "庚辰日主 · 事业与规则", "2026-11-07T10:00:00.000Z", 7),
    report("r2", "紫微", "子女宫 · 贪狼在申", "2026-11-05T10:00:00.000Z", 13),
    report("r3", "流年", "2026 丙午流年", "2026-11-03T10:00:00.000Z", 6),
    report("r4", "流日", "十一月二日", "2026-10-30T10:00:00.000Z", 2),
  ];
  const nodes = run({ "mingli.reports.v1": JSON.stringify(list) });
  eq(nodes["recent-note"].hidden, true, "有记录时提示隐藏");
  eq(nodes["recent-list"].hidden, false, "有记录时列表显示");
  const html = nodes["recent-list"].innerHTML;
  const ids = [...html.matchAll(/report\.html\?id=([^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
  eq(ids.length, 3, "最多显示三条");
  eq(ids.join(","), "r1,r2,r3", "按时间倒序、最新的在前，第四条不出现");
  ok(html.includes("庚辰日主 · 事业与规则"), "显示真实标题");
  ok(html.includes("11 月 7 日"), "显示日期");
  ok(html.includes(">八<"), "八字标记为「八」");
  ok(html.includes(">紫<"), "紫微标记为「紫」");
  ok(html.includes(">年<"), "流年标记为「年」");
  ok(html.includes("7 个主题"), "显示主题数");
  ok(!html.includes("11 月 3 日</b>"), "标题与日期不串位");
}

// —— 3. 乱序写入时也按时间排 ——
{
  const list = [
    report("old", "八字", "旧的一条", "2026-01-01T00:00:00.000Z", 1),
    report("new", "紫微", "新的一条", "2026-12-01T00:00:00.000Z", 1),
  ];
  const nodes = run({ "mingli.reports.v1": JSON.stringify(list) });
  const ids = [...nodes["recent-list"].innerHTML.matchAll(/id=([^"]+)"/g)].map((m) => m[1]);
  eq(ids[0], "new", "乱序写入时仍取最新");
}

// —— 4. 只有旧版「最近一份」也能显示 ——
{
  const nodes = run({ "mingli.report.v1": JSON.stringify(report("latest", "八字", "只有一份", "2026-11-06T00:00:00.000Z", 3)) });
  ok(nodes["recent-list"].innerHTML.includes("只有一份"), "兼容旧键 mingli.report.v1");
  eq(nodes["recent-list"].hidden, false, "旧键有数据时列表显示");
}

// —— 5. 坏数据不炸、不显示空壳 ——
{
  const nodes = run({ "mingli.reports.v1": "{not json" });
  eq(nodes["recent-note"].hidden, false, "坏 JSON 时退回空态");
  eq(nodes["recent-list"].hidden, true, "坏 JSON 不渲染列表");
}

// —— 6. 没有 sections 的残片不进入列表 ——
{
  const list = [report("ok", "八字", "正常", "2026-11-01T00:00:00.000Z", 2), { id: "broken", title: "残片", createdAt: "2026-11-09T00:00:00.000Z" }];
  const nodes = run({ "mingli.reports.v1": JSON.stringify(list) });
  ok(!nodes["recent-list"].innerHTML.includes("残片"), "没有内容的残片不显示");
  ok(nodes["recent-list"].innerHTML.includes("正常"), "正常记录照常显示");
}

console.log(`home-recent: ${assertionCount} 项全部通过。`);
