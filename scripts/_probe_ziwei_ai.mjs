// 紫微报告批次探针：复现「某主题没标资料引用」的场景，验证降级是否生效。
// 用法：node scripts/_probe_ziwei_ai.mjs children,family
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }) };

globalThis.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
for (const file of ["ziwei-facts.js", "ziwei-adapter.js", "ai-contract.js", "report-structure.js", "ziwei-knowledge-digest.js"]) {
  const code = readFileSync(path.join(ROOT, "web", file), "utf8");
  new Function(code).call(globalThis);
}

const BASE = process.env.MINGLI_BASE || "http://127.0.0.1:8765";
const topics = (process.argv[2] || "children,family").split(",").map(s => s.trim()).filter(Boolean);
const YEAR = Number(process.argv[3] || 2026);

const chart = globalThis.MingliZiwei.calculate(
  { calendar: "solar", date: "1990-05-15", time: { precision: "minute", value: "12:30", branch: null }, sex_for_calculation: "male" },
  { asOfYear: YEAR, asOfDate: "2026-11-08", asOfTimeIndex: 6 }
);

const contract = globalThis.MingliAiContract.build({ ziwei: chart, annualYear: YEAR });
console.log("systems:", Object.keys(contract.systems));

const knowledge = JSON.parse(readFileSync(path.join(ROOT, "knowledge", "ziwei", "knowledge-v7.7.json"), "utf8"));
const digest = globalThis.MingliZiweiKnowledgeDigest.build(knowledge, chart, { maxChars: 9000, excerptChars: 420 });
console.log("digest:", digest.status, "anchors:", (digest.items || digest.refs || []).length ?? "?");
contract.knowledge = digest;
contract.reportPlan = globalThis.MingliReportStructure.build(contract, { annualYear: YEAR });

const body = JSON.stringify({ contract, topicIds: topics, consent: true, consentVersion: "2026-10" });
console.log("request bytes:", body.length);

const started = Date.now();
const response = await fetch(BASE + "/api/v1/interpret", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});
const text = await response.text();
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`HTTP ${response.status} in ${elapsed}s`);

let data;
try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }

if (!response.ok) {
  console.log("FAILED:", JSON.stringify(data).slice(0, 500));
  process.exit(1);
}
const out = data.output || data;
console.log("sections:", out.sections.length, "audit:", JSON.stringify(out.audit));
for (const s of out.sections) {
  console.log(`- [${s.topic}] citations=${JSON.stringify(s.knowledgeCitations)}${s.citationNote ? " note=" + s.citationNote : ""}`);
}
console.log("limitations:", JSON.stringify(out.limitations).slice(0, 300));
