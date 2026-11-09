"use strict";

// 出图回归：布局可算、换行正确、卡片不重叠、无 DOM 时能降级。
const assertRaw = require("node:assert/strict");
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

global.window = global;
global.self = global;
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../web/report-image.js"), "utf8"));
const api = global.MingliReportImage;

// 桩测量：中文按 1em、ASCII 按 0.55em，足够验证换行与布局推进。
function stubMeasure(value, font) {
  const size = Number(String(font).match(/(\d+)px/)[1]);
  let width = 0;
  for (const char of String(value)) width += char.charCodeAt(0) > 0x2e80 ? size : size * 0.55;
  return width;
}

const record = {
  system: "annual-2026",
  systemLabel: "2026 年度",
  title: "2026 年度解读报告",
  createdAt: "2026-11-07T12:12:00.000Z",
  summary: { plainLanguage: "整体看，这一年同时有合作与竞争两条线。", confidence: "medium" },
  sections: [
    {
      topic: "annual-overview",
      title: "这一年整体",
      oneLineSummary: "合作与竞争交替出现。",
      plainLanguage: "这一年你可能同时感到被拉在一起和被推着走。".repeat(4),
      practicalAdvice: ["把重要约定写下来", "别在情绪高点做决定"],
      reflectionQuestion: "今年哪件事最需要你先确认规则？",
      evidencePaths: ["/systems/bazi/facts/annual/2026", "/systems/bazi/facts/luck-cycle"],
      knowledgeCitations: ["滴天髓/旺衰判断原则"],
    },
    { topic: "annual-career", title: "工作与学习", plainLanguage: "工作里需要更多表态的时刻。", practicalAdvice: [] },
  ],
  limitations: ["未提供旺衰打分，不能判断身强身弱。"],
  audit: { status: "pass", evidenceCount: 5 },
};

const layout = api.layoutReport(record, stubMeasure);
assert.ok(layout.height > 600, "整图应有合理高度");
assert.equal(layout.width, api.THEME.width);
assert.ok(layout.items.some(item => item.kind === "text" && item.text.includes("2026 年度解读报告")), "应画标题");
assert.ok(layout.items.some(item => item.kind === "text" && item.text === "先看这里"), "应画摘要卡标题");
assert.ok(layout.items.filter(item => item.kind === "card").length >= 3, "摘要 + 两个主题至少三张卡");
assert.ok(layout.items.some(item => item.kind === "text" && item.text.includes("可以怎么做")), "应画行动建议标题");
assert.ok(layout.items.some(item => item.kind === "text" && item.text.includes("盘面依据 2 条")), "应画盘面依据统计");
assert.ok(layout.items.some(item => item.kind === "text" && item.text.includes("资料边界")), "应画资料边界");

// 长正文必须折行，且每行宽度不超过内容区
const contentWidth = api.THEME.width - api.THEME.pad * 2;
const bodyLines = layout.items.filter(item => item.kind === "text" && item.size === 26 && item.text.includes("被拉在一起"));
assert.ok(bodyLines.length >= 2, "长正文应折成多行");
for (const line of bodyLines) {
  assert.ok(stubMeasure(line.text, line.font) <= contentWidth, `行宽应受限于内容区：${line.text}`);
}

// 卡片不重叠：按 y 排序后逐张检查
const cards = layout.items.filter(item => item.kind === "card");
for (let i = 1; i < cards.length; i += 1) {
  assert.ok(cards[i].y >= cards[i - 1].y + cards[i - 1].height, "卡片之间不应重叠");
}
assert.ok(cards[0].height > 100 && cards[1].height > 200, "卡片高度应是正的合理值");

// 所有绘制点都必须落在画布内
for (const item of layout.items) {
  if (item.kind === "text") assert.ok(item.y <= layout.height && item.x < layout.width, "文字应落在画布内");
}

const name = api.filename(record);
assert.match(name, /^命理工具-.*\.png$/, "文件名应为 png");
assert.ok(!/[\\/:*?"<>|]/.test(name), "文件名不应含非法字符");

// 无 DOM 时降级为失败对象，而不是抛错
assert.equal(api.render(record).ok, false, "无 DOM 时 render 应失败");
assert.equal(api.download(null).ok, false, "无记录时 download 应失败");

// 空报告的极端输入不应崩
const bare = api.layoutReport({ sections: [] }, stubMeasure);
assert.ok(bare.height > 0, "空报告也要能出图");

console.log(`report_image.test.cjs: ${__checks} assertions passed`);
