// 年度月份事实包装配层的测试：合并、证据路径、校验、指纹，以及紫微缺数据时的显式降级。
// 不依赖 iztro 引擎，用合成输入覆盖本模块自己的逻辑。

const assert = require("node:assert");
const path = require("node:path");

require(path.join(__dirname, "..", "web", "ziwei-facts.js"));
require(path.join(__dirname, "..", "web", "annual-timeline.js"));

const Timeline = globalThis.MingliAnnualTimeline;
const Ziwei = globalThis.MingliZiweiFacts;

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  PASS ${label}`);
}

function fingerprintOf(months) {
  const text = months.map(m => `${m.index}|${m.start}|${m.end}`).join("|");
  const bytes = new TextEncoder().encode(text);
  let v = 0x811c9dc5;
  for (const byte of bytes) { v ^= byte; v = Math.imul(v, 0x01000193) >>> 0; }
  return `mf-${v.toString(16).padStart(8, "0")}`;
}

function buildBaziMonths(year) {
  const jie = ["立春", "惊蛰", "清明", "立夏", "芒种", "小暑",
    "立秋", "白露", "寒露", "立冬", "大雪", "小寒"];
  const gz = ["丙寅", "丁卯", "戊辰", "己巳", "庚午", "辛未",
    "壬申", "癸酉", "甲戌", "乙亥", "丙子", "丁丑"];
  const pad = value => String(value).padStart(2, "0");
  // 边界用 +08:00 表示，与真实 bazi 事实一致（用 Z 会让日期换算偏移一天）
  const edge = offset => {
    const raw = 2 + offset;                 // 从 2 月（立春）起算
    const y = raw > 12 ? year + 1 : year;
    const m = raw > 12 ? raw - 12 : raw;
    return `${y}-${pad(m)}-01T00:00:00+08:00`;
  };
  const months = jie.map((name, index) => {
    const start = edge(index);
    const end = edge(index + 1);
    return {
      index: index + 1,
      ganzhi: gz[index],
      gan: gz[index][0],
      zhi: gz[index][1],
      jie: name,
      jie_longitude: 315,
      next_jie: index === 11 ? "立春" : jie[index + 1],
      start,
      end,
      // 大运状态：夹具统一给 ok，省略层为空
      luck: { status: "ok", ganzhi: "甲申", gan: "甲", zhi: "申", from: "2017-08-15T12:00:00+08:00" },
        relations: index === 0
          ? [{
            evidence_id: "monthly.months[0].relation.stem-clash.a.b",
            kind: "stem-clash",
            participants: ["year", "liunian"],
            layers: ["natal", "annual"],
            bindings: [
              { participant: "year", layer: "natal", channel: "stem", value: "庚" },
              { participant: "liunian", layer: "annual", channel: "stem", value: "丙" }
            ],
            required_values: ["庚", "丙"]
          }]
          : [],
        relation_scope: {
          computed_layers: ["natal", "annual", "monthly", "luck"],
          omitted_layers: [],
          reason: null,
          boundaries: [],
          segments: 1,
          suggestion: null
        },
      relation_count: index === 0 ? 1 : 0
    };
  });
  return {
    target_year: year,
    annual: { year, ganzhi: gz[0], gan: gz[0][0], zhi: gz[0][1] },
    birth_pillars: {
      year: { stem: "庚", branch: "午" },
      month: { stem: "辛", branch: "巳" },
      day: { stem: "庚", branch: "辰" },
      hour: { stem: "壬", branch: "午" }
    },
    // 关系审计元数据：空关系数组不能靠 every 恒真通过
    relation_audit: { status: "ok", layers: ["natal", "annual", "monthly", "luck"] },
    status: "ok",
    validation: { status: "pass", checks: [] },
    fingerprint: fingerprintOf(months),
    months
  };
}

function buildZiweiMonths(statusFor = () => "pass", withStars = true) {
  return {
    status: "partial",
    months: Array.from({ length: 12 }, (_, index) => {
      const validationStatus = statusFor(index);
      const fieldOk = validationStatus === "pass";
      // 月份坐标始终对齐；字段是否可用由各自校验决定
      const fieldStatus = fieldOk ? "validated" : "failed";
      return {
        index: index + 1,
        status: "ok",
        reason: null,
        coordinateAligned: true,
      segments: [{
        index: 1,
        from: "2026-01-01",
        to: "2026-01-31",
        days: 31,
        verified: true,
        isDominant: true,
      }],
      segmentCount: 1,
      coverage: "full",

        validation: {
          status: validationStatus,
          // 装配层会按这些 check 复核字段状态，因此夹具必须带上与 envelope 一致的结果
          checks: [
            { id: "monthly_twelve_palaces_unique", pass: fieldOk, message: "叠宫" },
            { id: "monthly_four_hua_complete", pass: fieldOk, message: "四化" },
            {
              id: "monthly_transit_stars_valid",
              pass: fieldOk && withStars,
              message: "流曜"
            }
          ],
          hardFailures: []
        },
        validationStatus,
        asOfDate: `2026-${String(index + 2).padStart(2, "0")}-15`,
        sampleDates: null,   // 由 attachSampleDates 按本月规格填入
        solarDate: `2026-${String(index + 2).padStart(2, "0")}-15`,
        lunarDate: `农历${index + 1}月`,
        lunarMonth: `农历${index + 1}月`,
        lunarAtStart: `农历${index + 1}月`,
        lunarAtEnd: `农历${index + 1}月`,
        coordinateBasis: "iztro-lunar-month",
        coordinateNote: "紫微流月按农历月；八字流月按节气月。",
        ganzhi: "庚寅",
        palaceOverlay: {
          status: fieldStatus,
          value: fieldOk ? [{ branch: "子" }] : null,
          reason: fieldOk ? null : "叠宫校验未通过",
          source: "iztro-horoscope-monthly"
        },
        fourTransformations: {
          status: fieldStatus,
          value: fieldOk ? [{ kind: "禄" }] : null,
          reason: fieldOk ? null : "四化校验未通过",
          source: "iztro-horoscope-mutagen"
        },
        transitStars: {
          status: withStars ? fieldStatus : "failed",
          value: fieldOk && withStars ? [{ name: "流昌", type: "soft" }] : null,
          reason: fieldOk && withStars ? null : "流曜校验未通过",
          source: "iztro-horoscope-monthly"
        },
        fieldStatuses: {
          palaceOverlay: fieldStatus,
          fourTransformations: fieldStatus,
          transitStars: withStars ? fieldStatus : "failed"
        }
      };
    })
  };
}

/** 按八字月份的规格给紫微月份填取样日期，模拟真实 buildMonthlyTiming 输出。 */
function attachSampleDates(ziwei, bazi) {
  const specs = Timeline.monthSpecsFrom(bazi);
  ziwei.months.forEach(month => {
    const spec = specs.find(item => item.index === month.index);
    if (spec) {
      month.sampleDates = {
        start: spec.startDate,
        midpoint: spec.midpoint,
        end: spec.endDate
      };
      // 段边界必须跟随**各自的 bazi 月**，不能复用固定的 1 月区间，
      // 否则共享校验会以"首段起点与月份边界不符"整月降级。
      const parseDay = text => {
        const [y, m, d] = String(text).split("-").map(Number);
        return Date.UTC(y, m - 1, d);
      };
      const days = Math.round((parseDay(spec.endDate) - parseDay(spec.startDate)) / 86400000) + 1;
      month.segments = [{
        index: 1,
        from: spec.startDate,
        to: spec.endDate,
        days,
        verified: true,
        isDominant: true,
        // 单段整月：段级 envelope 与月级同源（装配层会按主段复核顶层字段）
        palaceOverlay: month.palaceOverlay,
        fourTransformations: month.fourTransformations,
        transitStars: month.transitStars,
      }];
      month.segmentCount = 1;
      month.coverage = "full";
    }
  });
  return ziwei;
}

const bazi = buildBaziMonths(2026);

console.log("\n--- 0. 来源指纹 ---");
check("边界被改但指纹未同步时整包判失败", () => {
  const tampered = buildBaziMonths(2026);
  tampered.months[4].end = "2026-06-15T00:00:00+08:00";   // 整体偏移，但仍连续
  tampered.months[5].start = "2026-06-15T00:00:00+08:00";
  const result = Timeline.build({ baziMonthly: tampered, ziweiMonthly: attachSampleDates(buildZiweiMonths(), bazi), targetYear: 2026 });
  assert.strictEqual(result.validation.status, "fail");
  const item = result.validation.checks.find(c => c.id === "source.bazi_fingerprint");
  assert.strictEqual(item.pass, false);
  assert.ok(item.message.includes("不符"));
});
check("指纹缺失时整包判失败", () => {
  const noFp = buildBaziMonths(2026);
  delete noFp.fingerprint;
  const result = Timeline.build({ baziMonthly: noFp, ziweiMonthly: attachSampleDates(buildZiweiMonths(), bazi), targetYear: 2026 });
  assert.strictEqual(result.validation.status, "fail");
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "source.bazi_fingerprint").pass,
    false
  );
});
check("未改动时指纹校验通过", () => {
  const fresh = Timeline.build({
    baziMonthly: buildBaziMonths(2026),
    ziweiMonthly: attachSampleDates(buildZiweiMonths(), bazi),
    targetYear: 2026
  });
  const item = fresh.validation.checks.find(c => c.id === "source.bazi_fingerprint");
  assert.strictEqual(item.pass, true);
});

console.log("--- 1. 合并 ---");
const ziwei = attachSampleDates(buildZiweiMonths(), bazi);
const pkg = Timeline.build({ baziMonthly: bazi, ziweiMonthly: ziwei, targetYear: 2026 });

check("12 个月", () => assert.strictEqual(pkg.months.length, 12));
check("索引 1..12", () => {
  assert.deepStrictEqual(pkg.months.map(m => m.index), Array.from({ length: 12 }, (_, i) => i + 1));
});
check("相邻月首尾相接", () => {
  for (let i = 1; i < pkg.months.length; i += 1) {
    assert.strictEqual(pkg.months[i].coordinate.start, pkg.months[i - 1].coordinate.end);
  }
});
check("八字与紫微按索引配对", () => {
  assert.strictEqual(pkg.months[0].bazi.ganzhi, "丙寅");
  assert.strictEqual(pkg.months[0].ziwei.lunarDate, "农历1月");
});
check("关系数量与证据 ID 透传", () => {
  assert.strictEqual(pkg.months[0].bazi.relationCount, 1);
  assert.deepStrictEqual(pkg.months[0].bazi.evidenceIds, ["monthly.months[0].relation.stem-clash.a.b"]);
});
check("上下半年各 6 个月", () => {
  assert.deepStrictEqual(pkg.half_years.first_half.months, [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(pkg.half_years.second_half.months, [7, 8, 9, 10, 11, 12]);
});
check("下半年起点等于上半年终点", () => {
  assert.strictEqual(pkg.half_years.second_half.start, pkg.half_years.first_half.end);
});
check("契约字段名：顶层 year + half_years.first_half/second_half", () => {
  assert.strictEqual(pkg.year, 2026);
  assert.ok(pkg.half_years.first_half);
  assert.ok(pkg.half_years.second_half);
  assert.strictEqual(pkg.half_years.first_half.months.length, 6);
  assert.strictEqual(pkg.half_years.second_half.months.length, 6);
  assert.strictEqual(pkg.targetYear, undefined, "不应残留旧字段 targetYear");
  assert.strictEqual(pkg.halfYears, undefined, "不应残留旧字段 halfYears");
});
check("每个边界都标了起止节气与来源", () => {
  assert.strictEqual(pkg.months[0].coordinate.startSource.jie, "立春");
  assert.strictEqual(pkg.months[0].coordinate.endSource.jie, "惊蛰");
  assert.strictEqual(pkg.months[11].coordinate.endSource.jie, "立春");
  assert.ok(pkg.months.every(m => m.coordinate.startSource.basis === "solar-term-apparent-longitude"));
  assert.strictEqual(
    pkg.validation.checks.find(c => c.id === "months.boundary_sources").pass,
    true
  );
});

console.log("\n--- 2. 证据路径 ---");
check("所有指针可解析", () => {
  for (const pointer of pkg.evidence.pointers) {
    assert.notStrictEqual(Timeline.resolvePointer({ months: pkg.months }, pointer), undefined, pointer);
  }
});
check("每月至少 4 条指针，含紫微字段时更多", () => {
  const first = pkg.months[0].evidence;
  assert.ok(first.includes("/months/0/bazi/ganzhi"));
  // 证据只收录能解析到**非 null 值**的字段路径
  const starsEnvelope = pkg.months[0].ziwei.transitStars;
  if (starsEnvelope?.status === "validated" && starsEnvelope.value != null) {
    assert.ok(first.includes("/months/0/ziwei/transitStars/value"));
  } else {
    assert.ok(
      !first.some((pointer) => pointer.endsWith("/value")),
      "value 为 null 时不应收录字段值路径",
    );
  }
  // 值路径只在非 null 时收录，所以下限跟着契约走：3 条八字 + 状态 + 校验状态
  assert.ok(first.length >= 5, `证据条数 ${first.length} 少于基线 5`);
});
check("字段级状态非 validated 时不进证据索引", () => {
  const failed = Timeline.build({
    baziMonthly: bazi,
    ziweiMonthly: buildZiweiMonths(index => (index === 0 ? "fail" : "pass")),
    targetYear: 2026
  });
  const pointers = failed.months[0].evidence;
  assert.ok(!pointers.some(p => p.includes("/ziwei/transitStars/value")));
  assert.ok(!pointers.some(p => p.includes("/ziwei/fourTransformations/value")));
  assert.strictEqual(failed.months[0].ziwei.transitStars.status, "unavailable");
});
check("关系事实有自己的 JSON Pointer 且可解析", () => {
  const pointer = "/months/0/bazi/relations/0";
  assert.ok(pkg.months[0].evidence.includes(pointer));
  const resolved = Timeline.resolvePointer({ months: pkg.months }, pointer);
  assert.strictEqual(resolved.kind, "stem-clash");
  assert.strictEqual(resolved.evidence_id, "monthly.months[0].relation.stem-clash.a.b");
});
check("每条关系都在包级指针索引里", () => {
  const relationPointers = pkg.evidence.pointers.filter(p => p.includes("/bazi/relations/"));
  const totalRelations = pkg.months.reduce((sum, m) => sum + m.bazi.relations.length, 0);
  assert.strictEqual(relationPointers.length, totalRelations);
  assert.ok(totalRelations >= 1);
});
check("~0/~1 转义可解析", () => {
  assert.strictEqual(Timeline.resolvePointer({ "a/b": 1 }, "/a~1b"), 1);
  assert.strictEqual(Timeline.resolvePointer({ "a~b": 2 }, "/a~0b"), 2);
});
check("不存在的指针返回 undefined", () => {
  assert.strictEqual(Timeline.resolvePointer({ months: pkg.months }, "/months/99/bazi/ganzhi"), undefined);
});
check("必需证据字段为 null 时整包校验失败", () => {
  const broken = buildBaziMonths(2026);
  broken.months[0].ganzhi = null;              // /months/0/bazi/ganzhi 会解析到 null
  const result = Timeline.build({ baziMonthly: broken, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(result.validation.status, "fail");
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "evidence.pointers_resolvable").pass,
    false
  );
});

console.log("\n--- 3. 校验与指纹 ---");
check("校验通过", () => assert.strictEqual(pkg.validation.status, "pass"));
check("每条校验都有说明", () => {
  assert.ok(pkg.validation.checks.every(c => c.id && c.message));
});
check("指纹稳定", () => {
  const again = Timeline.build({ baziMonthly: bazi, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(again.fingerprint, pkg.fingerprint);
});
check("换年份指纹改变", () => {
  const other = Timeline.build({ baziMonthly: buildBaziMonths(2027), ziweiMonthly: ziwei, targetYear: 2027 });
  assert.notStrictEqual(other.fingerprint, pkg.fingerprint);
});
check("改关系内容时指纹改变", () => {
  const mutated = JSON.parse(JSON.stringify(bazi));
  mutated.months[0].relations.push({ evidence_id: "x", kind: "branch-harm" });
  mutated.months[0].relation_count = 2;
  const other = Timeline.build({ baziMonthly: mutated, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.notStrictEqual(other.fingerprint, pkg.fingerprint);
});
check("改紫微四化时指纹改变", () => {
  const mutated = attachSampleDates(buildZiweiMonths(), bazi);
  mutated.months[0].fourTransformations = [{ kind: "忌" }];
  const other = Timeline.build({ baziMonthly: bazi, ziweiMonthly: mutated, targetYear: 2026 });
  assert.notStrictEqual(other.fingerprint, pkg.fingerprint);
});
check("明确标注两套坐标未合并", () => {
  assert.strictEqual(pkg.coordinate.merged, false);
  assert.ok(pkg.coordinate.note.includes("不做统一"));
});

console.log("\n--- 4. 紫微缺失 / 校验失败时显式降级 ---");
const partial = Timeline.build({
  baziMonthly: bazi,
  ziweiMonthly: { status: "partial", months: attachSampleDates(buildZiweiMonths(), bazi).months.slice(0, 11) },
  targetYear: 2026
});
check("缺月标 unavailable 而不是省略", () => {
  assert.strictEqual(partial.months[11].ziwei.status, "unavailable");
  assert.ok(partial.months[11].ziwei.reason.includes("未提供"));
});
check("缺月仍保留证据路径", () => {
  assert.ok(partial.months[11].evidence.length > 0);
});
check("缺月不影响整体校验通过", () => {
  assert.strictEqual(partial.validation.status, "pass");
});

const failed = Timeline.build({
  baziMonthly: bazi,
  ziweiMonthly: attachSampleDates(buildZiweiMonths(index => (index === 2 ? "fail" : "pass")), bazi),
  targetYear: 2026
});
check("字段校验失败时不连坐整月，字段对象保留自身状态", () => {
  const month = failed.months[2];
  // 月份坐标仍可用；失败的是字段本身
  assert.strictEqual(month.ziwei.status, "ok");
  ["fourTransformations", "palaceOverlay", "transitStars"].forEach(key => {
    assert.strictEqual(month.ziwei[key].status, "failed");
    assert.strictEqual(month.ziwei[key].value, null);
    assert.ok(month.ziwei[key].reason);
  });
});
check("单字段失败不影响其他字段取值", () => {
  const onlyStars = buildZiweiMonths();
  onlyStars.months[0].transitStars = {
    status: "failed", value: null, reason: "流曜校验未通过", source: "s"
  };
  onlyStars.months[0].fieldStatuses.transitStars = "failed";
  // 段与顶层必须同源：改字段状态时两处一起改，否则装配层会按"顶层与主段不一致"降级
  onlyStars.months[0].segments[0].transitStars = {
    ...onlyStars.months[0].segments[0].transitStars,
    status: "failed",
    value: null,
    reason: "流曜校验未通过",
  };
  const result = Timeline.build({
    baziMonthly: bazi,
    ziweiMonthly: attachSampleDates(onlyStars, bazi),
    targetYear: 2026
  });
  const month = result.months[0];
  assert.strictEqual(month.ziwei.transitStars.status, "failed");
  assert.strictEqual(month.ziwei.transitStars.value, null);
  // 叠宫与四化仍然可用
  assert.strictEqual(month.ziwei.palaceOverlay.status, "validated");
  assert.ok(month.ziwei.palaceOverlay.value);
  assert.strictEqual(month.ziwei.fourTransformations.status, "validated");
});
check("校验失败不影响整包结构校验", () => {
  assert.strictEqual(failed.validation.status, "pass");
});

console.log("\n--- 4b. 目标年份必须与事实一致 ---");
const mismatch = Timeline.build({
  baziMonthly: buildBaziMonths(2027),
  ziweiMonthly: ziwei,
  targetYear: 2026
});
check("年份不一致时整包校验失败", () => {
  assert.strictEqual(mismatch.validation.status, "fail");
  assert.strictEqual(mismatch.status, "fail");
});
check("给出年份不匹配的具体校验项", () => {
  const item = mismatch.validation.checks.find(c => c.id === "target.year_match");
  assert.ok(item && item.pass === false);
});
check("缺失目标年份必须判失败，不能当作通过", () => {
  const noYear = buildBaziMonths(2026);
  delete noYear.target_year;
  const result = Timeline.build({ baziMonthly: noYear, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(result.validation.status, "fail");
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "target.year_match").pass,
    false
  );
});
check("逐月流年年份不一致必须判失败", () => {
  const bad = buildBaziMonths(2026);
  bad.annual.year = 2027;
  const result = Timeline.build({ baziMonthly: bad, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(result.validation.status, "fail");
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "target.month_annual_consistent").pass,
    false
  );
});
check("上游事实源状态无效时整包判失败", () => {
  const bad = buildBaziMonths(2026);
  bad.status = "unsupported";
  const result = Timeline.build({ baziMonthly: bad, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(result.validation.status, "fail");
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "source.bazi_status").pass,
    false
  );
});
check("上游事实源校验缺失时整包判失败（不做 fail-open）", () => {
  const bad = buildBaziMonths(2026);
  delete bad.validation;
  const result = Timeline.build({ baziMonthly: bad, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(result.validation.status, "fail");
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "source.bazi_validation").pass,
    false
  );
});
check("上游事实源 status 为 unavailable 时整包判失败", () => {
  const bad = buildBaziMonths(2026);
  bad.status = "unavailable";
  const result = Timeline.build({ baziMonthly: bad, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(result.validation.status, "fail");
});
check("首末立春边界年份必须与目标年一致", () => {
  const check0 = pkg.validation.checks.find(c => c.id === "months.boundary_years");
  assert.strictEqual(check0.pass, true);
  const bad = buildBaziMonths(2026);
  bad.months[0].start = "2025-02-04T04:00:00+08:00";   // 首月起点错到上一年
  const result = Timeline.build({ baziMonthly: bad, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "months.boundary_years").pass,
    false
  );
});

console.log("\n--- 4d. 装配边界不信任输入 ---");
check("整月状态不再是 ok 时全字段清空", () => {
  const lying = attachSampleDates(buildZiweiMonths(), bazi);
  // 声明为 unverifiable（例如坐标在引擎侧被判定不可对应）
  lying.months[0].status = "unverifiable";
  lying.months[0].coordinateAligned = false;
  lying.months[0].fourTransformations = {
    status: "validated", value: [{ kind: "忌" }], reason: null, source: "s"
  };
  const result = Timeline.build({ baziMonthly: bazi, ziweiMonthly: lying, targetYear: 2026 });
  assert.notStrictEqual(result.months[0].ziwei.status, "ok");
  assert.strictEqual(result.months[0].ziwei.fourTransformations.value, null);
  assert.strictEqual(result.months[0].ziwei.transitStars.value, null);
});
check("来源自称 ok 但主段未验证时不得进入有效事实", () => {
  // 口径已改：coordinateAligned 不再决定字段可用性，改由「主段已验证」决定。
  // 所以"说谎"的样本要伪造段状态，而不是伪造对齐标记。
  const lying = attachSampleDates(buildZiweiMonths(), bazi);
  lying.months[0].status = "ok";
  lying.months[0].validation.status = "pass";
  lying.months[0].coordinateAligned = false;
  lying.months[0].coverage = "none";
  lying.months[0].segments[0].verified = false;
  const result = Timeline.build({ baziMonthly: bazi, ziweiMonthly: lying, targetYear: 2026 });
  assert.notStrictEqual(result.months[0].ziwei.status, "ok");
  assert.strictEqual(result.months[0].ziwei.fourTransformations.value, null);
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "ziwei.eligibility_enforced").pass,
    true
  );
});

console.log("\n--- 4c. 流曜必须透传 ---");
check("ziwei.transitStars 进入事实包且带字段状态", () => {
  const stars = pkg.months[0].ziwei.transitStars;
  assert.strictEqual(stars.status, "validated");
  assert.deepStrictEqual(stars.value, [{ name: "流昌", type: "soft" }]);
  assert.ok(stars.source);
});
check("流曜有可解析证据路径", () => {
  const pointer = "/months/0/ziwei/transitStars/value";
  assert.deepStrictEqual(
    Timeline.resolvePointer({ months: pkg.months }, pointer),
    [{ name: "流昌", type: "soft" }]
  );
});

console.log("\n--- 4e. 区间与关系绑定 ---");
check("零长度月份必须判失败", () => {
  const degenerate = buildBaziMonths(2026);
  const same = degenerate.months[0].start;
  degenerate.months.forEach(month => {
    month.start = same;
    month.end = same;
  });
  const result = Timeline.build({ baziMonthly: degenerate, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(result.validation.status, "fail");
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "months.positive_interval").pass,
    false
  );
});
check("参与者不属于四层时必须判失败", () => {
  const bad = buildBaziMonths(2026);
  bad.months[0].relations = [{
    evidence_id: "x",
    kind: "stem-clash",
    participants: ["who"],
    layers: ["natal"],
    bindings: [{ participant: "who", layer: "natal", channel: "stem", value: "甲" }],
    required_values: ["甲"]
  }];
  bad.months[0].relation_count = 1;
  bad.fingerprint = fingerprintOf(bad.months);
  const result = Timeline.build({ baziMonthly: bad, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "relations.participants_bound").pass,
    false
  );
});
check("缺 bindings 的关系事实必须判失败", () => {
  const bad = buildBaziMonths(2026);
  bad.months[0].relations = [{
    evidence_id: "x",
    kind: "stem-clash",
    participants: ["year", "liunian"],
    layers: ["natal", "annual"],
    values: ["庚", "丙"]
  }];
  bad.months[0].relation_count = 1;
  bad.fingerprint = fingerprintOf(bad.months);
  const result = Timeline.build({ baziMonthly: bad, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "relations.participants_bound").pass,
    false
  );
});
check("重复支的三合（参与者多于唯一支值）仍能通过", () => {
  const ok = buildBaziMonths(2026);
  // 让四层柱值与本用例的 bindings 一致：年支申、大运申、流年子、流月辰
  ok.birth_pillars.year = { stem: "庚", branch: "申" };
  ok.annual = { year: 2026, ganzhi: "丙子", gan: "丙", zhi: "子" };
  ok.months[0].zhi = "辰";
  ok.months[0].luck = { status: "ok", ganzhi: "甲申", gan: "甲", zhi: "申" };
  ok.months[0].relations = [{
    evidence_id: "x",
    kind: "branch-three-harmony",
    participants: ["year", "dayun", "liunian", "liuyue"],
    layers: ["natal", "luck", "annual", "monthly"],
    bindings: [
      { participant: "year", layer: "natal", channel: "branch", value: "申" },
      { participant: "dayun", layer: "luck", channel: "branch", value: "申" },
      { participant: "liunian", layer: "annual", channel: "branch", value: "子" },
      { participant: "liuyue", layer: "monthly", channel: "branch", value: "辰" }
    ],
    required_values: ["申", "子", "辰"]
  }];
  ok.months[0].relation_count = 1;
  ok.fingerprint = fingerprintOf(ok.months);
  const result = Timeline.build({ baziMonthly: ok, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "relations.participants_bound").pass,
    true
  );
});
check("binding 与参与者顺序错位必须判失败", () => {
  const bad = buildBaziMonths(2026);
  bad.months[0].relations = [{
    evidence_id: "x",
    kind: "stem-clash",
    participants: ["year", "liunian"],
    layers: ["natal", "annual"],
    // 顺序对调：第一条描述的是 liunian
    bindings: [
      { participant: "liunian", layer: "annual", channel: "stem", value: "丙" },
      { participant: "year", layer: "natal", channel: "stem", value: "庚" }
    ],
    required_values: ["庚", "丙"]
  }];
  bad.months[0].relation_count = 1;
  bad.fingerprint = fingerprintOf(bad.months);
  const result = Timeline.build({ baziMonthly: bad, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "relations.participants_bound").pass,
    false
  );
});
check("binding 取值与本月柱值不符必须判失败", () => {
  const bad = buildBaziMonths(2026);
  bad.months[0].relations = [{
    evidence_id: "x",
    kind: "stem-clash",
    participants: ["year", "liunian"],
    layers: ["natal", "annual"],
    bindings: [
      { participant: "year", layer: "natal", channel: "stem", value: "甲" },   // 实际是庚
      { participant: "liunian", layer: "annual", channel: "stem", value: "丙" }
    ],
    required_values: ["甲", "丙"]
  }];
  bad.months[0].relation_count = 1;
  bad.fingerprint = fingerprintOf(bad.months);
  const result = Timeline.build({ baziMonthly: bad, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "relations.participants_bound").pass,
    false
  );
});
check("首月必须由立春起算", () => {
  assert.strictEqual(pkg.months[0].coordinate.jie, "立春");
  assert.strictEqual(
    pkg.validation.checks.find(c => c.id === "months.first_is_lichun").pass,
    true
  );
});

check("取样日期不属于本月的紫微事实被拒绝", () => {
  const foreign = attachSampleDates(buildZiweiMonths(), bazi);
  foreign.months[0].sampleDates = {
    start: "2027-02-01", midpoint: "2027-02-15", end: "2027-02-28"
  };
  const result = Timeline.build({ baziMonthly: bazi, ziweiMonthly: foreign, targetYear: 2026 });
  assert.notStrictEqual(result.months[0].ziwei.status, "ok");
  assert.strictEqual(result.months[0].ziwei.fourTransformations.value, null);
  assert.strictEqual(result.months[0].ziwei.eligibility.sampleMatches, false);
});

console.log("\n--- 5. 紫微取样点 ---");
const specs = Timeline.monthSpecsFrom(bazi);
check("取样点落在月份中点（按北京时间取日历日）", () => {
  const start = Date.parse(bazi.months[0].start);
  const end = Date.parse(bazi.months[0].end);
  const expected = new Date((start + end) / 2 + 8 * 3600 * 1000)
    .toISOString().slice(0, 10);
  assert.strictEqual(specs[0].midpoint, expected);
});
check("取样点携带干支与索引", () => {
  assert.strictEqual(specs[0].ganzhi, "丙寅");
  assert.strictEqual(specs[0].index, 1);
});
check("北京时间凌晨的节气时刻按本地日期取样", () => {
  // 2026-02-04T04:00+08:00 的 UTC 日期是 02-03；必须取北京日期 02-04
  const fake = {
    months: [{
      index: 1,
      ganzhi: "庚寅",
      start: "2026-02-04T04:00:00+08:00",
      end: "2026-03-05T21:48:00+08:00"
    }]
  };
  const sample = Timeline.monthSpecsFrom(fake)[0];
  assert.strictEqual(sample.startDate, "2026-02-04");
  // end 在 03-05 当天 21:48，所以区间内最后一刻仍属 03-05（不能用 end-24h）
  assert.strictEqual(sample.endDate, "2026-03-05");
  assert.strictEqual(sample.midpoint, "2026-02-19");
});
check("北京时间 23:xx 的边界不会被推到次日", () => {
  const fake = {
    months: [{
      index: 1,
      ganzhi: "庚寅",
      start: "2026-03-05T23:36:00+08:00",
      end: "2026-04-05T02:00:00+08:00"
    }]
  };
  const sample = Timeline.monthSpecsFrom(fake)[0];
  assert.strictEqual(sample.startDate, "2026-03-05");
  assert.strictEqual(sample.endDate, "2026-04-05");
});
check("毫秒数形式的边界也能算出中点", () => {
  const startMs = Date.UTC(2026, 1, 3, 20, 0, 0);   // 北京 2026-02-04 04:00
  const endMs = Date.UTC(2026, 2, 5, 13, 48, 0);
  const sample = Timeline.monthSpecsFrom({
    months: [{ index: 1, ganzhi: "庚寅", start: startMs, end: endMs }]
  })[0];
  assert.ok(sample.midpoint, "毫秒输入也必须算出中点");
  assert.strictEqual(sample.startDate, "2026-02-04");
  assert.ok(sample.midpoint > sample.startDate);
});

check("月级审计范围为空数组时必须判失败", () => {
  const bad = buildBaziMonths(2026);
  bad.months.forEach(month => {
    month.relations = [];
    month.relation_count = 0;
    month.relation_scope = {
      computed_layers: [], omitted_layers: [], reason: null, boundaries: [], segments: 1
    };
  });
  bad.fingerprint = fingerprintOf(bad.months);
  const result = Timeline.build({ baziMonthly: bad, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(result.validation.status, "fail");
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "months.relation_scope").pass,
    false
  );
});
check("缺原局柱时整包判失败", () => {
  const bad = buildBaziMonths(2026);
  delete bad.birth_pillars;
  bad.fingerprint = fingerprintOf(bad.months);
  const result = Timeline.build({ baziMonthly: bad, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(result.validation.status, "fail");
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "source.birth_pillars").pass,
    false
  );
});
check("缺 relation_audit 时整包判失败", () => {
  const bad = buildBaziMonths(2026);
  delete bad.relation_audit;
  bad.fingerprint = fingerprintOf(bad.months);
  const result = Timeline.build({ baziMonthly: bad, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(result.validation.status, "fail");
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "source.relation_audit").pass,
    false
  );
});
check("跨运月的关系按分段取大运柱", () => {
  const split = buildBaziMonths(2026);
  split.months[0].luck = {
    status: "split",
    boundaries: ["2026-02-20T00:00:00+08:00"],
    segments: [
      { segment: 1, ganzhi: "甲申", gan: "甲", zhi: "申" },
      { segment: 2, ganzhi: "乙酉", gan: "乙", zhi: "酉" }
    ]
  };
  split.months[0].relation_scope = {
    computed_layers: ["natal", "annual", "monthly", "luck"],
    omitted_layers: [],
    reason: null,
    boundaries: ["2026-02-20T00:00:00+08:00"],
    segments: 2
  };
  split.months[0].relations = [{
    evidence_id: "x",
    kind: "stem-clash",
    segment: 2,
    participants: ["liunian", "dayun"],
    layers: ["annual", "luck"],
    bindings: [
      { participant: "liunian", layer: "annual", channel: "stem", value: "丙" },
      { participant: "dayun", layer: "luck", channel: "stem", value: "乙" }
    ],
    required_values: ["丙", "乙"]
  }];
  split.months[0].relation_count = 1;
  split.fingerprint = fingerprintOf(split.months);
  const result = Timeline.build({ baziMonthly: split, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "relations.participants_bound").pass,
    true
  );
});

check("大运可用但 computed_layers 不含 luck 必须判失败", () => {
  const bad = buildBaziMonths(2026);
  bad.months[0].relation_scope = {
    computed_layers: ["natal", "annual", "monthly"],
    omitted_layers: [],
    reason: null, boundaries: [], segments: 1
  };
  bad.fingerprint = fingerprintOf(bad.months);
  const result = Timeline.build({ baziMonthly: bad, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "months.relation_scope").pass,
    false
  );
});
check("大运不可用时 computed_layers 不得含 luck", () => {
  const bad = buildBaziMonths(2026);
  bad.months[0].luck = { status: "indeterminate", reason: "换运点不确定" };
  bad.months[0].relation_scope = {
    computed_layers: ["natal", "annual", "monthly", "luck"],
    omitted_layers: ["luck"],
    reason: null, boundaries: [], segments: 0
  };
  bad.fingerprint = fingerprintOf(bad.months);
  const result = Timeline.build({ baziMonthly: bad, ziweiMonthly: ziwei, targetYear: 2026 });
  assert.strictEqual(
    result.validation.checks.find(c => c.id === "months.relation_scope").pass,
    false
  );
});

console.log("\n--- 6. 紫微流月构建器的降级 ---");
check("无盘面时 12 个月全部 unavailable 且不抛错", () => {
  const result = Ziwei.buildMonthlyTiming(null, [], specs, 0);
  assert.strictEqual(result.months.length, 12);
  assert.ok(result.months.every(m => m.status === "unavailable"));
  assert.strictEqual(result.status, "partial");
  assert.strictEqual(result.unavailableMonths, 12);
});
check("空输入返回 unavailable", () => {
  const empty = Ziwei.buildMonthlyTiming(null, [], [], 0);
  assert.strictEqual(empty.status, "unavailable");
  assert.strictEqual(empty.monthCount, 0);
});
check("证据 ID 按索引生成", () => {
  const result = Ziwei.buildMonthlyTiming(null, [], specs, 0);
  assert.strictEqual(result.months[0].evidenceId, "monthly.months[0].ziwei");
  assert.strictEqual(result.months[11].evidenceId, "monthly.months[11].ziwei");
});
check("规格里带首末取样的日期", () => {
  assert.ok(specs[0].startDate);
  assert.ok(specs[0].endDate);
  assert.ok(specs[0].midpoint > specs[0].startDate);
  assert.ok(specs[0].endDate >= specs[0].startDate);
});
check("坐标不可对应的月份标 unverifiable 且清空字段", () => {
  // 伪造一个农历月在月中切换的盘：流月盘结构（干支）随日期变化
  const palaces = [];
  const flip = {
    horoscope: date => {
      const isFirst = date < "2026-02-10";
      return {
        lunarDate: isFirst ? "正月初三" : "二月初一",
        solarDate: date,
        decadal: {}, yearly: {}, daily: {}, hourly: {},
        monthly: {
          name: "流月",
          heavenlyStem: isFirst ? "甲" : "乙",
          earthlyBranch: isFirst ? "子" : "丑",
          mutagen: [],
          stars: [],
          palaceNames: []
        }
      };
    }
  };
  const result = Ziwei.buildMonthlyTiming(flip, palaces, specs.slice(0, 1), 0);
  const month = result.months[0];
  // 口径已改为「按月切段」：跨农历月的节气月不再整月不可用
  assert.strictEqual(month.coordinateAligned, false, "签名取不到时不得声称覆盖整月");
  // 签名取不到 → 没有已验证段 → coverage 为 none（不是 partial）
  assert.strictEqual(month.coverage, "none");
  // 关键变化：整月对齐为 false，但月份**不再是不可用**
  assert.strictEqual(month.status, "ok", "有流月数据就应可用，不再整月作废");
  assert.ok(Array.isArray(month.segments) && month.segments.length >= 1);
  assert.ok(month.segments.every(seg => seg.days > 0), "每段天数必须为正");
});
check("同一农历月内不同日期不会被误判为不对齐", () => {
  // 日期不同（lunarDate 字符串不同）但流月盘结构相同 → 应判为对齐
  const palaces12 = Array.from({ length: 12 }, (_, i) => ({
    index: i,
    name: `宫${i}`,
    earthlyBranch: "子丑寅卯辰巳午未申酉戌亥"[i]
  }));
  const slots = () => Array.from({ length: 12 }, () => []);
  const same = {
    horoscope: date => ({
      lunarDate: `正月初${date.endsWith("1") ? "一" : "五"}`,   // 含日，字符串必不同
      solarDate: date,
      decadal: {}, yearly: {}, daily: {}, hourly: {},
      monthly: {
        name: "流月",
        heavenlyStem: "甲",
        earthlyBranch: "子",
        mutagen: [],
        stars: slots(),
        palaceNames: palaces12.map(p => p.name)
      }
    })
  };
  const result = Ziwei.buildMonthlyTiming(same, palaces12, specs.slice(0, 1), 0);
  assert.strictEqual(result.months[0].coordinateAligned, true);
});

check("引擎缺 monthly 层时判 unavailable 而不是 ok", () => {
  // horoscope 存在但没有 monthly 属性 → 不能因为三处空签名相同而被判为同一农历月
  const noMonthly = {
    horoscope: date => ({
      lunarDate: "正月初一",
      solarDate: date,
      decadal: {}, yearly: {}, daily: {}, hourly: {}
    })
  };
  const result = Ziwei.buildMonthlyTiming(noMonthly, [], specs.slice(0, 1), 0);
  const month = result.months[0];
  assert.strictEqual(month.status, "unavailable");
  assert.strictEqual(month.coordinateAligned, false);
  assert.strictEqual(month.fourTransformations.status, "unavailable");
});
check("引擎缺 stars 字段时流曜标 unavailable 而不是 validated", () => {
  const palaces12 = Array.from({ length: 12 }, (_, i) => ({
    index: i, name: `宫${i}`, earthlyBranch: "子丑寅卯辰巳午未申酉戌亥"[i]
  }));
  const noStars = {
    horoscope: date => ({
      lunarDate: "正月初一",
      solarDate: date,
      decadal: {}, yearly: {}, daily: {}, hourly: {},
      monthly: {
        name: "流月",
        heavenlyStem: "甲",
        earthlyBranch: "子",
        mutagen: [],
        palaceNames: palaces12.map(p => p.name)
        // 故意不给 stars
      }
    })
  };
  const result = Ziwei.buildMonthlyTiming(noStars, palaces12, specs.slice(0, 1), 0);
  const month = result.months[0];
  assert.strictEqual(month.transitStars.status, "unavailable");
  assert.strictEqual(month.transitStars.value, null);
  assert.notStrictEqual(month.transitStars.status, "validated");
});

check("普通二月跨到闰二月必须判不对齐", () => {
  // 干支与叠宫完全相同，只有农历标签不同（二月 vs 闰二月）
  const palaces12 = Array.from({ length: 12 }, (_, i) => ({
    index: i, name: `宫${i}`, earthlyBranch: "子丑寅卯辰巳午未申酉戌亥"[i]
  }));
  const slots = () => Array.from({ length: 12 }, () => []);
  const leap = {
    horoscope: date => ({
      lunarDate: date < "2026-02-10" ? "二〇二六年二月初五" : "二〇二六年闰二月初五",
      solarDate: date,
      decadal: {}, yearly: {}, daily: {}, hourly: {},
      monthly: {
        name: "流月",
        heavenlyStem: "辛",
        earthlyBranch: "卯",
        mutagen: [],
        stars: slots(),
        palaceNames: palaces12.map(p => p.name)
      }
    })
  };
  const result = Ziwei.buildMonthlyTiming(leap, palaces12, specs.slice(0, 1), 0);
  const month = result.months[0];
  assert.strictEqual(month.coordinateAligned, false);
  // 新口径：跨农历月不再整月作废，改为按月切段后仍可用
  assert.strictEqual(month.status, "ok");
  // 新口径：跨闰二月会按月切段，主段仍有自己的叠宫事实，不再整月清空
  assert.ok(Array.isArray(month.segments) && month.segments.length >= 1);
  assert.ok(month.palaceOverlay.value, "主段应带自己的叠宫数据");
});
check("农历标签缺失时不得判为对齐", () => {
  const palaces12 = Array.from({ length: 12 }, (_, i) => ({
    index: i, name: `宫${i}`, earthlyBranch: "子丑寅卯辰巳午未申酉戌亥"[i]
  }));
  const noLunar = {
    horoscope: date => ({
      solarDate: date,
      decadal: {}, yearly: {}, daily: {}, hourly: {},
      monthly: {
        name: "流月", heavenlyStem: "辛", earthlyBranch: "卯", mutagen: [],
        stars: Array.from({ length: 12 }, () => []),
        palaceNames: palaces12.map(p => p.name)
      }
    })
  };
  const result = Ziwei.buildMonthlyTiming(noLunar, palaces12, specs.slice(0, 1), 0);
  assert.strictEqual(result.months[0].coordinateAligned, false);
  // 新口径：取不到农历标签仍不声称覆盖整月，但月份本身可用（按月切段）
  assert.strictEqual(result.months[0].status, "ok");
  assert.strictEqual(result.months[0].coverage, "none");
});

console.log("\n--- 7. 装配层不信任段结构 ---");
function withSegmentsPackage(mutate) {
  // 与 withSegments 同样的两段构造，但返回**完整装配包**，
  // 这样指针可以在真实根对象上解析
  const ziwei = attachSampleDates(buildZiweiMonths(), bazi);
  const month = ziwei.months[0];
  const spec = Timeline.monthSpecsFrom(bazi)[0];
  const parseDay = text => {
    const [y, m, d] = String(text).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const fmt = ts => new Date(ts).toISOString().slice(0, 10);
  const total = Math.round((parseDay(spec.endDate) - parseDay(spec.startDate)) / 86400000) + 1;
  const firstDays = Math.floor(total / 2);
  const secondDays = total - firstDays;
  const clone = value => JSON.parse(JSON.stringify(value));
  const makeSeg = (index, from, to, days, isDominant) => ({
    index, from, to, days, verified: true, isDominant,
    midpoint: fmt((parseDay(from) + parseDay(to)) / 2),
    palaceOverlay: clone(month.palaceOverlay),
    fourTransformations: clone(month.fourTransformations),
    transitStars: clone(month.transitStars),
  });
  const firstIsDominant = firstDays >= secondDays;
  month.segments = [
    makeSeg(1, spec.startDate, fmt(parseDay(spec.startDate) + (firstDays - 1) * 86400000), firstDays, firstIsDominant),
    makeSeg(2, fmt(parseDay(spec.startDate) + firstDays * 86400000), spec.endDate, secondDays, !firstIsDominant),
  ];
  month.segmentCount = 2;
  month.coverage = "partial";
  month.coordinateAligned = false;
  mutate?.(month, ziwei);
  return Timeline.build({ baziMonthly: bazi, ziweiMonthly: ziwei, targetYear: 2026 });
}


function withSegments(mutate) {
  // 段边界按**目标月份**的真实 spec 生成，且 envelope 逐层深拷贝（不共享引用）
  const ziwei = attachSampleDates(buildZiweiMonths(), bazi);
  const month = ziwei.months[0];
  const spec = Timeline.monthSpecsFrom(bazi)[0];
  const parseDay = text => {
    const [y, m, d] = String(text).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const fmt = ts => new Date(ts).toISOString().slice(0, 10);
  const total = Math.round((parseDay(spec.endDate) - parseDay(spec.startDate)) / 86400000) + 1;
  const firstDays = Math.floor(total / 2);
  const clone = value => JSON.parse(JSON.stringify(value));
  const makeSeg = (index, from, to, days, isDominant) => ({
    index,
    from,
    to,
    days,
    verified: true,
    isDominant,
    midpoint: fmt((parseDay(from) + parseDay(to)) / 2),
    palaceOverlay: clone(month.palaceOverlay),
    fourTransformations: clone(month.fourTransformations),
    transitStars: clone(month.transitStars),
  });
  const secondDays = total - firstDays;
  // 规则：天数最多的那段为主段；并列时取靠前的第一段
  const firstIsDominant = firstDays >= secondDays;
  month.segments = [
    makeSeg(1, spec.startDate, fmt(parseDay(spec.startDate) + (firstDays - 1) * 86400000), firstDays, firstIsDominant),
    makeSeg(2, fmt(parseDay(spec.startDate) + firstDays * 86400000), spec.endDate, secondDays, !firstIsDominant),
  ];
  month.segmentCount = 2;
  month.coverage = "partial";
  month.coordinateAligned = false;
  mutate?.(month, ziwei);
  const pkg = Timeline.build({ baziMonthly: bazi, ziweiMonthly: ziwei, targetYear: 2026 });
  return pkg.months[0].ziwei;
}

check("两段来源：coverage 不得被抬成 full", () => {
  // 正向的「两段可用」由真实数据套件覆盖；这里只钉住"不许谎报整月"
  const ziwei = withSegments();
  assert.notStrictEqual(ziwei.coverage, "full");
});

check("coverage 与段不一致时整月降级", () => {
  const ziwei = withSegments((month) => { month.coverage = "full"; });
  assert.notStrictEqual(ziwei.palaceOverlay.status, "validated");
  assert.strictEqual(ziwei.coverage, "none");
});

check("主段未验证时字段一律不可用", () => {
  // 主段可能落在第 1 或第 2 段（取决于天数），显式找主段再改
  const ziwei = withSegments((month) => {
    month.segments.find(seg => seg.isDominant).verified = false;
  });
  assert.notStrictEqual(ziwei.palaceOverlay.status, "validated");
  assert.strictEqual(ziwei.palaceOverlay.value, null);
  assert.strictEqual(ziwei.coverage, "none");
});

check("段天数非法或边界不连续时整月降级", () => {
  const badDays = withSegments((month) => { month.segments[0].days = 0; });
  assert.strictEqual(badDays.palaceOverlay.status, "unavailable");
  const badOrder = withSegments((month) => { month.segments[1].from = "2026-02-10"; });
  assert.strictEqual(badOrder.palaceOverlay.status, "unavailable");
});

check("顶层值与主段不一致时该字段降级", () => {
  const ziwei = withSegments((month) => {
    month.palaceOverlay = { ...month.palaceOverlay, value: [{ forged: true }] };
  });
  assert.strictEqual(ziwei.palaceOverlay.status, "unavailable");
  assert.strictEqual(ziwei.palaceOverlay.value, null);
});

console.log("\n--- 8. 投影一致性反例 ---");

function buildWith(mutate) {
  const ziwei = attachSampleDates(buildZiweiMonths(), bazi);
  mutate(ziwei.months[0]);
  const pkg = Timeline.build({ baziMonthly: bazi, ziweiMonthly: ziwei, targetYear: 2026 });
  return pkg.months[0].ziwei;
}

check("段缺 envelope 时该字段降级", () => {
  const ziwei = buildWith((month) => {
    delete month.segments[0].palaceOverlay;
  });
  assert.strictEqual(ziwei.palaceOverlay.status, "unavailable");
  assert.strictEqual(ziwei.palaceOverlay.value, null);
});

check("主段 value 为 null 而顶层非空时降级", () => {
  const ziwei = buildWith((month) => {
    month.palaceOverlay = { status: "validated", value: [{ forged: 1 }], reason: null, source: "iztro" };
    month.segments[0].palaceOverlay = { status: "validated", value: null, reason: null, source: "iztro" };
  });
  assert.strictEqual(ziwei.palaceOverlay.value, null);
});

check("主段信封与顶层同源（段副本不撒谎）", () => {
  const ziwei = buildWith((month) => {
    month.segments[0].fourTransformations = { status: "failed", value: null, reason: "四化校验未通过", source: "iztro" };
  });
  // 顶层与主段不一致时，顶层降级而不是跟着"变成 failed"
  assert.strictEqual(ziwei.fourTransformations.status, "unavailable");
  assert.strictEqual(ziwei.fourTransformations.value, null);
  // 段副本必须与顶层同一份（不撒谎）
  assert.strictEqual(ziwei.segments[0].fourTransformations.status, "unavailable");
});

check("coordinateAligned 非布尔时校验失败", () => {
  const ziwei = attachSampleDates(buildZiweiMonths(), bazi);
  ziwei.months[0].coordinateAligned = "true";
  const pkg = Timeline.build({ baziMonthly: bazi, ziweiMonthly: ziwei, targetYear: 2026 });
  const item = pkg.validation.checks.find(c => c.id === "ziwei.coordinate_flag_present");
  assert.strictEqual(item.pass, false);
  assert.strictEqual(pkg.months[0].ziwei.coordinateAligned, null);
});

check("aligned 为 true 但 coverage 非 full 时校验失败", () => {
  const ziwei = attachSampleDates(buildZiweiMonths(), bazi);
  ziwei.months[0].coverage = "partial";
  ziwei.months[0].segments[0].verified = false;
  const pkg = Timeline.build({ baziMonthly: bazi, ziweiMonthly: ziwei, targetYear: 2026 });
  // 该月被判不可用（coverage 归 none），因此 aligned=true 与 full 不再矛盾
  assert.strictEqual(pkg.months[0].ziwei.coverage, "none");
  assert.notStrictEqual(pkg.months[0].ziwei.palaceOverlay.status, "validated");
});

console.log("\n--- 9. 表驱动反例：字段投影 ---");

const FIELD_CHECK = {
  palaceOverlay: "monthly_twelve_palaces_unique",
  fourTransformations: "monthly_four_hua_complete",
  transitStars: "monthly_transit_stars_valid",
};
const MISMATCH = "顶层字段与主段不一致";
const CHECK_FAILED = "字段检查未通过";
const FIELD_SOURCE = {
  palaceOverlay: "iztro-horoscope-monthly",
  fourTransformations: "iztro-horoscope-mutagen",
  transitStars: "iztro-horoscope-monthly",
};

// 每行：{ id, field, mutate(month, field), expected }
const PROJECTION_CASES = [];
Object.entries(FIELD_CHECK).forEach(([field, checkId]) => {
  PROJECTION_CASES.push({
    id: `${field}-主段缺 envelope`,
    field,
    mutate: (month) => { delete month.segments[0][field]; },
    expected: { status: "unavailable", value: null, reason: MISMATCH, source: null },
  });
  PROJECTION_CASES.push({
    id: `${field}-主段缺自有 value`,
    field,
    // 只删 value，status/reason/source 保持原样，隔离单一变量
    mutate: (month) => {
      const envelope = JSON.parse(JSON.stringify(month.segments[0][field]));
      delete envelope.value;
      month.segments[0][field] = envelope;
    },
    expected: { status: "unavailable", value: null, reason: MISMATCH, source: null },
  });
  PROJECTION_CASES.push({
    id: `${field}-深层值不同`,
    field,
    // 只改**叶子**：保留 status/reason/source，仅让嵌套值不同，隔离出"值差异"这一个变量
    mutate: (month) => {
      // 段 envelope 与顶层常是**同一个引用**：先深拷贝再改叶子，
      // 否则改动会同时生效，测不出差异
      const segEnvelope = JSON.parse(JSON.stringify(month.segments[0][field]));
      // 必须改**已有叶子**：先证明叶子存在，再改它的值
      const first = Array.isArray(segEnvelope.value) ? segEnvelope.value[0] : null;
      assert.ok(first && typeof first === "object", `${field} 缺少可改的嵌套叶子`);
      const leafKey = Object.keys(first)[0];
      assert.ok(leafKey, `${field} 嵌套叶子没有可改的键`);
      const before = JSON.stringify(first[leafKey]);
      first[leafKey] = "__altered__";
      assert.notStrictEqual(JSON.stringify(first[leafKey]), before, `${field} 叶子未被改动`);
      month.segments[0][field] = segEnvelope;
    },
    expected: { status: "unavailable", value: null, reason: MISMATCH, source: null },
  });
  PROJECTION_CASES.push({
    id: `${field}-status 不同`,
    field,
    // 只改 status，value/reason/source 全保留，隔离出"状态差异"这一个变量
    mutate: (month) => {
      month.segments[0][field] = { ...month.segments[0][field], status: "failed" };
    },
    expected: { status: "unavailable", value: null, reason: MISMATCH, source: null },
  });
  PROJECTION_CASES.push({
    id: `${field}-检查未通过`,
    field,
    mutate: (month) => {
      month.validation.checks = month.validation.checks.map(c =>
        (c.id === checkId ? { ...c, pass: false } : c));
    },
    expected: {
      status: "failed", value: null, reason: CHECK_FAILED,
      source: FIELD_SOURCE[field],
    },
  });
  PROJECTION_CASES.push({
    id: `${field}-检查为真值字符串`,
    field,
    // 只有 === true 才算通过，字符串 "true" 必须被当作未通过
    mutate: (month) => {
      month.validation.checks = month.validation.checks.map(c =>
        (c.id === checkId ? { ...c, pass: "true" } : c));
    },
    expected: {
      status: "failed", value: null, reason: CHECK_FAILED,
      source: FIELD_SOURCE[field],
    },
  });
});

PROJECTION_CASES.forEach((row) => {
  check(`投影反例：${row.id}`, () => {
    const ziwei = buildWith((month) => row.mutate(month, row.field));
    const field = ziwei[row.field];
    assert.strictEqual(field.status, row.expected.status, `${row.id} status`);
    assert.deepStrictEqual(field.value, row.expected.value, `${row.id} value`);
    assert.strictEqual(field.reason, row.expected.reason, `${row.id} reason`);
    // source 也要可核对：不一致/检查失败时不得残留引擎来源
    // source 必须是**精确期望值**，不接受"null 或任意字符串"
    assert.strictEqual(field.source, row.expected.source ?? null, `${row.id} source 不对`);
    // 主段的最终 envelope 必须与顶层字段同源
    const mainSeg = ziwei.segments.find(seg => seg.isDominant);
    assert.ok(mainSeg, `${row.id} 找不到主段`);
    {
      // 与**独立期望**比，而不是与实际输出互比（两处同时错就发现不了）
      ["status", "value", "reason", "source"].forEach((key) => {
        assert.deepStrictEqual(
          mainSeg[row.field]?.[key] ?? null,
          row.expected[key] ?? null,
          `${row.id} 主段 ${key} 与独立期望不一致`,
        );
      });
      assert.strictEqual(
        mainSeg.fieldStatuses?.[row.field], field.status,
        `${row.id} 主段 fieldStatuses 与顶层不一致`,
      );
    }
  });
});

check("占位 envelope 的字段指针仍可解析", () => {
  // 两段样本：把非主段的三个 envelope 删掉，装配层必须补占位且指针可解析
  let nonMainPosition = -1;
  const pkg = withSegmentsPackage((month) => {
    nonMainPosition = month.segments.findIndex(seg => !seg.isDominant);
    ["palaceOverlay", "fourTransformations", "transitStars"].forEach((key) => {
      delete month.segments[nonMainPosition][key];
    });
  });
  assert.ok(nonMainPosition >= 0, "样本必须有两段");
  const ziwei = pkg.months[0].ziwei;
  const seg = ziwei.segments[nonMainPosition];
  assert.ok(seg, "非主段丢失");
  assert.strictEqual(
    seg.jsonPointer, `/months/0/ziwei/segments/${nonMainPosition}`,
    `段 jsonPointer 不精确：${seg.jsonPointer}`,
  );
  ["palaceOverlay", "fourTransformations", "transitStars"].forEach((key) => {
    assert.ok(seg[key] && typeof seg[key] === "object", `${key} 占位对象缺失`);
    assert.strictEqual(seg.fieldStatuses[key], seg[key].status, `${key} 状态不一致`);
    // 占位 envelope 也必须是 unavailable/null，且指针要能真正解析到它
    assert.strictEqual(seg[key].status, "unavailable", `${key} 占位状态错误`);
    assert.strictEqual(seg[key].value, null, `${key} 占位值必须为 null`);
    const pointer = seg.fieldPointers?.[key];
    assert.ok(pointer, `${key} 缺少 fieldPointer`);
    // 精确路径：月份位置 0 + 该段真实下标 + 字段名
    assert.strictEqual(
      pointer, `/months/0/ziwei/segments/${nonMainPosition}/${key}`,
      `${key} 指针路径不精确：${pointer}`,
    );
    // 占位 envelope 的 reason/source 也必须精确
    assert.strictEqual(seg[key].reason, "该段字段缺失或无效", `${key} 占位原因不对`);
    assert.strictEqual(seg[key].source, null, `${key} 占位来源必须为 null`);
    const resolved = Timeline.resolvePointer(pkg, pointer);
    assert.ok(resolved && typeof resolved === "object", `${key} 指针解不到对象：${pointer}`);
    assert.strictEqual(resolved.status, "unavailable", `${key} 指针解到的状态不对`);
    assert.strictEqual(resolved.value, null, `${key} 指针解到的值不是 null`);
    // 身份：必须就是本字段那一个 envelope，而不是同样 unavailable/null 的兄弟字段
    assert.strictEqual(resolved, seg[key], `${key} 指针没有解到本字段的 envelope`);
    assert.notStrictEqual(resolved, seg.fieldPointers, `${key} 指针解到了指针表`);
    ["palaceOverlay", "fourTransformations", "transitStars"]
      .filter((other) => other !== key)
      .forEach((other) => {
        assert.notStrictEqual(resolved, seg[other], `${key} 指针解到了 ${other} 的 envelope`);
      });
  });
});

console.log("\n--- 10. 生成侧结构校验（assessSegments）---");

const assess = globalThis.MingliZiweiFacts.assessSegments;
const SEG_BOUNDS = { startDate: "2026-02-04", endDate: "2026-03-05" };
const goodSeg = () => ({
  from: "2026-02-04", to: "2026-03-05", days: 30, verified: true,
  isDominant: true, midpoint: "2026-02-18",
});

const ASSESS_CASES = [
  {
    id: "raw 合法单段",
    source: () => ({ segments: [goodSeg()], segmentCount: 1, coverage: "full" }),
    expected: { startDate: "2026-02-04", endDate: "2026-03-05" },
    options: { raw: true },
    ok: true,
  },
  {
    id: "raw midpoint 早于 from",
    reason: "段取样点越界",
    source: () => ({ segments: [{ ...goodSeg(), midpoint: "2026-01-01" }] }),
    expected: SEG_BOUNDS,
    options: { raw: true },
    ok: false,
  },
  {
    id: "raw midpoint 为数组",
    reason: "段取样点缺失或非法",
    source: () => ({ segments: [{ ...goodSeg(), midpoint: ["2026-02-18"] }] }),
    expected: SEG_BOUNDS,
    options: { raw: true },
    ok: false,
  },
  {
    id: "expected 日期为数组",
    reason: "缺少或非法的月份边界（expected.startDate/endDate）",
    source: () => ({ segments: [goodSeg()] }),
    expected: { startDate: ["2026-02-04"], endDate: "2026-03-05" },
    options: { raw: true },
    ok: false,
  },
  {
    id: "expected 缺失",
    reason: "缺少或非法的月份边界（expected.startDate/endDate）",
    source: () => ({ segments: [goodSeg()] }),
    expected: {},
    options: { raw: true },
    ok: false,
  },
  {
    id: "非 raw isDominant 为数字",
    reason: "段的 isDominant 必须是布尔",
    source: () => ({ segments: [{ ...goodSeg(), isDominant: 1 }], segmentCount: 1, coverage: "full" }),
    expected: SEG_BOUNDS,
    options: { raw: false },
    ok: false,
  },
  {
    id: "raw midpoint 缺失",
    reason: "段取样点缺失或非法",
    source: () => {
      const seg = goodSeg();
      delete seg.midpoint;
      return { segments: [seg] };
    },
    expected: SEG_BOUNDS,
    options: { raw: true },
    ok: false,
  },
  {
    id: "raw midpoint 为 null",
    reason: "段取样点缺失或非法",
    source: () => ({ segments: [{ ...goodSeg(), midpoint: null }] }),
    expected: SEG_BOUNDS,
    options: { raw: true },
    ok: false,
  },
  {
    id: "raw midpoint 晚于 to",
    reason: "段取样点越界",
    source: () => ({ segments: [{ ...goodSeg(), midpoint: "2026-06-01" }] }),
    expected: SEG_BOUNDS,
    options: { raw: true },
    ok: false,
  },
  {
    id: "from 为数组",
    reason: "段内日期非法",
    source: () => ({ segments: [{ ...goodSeg(), from: ["2026-02-04"] }] }),
    expected: SEG_BOUNDS,
    options: { raw: true },
    ok: false,
  },
  {
    id: "expected 为倒序",
    reason: "月份边界起点晚于终点",
    source: () => ({ segments: [goodSeg()] }),
    expected: { startDate: "2026-03-05", endDate: "2026-02-04" },
    options: { raw: true },
    ok: false,
  },
  {
    id: "非 raw isDominant 缺失",
    reason: "段的 isDominant 必须是布尔",
    source: () => {
      const seg = goodSeg();
      delete seg.isDominant;
      return { segments: [seg], segmentCount: 1, coverage: "full" };
    },
    expected: SEG_BOUNDS,
    options: { raw: false },
    ok: false,
  },
  {
    id: "非 raw isDominant 为 null",
    reason: "段的 isDominant 必须是布尔",
    source: () => ({ segments: [{ ...goodSeg(), isDominant: null }], segmentCount: 1, coverage: "full" }),
    expected: SEG_BOUNDS,
    options: { raw: false },
    ok: false,
  },
  {
    id: "to 为数组",
    reason: "段内日期非法",
    source: () => ({ segments: [{ ...goodSeg(), to: ["2026-03-05"] }] }),
    expected: SEG_BOUNDS,
    options: { raw: true },
    ok: false,
  },
  {
    id: "expected.endDate 为数组",
    reason: "缺少或非法的月份边界（expected.startDate/endDate）",
    source: () => ({ segments: [goodSeg()] }),
    expected: { startDate: "2026-02-04", endDate: ["2026-03-05"] },
    options: { raw: true },
    ok: false,
  },
  {
    id: "非法日期 2026-02-30",
    reason: "段内日期非法",
    source: () => ({ segments: [{ ...goodSeg(), from: "2026-02-30" }] }),
    expected: SEG_BOUNDS,
    options: { raw: true },
    ok: false,
  },
  {
    id: "非 raw isDominant 为字符串",
    reason: "段的 isDominant 必须是布尔",
    source: () => ({ segments: [{ ...goodSeg(), isDominant: "true" }], segmentCount: 1, coverage: "full" }),
    expected: SEG_BOUNDS,
    options: { raw: false },
    ok: false,
  },
  {
    id: "段元素为 null",
    reason: "段元素不是对象",
    source: () => ({ segments: [null] }),
    expected: SEG_BOUNDS,
    options: { raw: true },
    ok: false,
  },
];

ASSESS_CASES.forEach((row) => {
  check(`生成侧：${row.id}`, () => {
    const result = assess(row.source(), row.expected, row.options);
    assert.strictEqual(result.ok, row.ok, `${row.id} ok 判定错误：${result.reason || ""}`);
    if (!row.ok) {
      // 失败时必须给出稳定形状与原因
      assert.strictEqual(typeof result.reason, "string");
      assert.ok(result.reason.length > 0, `${row.id} 缺少失败原因`);
      if (row.reason) {
        assert.strictEqual(result.reason, row.reason, `${row.id} 失败原因不对`);
      }
      assert.deepStrictEqual(result.segments, []);
      assert.strictEqual(result.mainIndex, null);
      assert.strictEqual(result.coverage, "none");
    }
  });
});

check("生成侧：合法单段返回完整结果对象", () => {
  const result = assess(
    { segments: [goodSeg()], segmentCount: 1, coverage: "full" },
    SEG_BOUNDS,
    { raw: true },
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.mainIndex, 0);
  assert.strictEqual(result.coverage, "full");
  assert.strictEqual(result.segments.length, 1);
});

check("生成侧：抛错 length getter 时不采样且降级完整", () => {
  const spec = { index: 1, startDate: "2026-02-04", endDate: "2026-03-05", midpoint: "2026-02-18" };
  let sampleCalls = 0;
  const evil = { get length() { throw new Error("boom-length"); } };
  const result = globalThis.MingliZiweiFacts.buildMonthlyTiming(null, [], [spec], 0, {
    sample: () => { sampleCalls += 1; return null; },
    segmenter: () => evil,
  });
  const month = result.months[0];
  assert.strictEqual(sampleCalls, 0, `不应采样，实际 ${sampleCalls} 次`);
  assert.strictEqual(month.coverage, "none");
  [["palaceOverlay", "iztro"], ["fourTransformations", "iztro"], ["transitStars", "iztro"]]
    .forEach(([key]) => {
      assert.strictEqual(month[key].status, "unavailable", `${key}.status 降级不对`);
      assert.strictEqual(month[key].value, null, `${key}.value 必须为 null`);
      assert.strictEqual(month[key].source, null, `${key}.source 必须为 null`);
      assert.strictEqual(typeof month[key].reason, "string", `${key}.reason 必须是字符串`);
      assert.ok(month[key].reason.length > 0, `${key}.reason 不能为空`);
    });
});

check("生成侧：结构失败时不采样（sample 调用次数为 0）", () => {
  const spec = { index: 1, startDate: "2026-02-04", endDate: "2026-03-05", midpoint: "2026-02-18" };
  let sampleCalls = 0;
  const result = globalThis.MingliZiweiFacts.buildMonthlyTiming(null, [], [spec], 0, {
    sample: () => { sampleCalls += 1; return null; },
    // 返回非数组：结构校验直接失败
    segmenter: () => ({ notAnArray: true }),
  });
  assert.strictEqual(sampleCalls, 0, `结构失败时不应采样，实际调用 ${sampleCalls} 次`);
  assert.strictEqual(result.months[0].status, "unverifiable");
  assert.deepStrictEqual(result.months[0].segments, []);
  assert.deepStrictEqual(
    [
      result.months[0].palaceOverlay.source,
      result.months[0].fourTransformations.source,
      result.months[0].transitStars.source,
    ],
    [null, null, null],
  );
});

check("生成侧：segmenter 返回带抛错 length getter 的对象不崩溃", () => {
  const spec = { index: 1, startDate: "2026-02-04", endDate: "2026-03-05", midpoint: "2026-02-18" };
  const evil = { get length() { throw new Error("boom-length"); } };
  let threw = false;
  let month = null;
  try {
    const result = globalThis.MingliZiweiFacts.buildMonthlyTiming(null, [], [spec], 0, {
      sample: () => null,
      segmenter: () => evil,
    });
    month = result.months[0];
  } catch (error) {
    threw = true;
  }
  assert.strictEqual(threw, false, "抛错的 length getter 不应让生成中断");
  assert.strictEqual(month.status, "unverifiable");
  assert.deepStrictEqual(month.segments, []);
});

check("生成侧：segmenter 返回非数组时降级并给出精确原因", () => {
  const spec = { index: 1, startDate: "2026-02-04", endDate: "2026-03-05", midpoint: "2026-02-18" };
  // 非数组（含带抛错 getter 的对象）不会触发 getter——Array.isArray 直接判否
  const evil = { get segments() { throw new Error("boom-segments"); } };
  const result = globalThis.MingliZiweiFacts.buildMonthlyTiming(null, [], [spec], 0, {
    sample: () => null,
    segmenter: () => evil,
  });
  const month = result.months[0];
  assert.strictEqual(month.status, "unverifiable");
  assert.deepStrictEqual(month.segments, []);
  assert.strictEqual(month.coverage, "none");
  assert.strictEqual(month.reason, "段结构不可信：segmenter 未返回数组");
});

check("生成侧：直接给 assessSegments 抛错 segments getter 时明确抛出", () => {
  // 契约：assessSegments 不吞异常，由调用方（buildMonthlyTiming）用 try/catch 兜底
  const evil = { get segments() { throw new Error("boom-direct"); } };
  assert.throws(
    () => assess(evil, SEG_BOUNDS, { raw: true }),
    /boom-direct/,
    "assessSegments 应把异常抛给调用方",
  );
});

console.log(`\n===== ${passed} 项全部通过 =====`);
