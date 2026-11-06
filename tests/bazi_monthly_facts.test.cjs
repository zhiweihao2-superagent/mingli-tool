// 流月事实包本身的完整性（.pair/plan.json T5 点名的文件）。
//
// 这里校验的是**包**，不是页面：月份连续性、证据索引、校验摘要、内容指纹。
// 指纹用 JS 独立复算一遍（FNV-1a over UTF-8），和后端 Python 侧给出的 mf- 值对撞——
// 跨语言的同一算法对撞，比"读回来跟我刚写的相等"有意义得多。

const assert = require("node:assert");
const path = require("node:path");
const { readFileSync } = require("node:fs");

const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures");

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  PASS ${label}`);
}

function load(name) {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
}

// 与后端 month_fingerprint 同一算法：FNV-1a over UTF-8 bytes，取低 32 位
function fnv1a(text) {
  const bytes = Buffer.from(text, "utf8");
  let value = 0x811c9dc5;
  for (const byte of bytes) {
    value ^= byte;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

// 与后端 month_fingerprint 一致：只覆盖边界三要素（JS 只能从 lean 夹具复算）
// 与后端 month_fingerprint 同序同字段：边界 + 落盘可读的内容（干支与关系计数）
// 与后端 _luck_digest 同序：状态/干支/起止/分段
function luckDigest(luck) {
  if (!luck || typeof luck !== "object") return "";
  const segments = luck.segments || [];
  const token = [
    String(luck.status || ""),
    String(luck.ganzhi || ""),
    String(luck.from || ""),
    String(luck.to || ""),
    String(segments.length),
    segments.map((seg) => `${seg.start}~${seg.end}:${seg.ganzhi}`).join(","),
  ].join("|");
  return fnv1a(token);
}

function recomputeFingerprint(months) {
  const parts = months.map((m) => [
    String(m.index),
    String(m.start),
    String(m.end),
    String(m.ganzhi || ""),
    String(m.relation_count || 0),
    String(m.confirmed_count || 0),
    String(m.candidate_count || 0),
    String(m.relations_digest || ""),
    luckDigest(m.luck),
    String(m.boundary_source || ""),
    String(m.jie || ""),
    String(m.jie_longitude || ""),
  ].join("|"));
  return `mf-${fnv1a(parts.join("||"))}`;
}

// RFC 6901
function resolvePointer(document, pointer) {
  assert.strictEqual(pointer[0], "/", `非法指针 ${pointer}`);
  return pointer
    .slice(1)
    .split("/")
    .reduce((node, raw) => {
      const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
      assert.ok(node !== null && node !== undefined, `指针 ${pointer} 在 ${token} 处断链`);
      return Array.isArray(node) ? node[Number(token)] : node[token];
    }, document);
}

const FILES = [
  "monthly-real-minute.json",
  "monthly-real-branch.json",
  "monthly-real-zishi.json",
  "monthly-real-unknown.json"
];

console.log("--- 包结构 ---");
check("四个真实性精度夹具都是 12 个月且索引 1..12", () => {
  FILES.forEach((file) => {
    const pkg = load(file);
    assert.strictEqual(pkg.months.length, 12, file);
    assert.deepStrictEqual(
      pkg.months.map((m) => m.index),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      file
    );
  });
});

check("相邻月首尾相接且 start < end", () => {
  FILES.forEach((file) => {
    const months = load(file).months;
    for (let i = 0; i < months.length - 1; i += 1) {
      assert.strictEqual(months[i].end, months[i + 1].start, `${file} 第 ${i + 1} 月`);
    }
    months.forEach((month) => assert.ok(month.start < month.end, `${file} 第 ${month.index} 月`));
  });
});

check("两个月一个节气序列：立春起、小寒收", () => {
  const expected = [
    "立春", "惊蛰", "清明", "立夏", "芒种", "小暑",
    "立秋", "白露", "寒露", "立冬", "大雪", "小寒"
  ];
  FILES.forEach((file) => {
    assert.deepStrictEqual(load(file).months.map((m) => m.jie), expected, file);
  });
});

console.log("\n--- 证据索引 ---");
check("每个 json_pointer 都能在包内解析到对应月份", () => {
  FILES.forEach((file) => {
    const pkg = load(file);
    pkg.months.forEach((month, i) => {
      assert.strictEqual(month.json_pointer, `/months/${i}`, `${file} 指针应为零基`);
      const target = resolvePointer(pkg, month.json_pointer);
      assert.strictEqual(target.index, month.index);
      assert.strictEqual(target.ganzhi, month.ganzhi);
    });
  });
});

check("evidence_id 在包内唯一且指向本月", () => {
  FILES.forEach((file) => {
    const pkg = load(file);
    const seen = new Set();
    pkg.months.forEach((month) => {
      assert.ok(!seen.has(month.evidence_id), `${file} evidence_id 重复：${month.evidence_id}`);
      seen.add(month.evidence_id);
      assert.ok(
        month.evidence_id.includes(`months[${month.index - 1}]`),
        `${file} 第 ${month.index} 月证据 ID 下标不符：${month.evidence_id}`
      );
    });
  });
});

check("上下半年各引用 6 个月，且证据 ID 都来自对应月份", () => {
  FILES.forEach((file) => {
    const pkg = load(file);
    const ids = new Set(pkg.months.map((m) => m.evidence_id));
    const first = pkg.half_years.first_half;
    const second = pkg.half_years.second_half;
    assert.deepStrictEqual(first.months, [1, 2, 3, 4, 5, 6], file);
    assert.deepStrictEqual(second.months, [7, 8, 9, 10, 11, 12], file);
    assert.strictEqual(first.evidence_ids.length, 6);
    assert.strictEqual(second.evidence_ids.length, 6);
    const monthEvidence = (index) => pkg.months[index - 1].evidence_id;
    assert.deepStrictEqual(
      first.evidence_ids,
      first.months.map(monthEvidence),
      `${file} 上半年证据与本月的 evidence_id 不一致`,
    );
    assert.deepStrictEqual(
      second.evidence_ids,
      second.months.map(monthEvidence),
      `${file} 下半年证据与本月的 evidence_id 不一致`,
    );
  });
});

console.log("\n--- 校验摘要与指纹 ---");
check("validation 全部通过且 check id 唯一", () => {
  FILES.forEach((file) => {
    const pkg = load(file);
    assert.strictEqual(pkg.validation.status, "pass", file);
    const ids = pkg.validation.checks.map((c) => c.id);
    assert.ok(ids.length >= 8, `${file} 校验项只有 ${ids.length} 条`);
    assert.strictEqual(new Set(ids).size, ids.length, `${file} 校验 id 重复`);
    pkg.validation.checks.forEach((c) => assert.strictEqual(c.pass, true, `${file} ${c.id}`));
  });
});

check("指纹格式正确，且用 JS 独立复算与后端一致", () => {
  FILES.forEach((file) => {
    const pkg = load(file);
    assert.match(pkg.fingerprint, /^mf-[0-9a-f]{8}$/, file);
    assert.strictEqual(
      recomputeFingerprint(pkg.months),
      pkg.fingerprint,
      `${file} 跨语言指纹不一致`
    );
  });
});

check("边界一变，指纹立刻变（防指纹是常数）", () => {
  const pkg = load("monthly-real-minute.json");
  const before = recomputeFingerprint(pkg.months);
  const mutated = pkg.months.map((m) => ({ ...m }));
  mutated[3].start = mutated[3].start.replace(/\d{2}:/, "00:");
  assert.notStrictEqual(recomputeFingerprint(mutated), before);
});

console.log("\n--- 年份绑定 ---");
check("包内 target_year 与 annual.year 一致", () => {
  FILES.forEach((file) => {
    const pkg = load(file);
    assert.strictEqual(pkg.target_year, 2026, file);
    assert.strictEqual(pkg.annual.year, 2026, file);
    assert.strictEqual(pkg.annual.ganzhi, pkg.annual.gan + pkg.annual.zhi);
  });
});

const GAN = "甲乙丙丁戊己庚辛壬癸";
// 五虎遁：年干 → 寅月天干
const YIN_STEM = { 甲: "丙", 己: "丙", 乙: "戊", 庚: "戊", 丙: "庚", 辛: "庚", 丁: "壬", 壬: "壬", 戊: "甲", 癸: "甲" };

check("流月天干按五虎遁对目标年干起算（JS 独立推导）", () => {
  FILES.forEach((file) => {
    const pkg = load(file);
    const yin = YIN_STEM[pkg.annual.gan];
    assert.ok(yin, `${file} 年干 ${pkg.annual.gan} 无法起遁`);
    const start = GAN.indexOf(yin);
    pkg.months.forEach((month, position) => {
      const expected = GAN[(start + position) % 10];
      assert.strictEqual(month.gan, expected, `${file} 第 ${month.index} 月天干应为 ${expected}`);
    });
  });
});

console.log(`\n===== 事实包完整性 ${passed} 项全部通过 =====`);
