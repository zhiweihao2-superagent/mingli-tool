"use strict";

// 报告导出回归：Markdown/JSON 结构、文件名、以及无 DOM 环境下的降级。
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

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../web/report-export.js"), "utf8"));
const api = global.MingliReportExport;

const output = {
  requirementId: "mi1-bz1-test",
  summary: { plainLanguage: "整体偏金土。", evidencePaths: ["/systems/bazi/facts/pillars"], confidence: "medium" },
  sections: [
    {
      topic: "annual-overview",
      title: "这一年整体",
      oneLineSummary: "合作与竞争交替。",
      plainLanguage: "你可能同时被拉在一起和被推着走。",
      evidenceExplanation: "流年干支与日主的关系决定主题。",
      practicalAdvice: ["把约定写下来", "别在情绪高点做决定"],
      reflectionQuestion: "哪件事最需要先确认规则？",
      evidencePaths: ["/systems/bazi/facts/annual/2026"],
      knowledgeCitations: ["滴天髓/旺衰判断原则"],
    },
  ],
  limitations: ["未提供旺衰打分，不能判断身强身弱。"],
  audit: { status: "pass", evidenceCount: 3 },
};

const record = api.recordFromResult(output, { system: "annual-2026", systemLabel: "2026 年度" });
assert.equal(record.sections.length, 1, "应保留一个主题");
assert.equal(record.audit.status, "pass");

const md = api.toMarkdown(record);
assert.match(md, /^# 2026 年度解读报告/m, "标题应带体系");
assert.match(md, /## 1\. 这一年整体/, "应有主题小节");
assert.match(md, /\*\*可以怎么做\*\*/, "应有行动建议段");
assert.match(md, /- 把约定写下来/, "应列出建议条目");
assert.match(md, /`\/systems\/bazi\/facts\/annual\/2026`/, "应保留证据路径");
assert.match(md, /## 资料边界/, "应带资料边界");
assert.match(md, /不构成医疗、法律、投资/, "应带免责声明");

const parsed = JSON.parse(api.toJson(record));
assert.equal(parsed.schema, "mingli.report-export/v1");
assert.equal(parsed.record.sections[0].topic, "annual-overview");

const name = api.filename(record, "md");
assert.match(name, /^命理工具-.*\.md$/, "文件名应可读且带扩展名");
assert.ok(!/[\\/:*?"<>|]/.test(name), "文件名不应含非法字符");

// 无 DOM 时应明确降级而不是抛错
assert.equal(api.download(record, "md").ok, false, "无 DOM 时 download 应返回失败");
assert.equal(api.download(null, "md").ok, false, "无记录时应返回失败");

// 有桩 DOM 时应走 Blob + a[download]
let clicked = null;
global.URL = { createObjectURL: () => "blob:stub", revokeObjectURL: () => {} };
global.Blob = class { constructor(parts, options) { this.parts = parts; this.options = options; } };
global.document = {
  createElement: () => ({ style: {}, click() { clicked = this.download; }, remove() {} }),
  body: { appendChild() {} },
};
const result = api.download(record, "json");
assert.equal(result.ok, true, "有 DOM 时应导出成功");
assert.match(clicked, /\.json$/, "应按目标格式命名");

console.log(`report_export.test.cjs: ${__checks} assertions passed`);
console.log(`===== 报告导出检查 ${__checks} 项全部通过 =====`);
