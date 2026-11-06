// 纯八字 AI 解读端到端探针：只装一套体系，验证新门禁在真实模型上不误伤。
// 用法：node scripts/probe_bazi_ai.mjs [--topics bazi-foundation,bazi-pattern]
import { readFileSync, writeFile } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = { createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }) };

const BASE = process.env.MINGLI_BASE || "http://127.0.0.1:8765";
const args = process.argv.slice(2);
const topicArg = args.indexOf("--topics");
const topicIds = topicArg >= 0
  ? args[topicArg + 1].split(",").map(s => s.trim()).filter(Boolean)
  : ["bazi-foundation", "bazi-pattern"];

require("../web/ai-contract.js");
require("../web/report-structure.js");
require("../web/bazi-knowledge.js");

const payload = {
  schema_version: "1.0",
  profile: {
    display_name: null,
    calendar: "solar",
    date: "1990-05-15",
    is_leap_month: false,
    time: { precision: "minute", value: "12:30", branch: null },
    timezone: "Asia/Shanghai",
    sex_for_calculation: "male",
    birthplace: { label: null, longitude: null, latitude: null },
  },
  rules: { profile_id: "engine-default-v1", true_solar_time: false, clock_time_is_dst: false },
  options: { save_history: false, annual_cycles_through: 2033 },
};

async function postJson(path, body) {
  const response = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: response.ok, status: response.status, data };
}

const calc = await postJson("/api/v1/bazi/calculate", payload);
if (!calc.ok) {
  console.error("calculate failed", calc.status, JSON.stringify(calc.data).slice(0, 800));
  process.exit(1);
}

// /api/v1/bazi/calculate 的响应本身就是合同需要的 bazi 输入：
// { status, calculation, ai_facts, warnings, monthly_facts }
const calcData = calc.data;
if (!calcData.ai_facts) {
  console.error("no ai_facts in response; keys =", Object.keys(calcData));
  process.exit(1);
}

const contract = globalThis.MingliAiContract.build({ bazi: calcData });
console.log("contract systems:", Object.keys(contract.systems));
console.log("contract scopes :", contract.requestedScopes.join(","));
console.log("rule profile    :", contract.systems.bazi.ruleProfile.id);

// 知识层：把 scope 对应的古籍章节装成摘要随合同发出。
// 服务端会校验 knowledgeCitations 必须逐字取自这里，
// 所以「引经据典」不是口头声明，而是有清单可核对的。
const knowledgePayload = JSON.parse(
  readFileSync(new URL("../knowledge/bazi/knowledge-v1.json", import.meta.url), "utf8"),
);
const knowledgeIndex = globalThis.MingliBaziKnowledge.createIndex(knowledgePayload);
const digest = globalThis.MingliBaziKnowledge.loadForScopes(
  knowledgeIndex, contract.scopeCatalog.supported, { maxChars: 12000, excerptChars: 600 },
);
console.log("knowledge digest:", JSON.stringify(digest.stats), digest.status);
for (const line of digest.limitations) console.log("  !", line);

// 报告批次需要 reportPlan：服务端 _report_topic_specs 读 contract.reportPlan
const reportPlan = globalThis.MingliReportStructure.build(contract);
const reportContract = { ...contract, reportPlan, knowledge: digest };
const planTopics = reportPlan.topics
  .filter(topic => topicIds.includes(topic.id))
  .map(topic => ({ id: topic.id, status: topic.status, evidence: topic.evidence.length }));
console.log("report plan     :", JSON.stringify(planTopics));

const result = await postJson("/api/v1/interpret", {
  contract: reportContract,
  topicIds,
  consent: true,
  consentVersion: "2026-10",
});
if (!result.ok) {
  console.error("interpret failed", result.status, JSON.stringify(result.data).slice(0, 1200));
  process.exit(1);
}
const out = result.data.output || result.data;
console.log("---- output ----");
console.log(JSON.stringify(out, null, 2).slice(0, 6000));

// 落盘成可读样本：只有通过服务端校验的 output 才会走到这里
const lines = [];
lines.push("# 八字 AI 解读样本（单体系）", "");
lines.push(`- 生成时间：${new Date().toISOString()}`);
lines.push(`- 规则档案：${contract.systems.bazi.ruleProfile.id}`);
lines.push(`- 合同编号：${out.contractId || "(未返回)"}`);
lines.push(`- 主题：${topicIds.join(" / ")}`);
lines.push(`- 校验：${out.audit?.status || "?"}（引用 ${out.audit?.evidenceCount ?? "?"} 条依据）`);
lines.push(`- 说明：本文件由 \`scripts/probe_bazi_ai.mjs\` 调用真实模型生成，只含八字一套体系，不含紫微。`);
lines.push("");
if (out.methodStatement) {
  lines.push("## 判法声明", "", out.methodStatement, "");
}
lines.push("## 总览", "", out.summary?.plainLanguage || "(无)", "");
lines.push(`依据：${(out.summary?.evidencePaths || []).map(p => `\`${p}\``).join("、")}`, "");
lines.push("## 分主题");
for (const section of out.sections || []) {
  lines.push("", `### ${section.title || section.topic}`, "");
  if (section.oneLineSummary) lines.push(`**一句话**：${section.oneLineSummary}`, "");
  lines.push(section.plainLanguage || "(无)", "");
  if (section.evidenceExplanation) lines.push(`**依据怎么用**：${section.evidenceExplanation}`, "");
  lines.push(`依据：${(section.evidencePaths || []).map(p => `\`${p}\``).join("、")}`, "");
  if (Array.isArray(section.practicalAdvice) && section.practicalAdvice.length) {
    lines.push("**怎么用**：");
    for (const item of section.practicalAdvice) lines.push(`- ${item}`);
    lines.push("");
  }
  const topicCitations = Array.isArray(section.knowledgeCitations) ? section.knowledgeCitations : [];
  if (topicCitations.length) {
    lines.push("**本主题引用**：", "");
    for (const anchor of topicCitations) {
      const hit = globalThis.MingliBaziKnowledge.resolve(knowledgeIndex, anchor);
      lines.push(`- ${hit.citation || anchor}　<sub>anchor: ${anchor}</sub>`);
    }
    lines.push("");
  }
  if (section.reflectionQuestion) lines.push(`**自问**：${section.reflectionQuestion}`, "");
}
const citations = Array.isArray(out.knowledgeCitations) ? out.knowledgeCitations : [];
lines.push("## 引用的古籍章节", "");
if (citations.length === 0) {
  lines.push("（本次未引用古籍原文摘要）", "");
} else {
  for (const anchor of citations) {
    const hit = globalThis.MingliBaziKnowledge.resolve(knowledgeIndex, anchor);
    lines.push(`- ${hit.citation || anchor}　<sub>anchor: ${anchor}</sub>`);
  }
  lines.push("");
}
lines.push("## 本次解读的局限", "");
for (const item of out.limitations || []) lines.push(`- ${item}`);
lines.push("");
await new Promise((resolve, reject) => {
  writeFile(new URL("../docs/bazi-ai-sample.md", import.meta.url), `${lines.join("\n")}`, "utf8",
    err => (err ? reject(err) : resolve()));
});
console.log("\nwrote docs/bazi-ai-sample.md");
