// 年度报告（6 主题一批）端到端探针：验证「一次请求跑完整批」是否会超时。
// 用法：node scripts/_probe_annual_ai.mjs [年份]
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = { createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }) };

const BASE = process.env.MINGLI_BASE || "http://127.0.0.1:8765";
const YEAR = Number(process.argv[2] || 2026);
const TOPICS = (process.argv[3] || "annual-overview,annual-career,annual-relationship,annual-wealth,annual-wellbeing,annual-home").split(",").map(s => s.trim()).filter(Boolean);

require("../web/ai-contract.js");
require("../web/report-structure.js");
require("../web/bazi-knowledge.js");

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

const payload = {
  schema_version: "1.0",
  profile: {
    display_name: null, calendar: "solar", date: "1990-05-15", is_leap_month: false,
    time: { precision: "minute", value: "12:30", branch: null },
    timezone: "Asia/Shanghai", sex_for_calculation: "male",
    birthplace: { label: null, longitude: null, latitude: null },
  },
  rules: { profile_id: "engine-default-v1", true_solar_time: false, clock_time_is_dst: false },
  options: { save_history: false, annual_cycles_through: 2033 },
};

const calc = await postJson("/api/v1/bazi/calculate", payload);
if (!calc.ok) { console.error("calculate failed", calc.status, JSON.stringify(calc.data).slice(0, 500)); process.exit(1); }

const contract = globalThis.MingliAiContract.build({ bazi: calc.data, annualYear: YEAR });
console.log("systems:", Object.keys(contract.systems), "annualYear:", contract.annualYear ?? YEAR);

const knowledgePayload = JSON.parse(
  require("node:fs").readFileSync(new URL("../knowledge/bazi/knowledge-v1.json", import.meta.url), "utf8"),
);
const digest = globalThis.MingliBaziKnowledge.loadForScopes(
  globalThis.MingliBaziKnowledge.createIndex(knowledgePayload),
  contract.scopeCatalog.supported,
  { maxChars: 12000, excerptChars: 600 },
);

const reportPlan = globalThis.MingliReportStructure.build(contract, { annualYear: YEAR });
const reportContract = { ...contract, reportPlan, knowledge: digest };
const planTopics = reportPlan.topics.filter(t => TOPICS.includes(t.id))
  .map(t => `${t.id}:${t.status}:${t.evidence.length}`);
console.log("plan:", planTopics.join(" "));

const body = JSON.stringify({ contract: reportContract, topicIds: TOPICS, consent: true, consentVersion: "2026-10" });
console.log("request bytes:", body.length);

const started = Date.now();
const result = await postJson("/api/v1/interpret", JSON.parse(body));
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`HTTP ${result.status} in ${elapsed}s`);

if (!result.ok) {
  console.error("failed:", JSON.stringify(result.data).slice(0, 900));
  process.exit(1);
}
const out = result.data.output || result.data;
console.log("sections:", (out.sections || []).length, "audit:", out.audit?.status, "evidence:", out.audit?.evidenceCount);
for (const s of (out.sections || []).slice(0, 3)) {
  console.log(`- [${s.topic}] ${s.title}: ${String(s.plainLanguage).slice(0, 80)}…`);
}
