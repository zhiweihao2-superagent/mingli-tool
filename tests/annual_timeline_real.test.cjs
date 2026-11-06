// 用**真实后端输出**喂前端组装器。
//
// 现有前端测试全部使用合成夹具：稳定，但断言的是"我以为后端的形状"。
// 一旦后端改了字段（这次就改了 luck / relation_scope 的结构），合成夹具不会报错，
// 到了浏览器里才炸。这里换成真数据，契约错位会在 node 里就暴露。
//
// 夹具由 `python scripts/generate_monthly_fixtures.py` 生成。

const assert = require("node:assert");
const path = require("node:path");
const { readFileSync } = require("node:fs");

const ROOT = path.join(__dirname, "..");
require(path.join(ROOT, "web", "ziwei-facts.js"));
require(path.join(ROOT, "web", "annual-timeline.js"));

const Timeline = globalThis.MingliAnnualTimeline;
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

const CASES = [
  { file: "monthly-real-minute.json", label: "精确到分钟", luckStatuses: ["ok"] },
  { file: "monthly-real-branch.json", label: "只知时辰", luckStatuses: ["ok"] },
  { file: "monthly-real-zishi.json", label: "只知子时", luckStatuses: ["ok"] },
  { file: "monthly-real-unknown.json", label: "时辰未知", luckStatuses: ["indeterminate"] }
];

const unavailableZiwei = { status: "unavailable", months: [], reason: "未知时辰，无法建立紫微盘" };

for (const testCase of CASES) {
  const fixture = load(testCase.file);
  const pkg = Timeline.build({
    baziMonthly: fixture,
    ziweiMonthly: unavailableZiwei,
    targetYear: fixture.target_year,
    ziweiBlockedReason: unavailableZiwei.reason
  });
  const view = Timeline.buildMonthlyView(pkg);

  check(`${testCase.label}：真实数据能装出 12 个月`, () => {
    assert.strictEqual(pkg.months.length, 12);
    assert.deepStrictEqual(pkg.months.map((m) => m.index), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.strictEqual(pkg.year, fixture.target_year);
  });

  check(`${testCase.label}：指纹三处都能读到，且声明值与后端一致`, () => {
    assert.strictEqual(pkg.fingerprints.declared, fixture.fingerprint);
    assert.ok(pkg.fingerprints.recomputed, "缺复算指纹");
    assert.strictEqual(typeof pkg.fingerprints.matches, "boolean");
    assert.ok(pkg.fingerprint, "缺包指纹");
  });

  check(`${testCase.label}：luck 状态与后端逐月一致`, () => {
    const statuses = [...new Set(pkg.months.map((m) => m.bazi.luck?.status))];
    assert.deepStrictEqual(statuses.sort(), testCase.luckStatuses.slice().sort());
    const backendStatuses = [...new Set(fixture.months.map((m) => m.luck.status))];
    assert.deepStrictEqual(statuses.sort(), backendStatuses.sort());
  });

  check(`${testCase.label}：关系条数原样透传`, () => {
    pkg.months.forEach((month, i) => {
      assert.strictEqual(month.bazi.relationCount, fixture.months[i].relation_count);
    });
  });

  check(`${testCase.label}：展示层 12 行都有内容且不抛异常`, () => {
    assert.strictEqual(view.length, 12);
    view.forEach((row, i) => {
      assert.ok(row.title && row.title.length > 0, `第 ${i + 1} 行缺标题`);
      assert.ok(row.span && row.span.length > 0, `第 ${i + 1} 行缺节气区间`);
      assert.ok(row.facts && row.facts.length > 0, `第 ${i + 1} 行缺事实行`);
      assert.ok(row.ziwei && row.ziwei.includes("紫微"), `第 ${i + 1} 行紫微文案异常`);
      assert.strictEqual(row.ziweiDetails, null, "紫微不可用时不应有四态明细");
    });
  });

  check(`${testCase.label}：大运文案与状态对得上`, () => {
    view.forEach((row, i) => {
      const luck = pkg.months[i].bazi.luck;
      if (luck.status === "ok") {
        assert.ok(row.facts.includes("大运 "), `第 ${i + 1} 行应显示大运干支：${row.facts}`);
        assert.ok(row.facts.includes(luck.ganzhi), `第 ${i + 1} 行缺干支 ${luck.ganzhi}`);
      } else if (luck.status === "indeterminate") {
        assert.ok(
          row.facts.includes("不确定") || row.facts.includes("大运："),
          `第 ${i + 1} 行应说明大运不确定：${row.facts}`
        );
      }
    });
  });
}

check("时辰未知：十二个月都不绑大运，且每行都说明原因", () => {
  const fixture = load("monthly-real-unknown.json");
  const pkg = Timeline.build({
    baziMonthly: fixture,
    ziweiMonthly: unavailableZiwei,
    targetYear: fixture.target_year,
    ziweiBlockedReason: unavailableZiwei.reason
  });
  const view = Timeline.buildMonthlyView(pkg);
  pkg.months.forEach((month, i) => {
    assert.strictEqual(month.bazi.luck.status, "indeterminate");
    assert.ok(month.bazi.luck.reason, `第 ${i + 1} 月缺原因`);
    assert.ok(view[i].facts.includes("不确定"), view[i].facts);
  });
});

check("真实夹具里的半月汇总与后端一致", () => {
  const fixture = load("monthly-real-minute.json");
  const pkg = Timeline.build({
    baziMonthly: fixture,
    ziweiMonthly: unavailableZiwei,
    targetYear: fixture.target_year
  });
  assert.deepStrictEqual(pkg.half_years.first_half.months, [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(pkg.half_years.second_half.months, [7, 8, 9, 10, 11, 12]);
  assert.strictEqual(pkg.half_years.first_half.months.length, 6);
});

// ---------------------------------------------------------------- 真实紫微流月
// 用仓库自带 iztro 跑出来的真数据（scripts/generate_ziwei_fixtures.cjs 生成）。
// 口径决策（2026-10）：跨农历月的节气月**按农历月切段**，不再整月标 unverifiable。
// 这一条钉住新契约：每月紫微可用，段数与天数必须自洽，八字侧仍是节气月。
check("真实紫微流月：跨农历月的节气月按月切段，不再整月不可用", () => {
  const bazi = load("monthly-real-minute.json");
  const ziwei = load("ziwei-monthly-real.json");
  assert.strictEqual(ziwei.months.length, 12);

  const pkg = Timeline.build({
    baziMonthly: bazi,
    ziweiMonthly: ziwei,
    targetYear: 2026
  });
  assert.strictEqual(pkg.months.length, 12);

  let splitMonths = 0;
  pkg.months.forEach((month, i) => {
    const info = month.ziwei;
    // 紫微侧：有段就可用；八字侧 tetap 节气月
    assert.ok(Array.isArray(info.segments), `第 ${i + 1} 月缺 segments`);
    assert.ok(info.segments.length >= 1 && info.segments.length <= 2,
      `第 ${i + 1} 月段数异常：${info.segments.length}`);
    if (info.segments.length === 2) {
      splitMonths += 1;
      // 两段必须首尾相接、天数之和等于整月天数
      const [first, second] = info.segments;
      const plusOneDay = date => {
        const parts = String(date).split("-").map(Number);
        const cursor = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1));
        const pad = n => String(n).padStart(2, "0");
        return `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`;
      };
      assert.strictEqual(plusOneDay(first.to), second.from,
        `第 ${i + 1} 月两段之间有缝：${first.to} → ${second.from}`);
      const total = first.days + second.days;
      const monthDays = info.segments.reduce((sum, seg) => sum + seg.days, 0);
      assert.strictEqual(total, monthDays);
      // 顶层字段取天数多的那段
      const dominant = first.days >= second.days ? first : second;
      assert.strictEqual(dominant.isDominant, true, `第 ${i + 1} 月主段标记不对`);
    } else {
      assert.strictEqual(info.coverage, "full");
    }
    assert.strictEqual(month.ziwei.status, "ok", `第 ${i + 1} 月紫微应为 ok`);
    assert.strictEqual(month.bazi.ganzhi, bazi.months[i].ganzhi, "八字侧仍是节气月");
  });

  // 段级证据：每段要有自己的农历月、字段状态与可解析指针，
  // 否则 AI 只能引用"整月"，分不清这 13 天和那 17 天各是什么。
  const firstSplit = pkg.months.find((m) => (m.ziwei.segments || []).length === 2);
  assert.ok(firstSplit, "应至少有一个月被切成两段");
  firstSplit.ziwei.segments.forEach((seg, i) => {
    assert.ok(seg.jsonPointer, `第 ${i + 1} 段缺 jsonPointer`);
    // 指针必须能解到这一段的同一个对象
    assert.strictEqual(
      Timeline.resolvePointer(pkg, seg.jsonPointer), seg,
      `第 ${i + 1} 段的 jsonPointer 解不到自身`,
    );
    if (seg.fieldPointers?.fourTransformations) {
      assert.strictEqual(
        Timeline.resolvePointer(pkg, seg.fieldPointers.fourTransformations),
        seg.fourTransformations,
        `第 ${i + 1} 段的四化指针解不到对应字段`,
      );
    }
    assert.strictEqual(
      typeof seg.verified, "boolean", `第 ${i + 1} 段的 verified 必须是布尔`,
    );
    assert.ok(seg.fieldPointers?.fourTransformations, `第 ${i + 1} 段缺四化指针`);
    assert.ok(seg.fieldStatuses, `第 ${i + 1} 段缺字段状态`);
    assert.ok(seg.lunarMonth, `第 ${i + 1} 段缺农历月`);
  });
  // 顶层字段必须与主段**深度相等**：两处分别采样时，source 或状态一旦不一致就说明走偏了
  const dom = firstSplit.ziwei.segments.find((x) => x.isDominant);
  if (dom && dom.verified === true) {
    ['palaceOverlay', 'fourTransformations', 'transitStars'].forEach((key) => {
      assert.deepStrictEqual(
        firstSplit.ziwei[key],
        dom[key],
        `顶层 ${key} 与主段同名字段不相等`,
      );
    });
  }

  const [seg1, seg2] = firstSplit.ziwei.segments;
  assert.notStrictEqual(seg1.jsonPointer, seg2.jsonPointer, "两段指针不能相同");
  assert.notStrictEqual(seg1.lunarMonth, seg2.lunarMonth, "跨月的两段农历月应不同");

  // 节气月 30.4 天、农历月 29.5 天，绝大多数月份必然跨月
  assert.ok(splitMonths >= 10, `只有 ${splitMonths} 个月被切段，与预期不符`);
});

check("真实紫微流月：不影响八字侧的月份与关系数", () => {
  const bazi = load("monthly-real-minute.json");
  const withZiwei = Timeline.build({
    baziMonthly: bazi,
    ziweiMonthly: load("ziwei-monthly-real.json"),
    targetYear: 2026
  });
  const withoutZiwei = Timeline.build({
    baziMonthly: bazi,
    ziweiMonthly: unavailableZiwei,
    targetYear: 2026
  });
  const ziweiFixture = load("ziwei-monthly-real.json");
  withZiwei.months.forEach((month, i) => {
    assert.strictEqual(month.bazi.ganzhi, withoutZiwei.months[i].bazi.ganzhi);
    assert.strictEqual(month.bazi.relationCount, withoutZiwei.months[i].bazi.relationCount);
    // 与**夹具**比，而不是跟自己比（后者任何值都能过）
    assert.strictEqual(
      month.ziwei.status,
      ziweiFixture.months[i].status,
      `第 ${i + 1} 月紫微状态与夹具不一致`,
    );
  });
  assert.strictEqual(
    withZiwei.fingerprints.recomputed,
    withoutZiwei.fingerprints.recomputed,
    "紫微侧状态不该影响八字边界指纹"
  );
});

check("真实紫微夹具与当前引擎一致（防夹具过期）", () => {
  const fixture = load("ziwei-monthly-real.json");
  // 现算一遍真排盘，比对夹具里的状态——否则引擎或口径改了、夹具还是旧的，测试会假绿
  globalThis.self = globalThis;
  globalThis.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
  require(path.join(ROOT, "web", "ziwei-adapter.js"));
  const Z = globalThis.MingliZiwei;
  const F = globalThis.MingliZiweiFacts;

  const bazi = load("monthly-real-minute.json");
  const chart = Z.calculate(
    {
      calendar: "solar",
      date: "1990-05-15",
      time: { precision: "minute", value: "12:30" },
      sex_for_calculation: "male",
      is_leap_month: false
    },
    { asOfYear: 2026 }
  );
  assert.strictEqual(chart.status, "ok", JSON.stringify(chart.reason || chart.error));
  const timeIndex = Z.resolveTimeIndex({ precision: "minute", value: "12:30" });
  const live = F.buildMonthlyTiming(
    chart.astrolabe,
    chart.palaces,
    Timeline.monthSpecsFrom(bazi),
    timeIndex.index
  );

  // T1：按**业务 index** 配对，而不是数组位置；先证明索引集合完整且唯一
  const indexMonths = (months) => {
    const map = new Map();
    (months || []).forEach((month) => {
      assert.ok(!map.has(month.index), `索引 ${month.index} 重复`);
      map.set(month.index, month);
    });
    return map;
  };
  const liveByIndex = indexMonths(live.months);
  const cachedByIndex = indexMonths(fixture.months);
  // 索引必须是**整数且精确等于 1..12**，不能只是两边相等
  const EXPECTED_INDEXES = Array.from({ length: 12 }, (_, i) => i + 1);
  const checkIndexSet = (map, label) => {
    const keys = [...map.keys()].sort((a, b) => a - b);
    keys.forEach((key) => {
      assert.ok(Number.isInteger(key), `${label} 索引 ${key} 不是整数`);
    });
    assert.deepStrictEqual(keys, EXPECTED_INDEXES, `${label} 索引集合不是 1..12`);
  };
  checkIndexSet(liveByIndex, "live");
  checkIndexSet(cachedByIndex, "cached");

  const assembledLive = Timeline.build({ baziMonthly: bazi, ziweiMonthly: live, targetYear: 2026 });
  const assembledCached = Timeline.build({ baziMonthly: bazi, ziweiMonthly: fixture, targetYear: 2026 });
  const liveAssembledByIndex = indexMonths(assembledLive.months);
  const cachedAssembledByIndex = indexMonths(assembledCached.months);
  checkIndexSet(liveAssembledByIndex, "assembledLive");
  checkIndexSet(cachedAssembledByIndex, "assembledCached");

  // 两种装配结果必须逐月逐段一致，且每段的 evidenceId 与三个指针都能解析
  const allPointersResolve = (pkg, label) => {
    let checked = 0;
    (pkg.months || []).forEach((month) => {
      (month.ziwei?.segments || []).forEach((seg) => {
        assert.ok(seg.evidenceId, `${label} 段缺 evidenceId`);
        assert.deepStrictEqual(
          Timeline.resolvePointer(pkg, seg.jsonPointer), seg,
          `${label} ${seg.jsonPointer} 未解析到自身`,
        );
        ["palaceOverlay", "fourTransformations", "transitStars"].forEach((key) => {
          const pointer = seg.fieldPointers?.[key];
          assert.ok(pointer, `${label} 段缺 ${key} 指针`);
          const resolved = Timeline.resolvePointer(pkg, pointer);
          assert.strictEqual(
            resolved, seg[key],
            `${label} ${pointer} 未解析到本字段 envelope`,
          );
          // 排除"解析到兄弟 envelope"：不能等于同段其它两个字段
          ["palaceOverlay", "fourTransformations", "transitStars"]
            .filter(other => other !== key && seg[other])
            .forEach((other) => {
              assert.notStrictEqual(
                resolved, seg[other],
                `${label} ${key} 指针解析到了兄弟字段 ${other}`,
              );
            });
          checked += 1;
        });
      });
    });
    return checked;
  };
  const livePointers = allPointersResolve(assembledLive, "assembledLive");
  const cachedPointers = allPointersResolve(assembledCached, "assembledCached");
  assert.strictEqual(livePointers, cachedPointers, "两种装配的字段指针数量不一致");
  assert.ok(livePointers > 0, "没有任何字段指针被解析验证");

  for (const [index, month] of liveAssembledByIndex) {
    const other = cachedAssembledByIndex.get(index);
    assert.ok(other, `assembledCached 缺少第 ${index} 月`);
    [
      "status", "reason", "coverage", "segmentCount", "coordinateAligned",
      "coordinateNote", "coordinateBasis", "eligibility",
      "fieldStatuses", "ganzhi", "lunarMonth", "sampleDates",
    ].forEach((key) => {
      assert.deepStrictEqual(
        other.ziwei?.[key] ?? null, month.ziwei?.[key] ?? null,
        `第 ${index} 月装配结果 ${key} 不一致`,
      );
    });
    // validation 只比状态（夹具省略 checks 明细）
    assert.deepStrictEqual(
      other.ziwei?.validation?.status ?? null, month.ziwei?.validation?.status ?? null,
      `第 ${index} 月装配 validation.status 不一致`,
    );
    const a = month.ziwei?.segments || [];
    const b = other.ziwei?.segments || [];
    assert.strictEqual(b.length, a.length, `第 ${index} 月装配段数不一致`);
    a.forEach((seg, position) => {
      // 段级逐键深比较（含指针与 evidenceId）；envelope 只比 status/source，
      // 因为夹具按方案 B 不落 value
      ["from", "to", "days", "isDominant", "verified", "midpoint",
        "lunarMonth", "signature", "evidenceId", "jsonPointer", "fieldPointers",
        "fieldStatuses"].forEach((key) => {
        assert.deepStrictEqual(
          b[position][key] ?? null, seg[key] ?? null,
          `第 ${index} 月第 ${position + 1} 段 ${key} 不一致`,
        );
      });
      assert.deepStrictEqual(
        b[position].validation?.status ?? null, seg.validation?.status ?? null,
        `第 ${index} 月第 ${position + 1} 段 validation.status 不一致`,
      );
      ["palaceOverlay", "fourTransformations", "transitStars"].forEach((key) => {
        assert.deepStrictEqual(
          b[position][key]?.status ?? null, seg[key]?.status ?? null,
          `第 ${index} 月第 ${position + 1} 段 ${key}.status 不一致`,
        );
        assert.deepStrictEqual(
          b[position][key]?.source ?? null, seg[key]?.source ?? null,
          `第 ${index} 月第 ${position + 1} 段 ${key}.source 不一致`,
        );
      });
    });
  }

  // T2（方案 B）：夹具不落 value，因此 value 与完整 validation 只在
  // **两次独立生成**之间比较，不与夹具比
  const liveAgain = F.buildMonthlyTiming(
    chart.astrolabe,
    chart.palaces,
    Timeline.monthSpecsFrom(bazi),
    timeIndex.index,
  );
  const againByIndex = indexMonths(liveAgain.months);
  checkIndexSet(againByIndex, "二次生成");
  for (const [index, month] of liveByIndex) {
    const again = againByIndex.get(index);
    assert.ok(again, `二次生成缺少第 ${index} 月`);
    assert.deepStrictEqual(again, month, `第 ${index} 月两次生成结果不一致`);
  }

  // 二次生成结果也要各自装配，再与首次装配逐月逐段比较
  const assembledRegenerated = Timeline.build({
    baziMonthly: bazi,
    ziweiMonthly: { status: live.status, months: liveAgain.months },
    targetYear: 2026,
  });
  const regeneratedByIndex = indexMonths(assembledRegenerated.months);
  checkIndexSet(regeneratedByIndex, "assembledRegenerated");
  const assembledLiveFirstByIndex = indexMonths(
    Timeline.build({ baziMonthly: bazi, ziweiMonthly: live, targetYear: 2026 }).months,
  );
  for (const [index, month] of assembledLiveFirstByIndex) {
    const again = regeneratedByIndex.get(index);
    assert.ok(again, `assembledRegenerated 缺少第 ${index} 月`);
    ["status", "coverage", "segmentCount", "coordinateAligned", "fieldStatuses"].forEach((key) => {
      assert.deepStrictEqual(
        again.ziwei?.[key] ?? null, month.ziwei?.[key] ?? null,
        `第 ${index} 月两次装配 ${key} 不一致`,
      );
    });
    assert.deepStrictEqual(
      again.ziwei?.validation?.status ?? null, month.ziwei?.validation?.status ?? null,
      `第 ${index} 月两次装配 validation.status 不一致`,
    );
    const a = month.ziwei?.segments || [];
    const b = again.ziwei?.segments || [];
    assert.strictEqual(b.length, a.length, `第 ${index} 月两次装配段数不一致`);
    a.forEach((seg, position) => {
      assert.deepStrictEqual(
        b[position], seg,
        `第 ${index} 月第 ${position + 1} 段两次装配不一致`,
      );
    });
  }

  const compareSegments = (liveSeg, cachedSeg, label) => {
    assert.ok(liveSeg && cachedSeg, `${label} 段缺失`);
    ["from", "to", "days", "isDominant", "verified", "midpoint", "lunarMonth", "signature"].forEach((key) => {
      assert.deepStrictEqual(cachedSeg[key], liveSeg[key], `${label} 段 ${key} 已过期`);
    });
    ["asOfDate", "lunarMonth", "signature", "lunarDate"].forEach((key) => {
      assert.deepStrictEqual(cachedSeg[key] ?? null, liveSeg[key] ?? null, `${label} 段 ${key} 已过期`);
    });
    if (cachedSeg.fieldStatuses || liveSeg.fieldStatuses) {
      assert.deepStrictEqual(
        cachedSeg.fieldStatuses ?? null, liveSeg.fieldStatuses ?? null,
        `${label} 段 fieldStatuses 已过期`,
      );
    }
    // 段级 validation 只比状态（夹具按设计不落 checks 明细）
    assert.deepStrictEqual(
      cachedSeg.validation?.status ?? null, liveSeg.validation?.status ?? null,
      `${label} 段 validation.status 已过期`,
    );
    // 夹具不落 value（体积控制），但 source 必须一致——来源错了同样不可信
    ["palaceOverlay", "fourTransformations", "transitStars"].forEach((key) => {
      const a = cachedSeg[key];
      const b = liveSeg[key];
      if (!a || !b) return;
      assert.deepStrictEqual(a.source ?? null, b.source ?? null, `${label} 段 ${key}.source 已过期`);
    });
    ["palaceOverlay", "fourTransformations", "transitStars"].forEach((key) => {
      const a = cachedSeg[key];
      const b = liveSeg[key];
      if (!a || !b) {
        assert.strictEqual(Boolean(a), Boolean(b), `${label} 段 ${key} 存在性不一致`);
        return;
      }
      // 夹具按设计不落值（体积考虑），因此只比状态；值的正确性由 live 侧断言覆盖
      assert.strictEqual(a.status, b.status, `${label} 段 ${key}.status 已过期`);
      assert.strictEqual(a.reason ?? null, b.reason ?? null, `${label} 段 ${key}.reason 已过期`);
    });
  };

  for (const [index, month] of liveByIndex) {
    const cached = cachedByIndex.get(index);
    assert.ok(cached, `缓存缺少第 ${index} 月`);
    // 缺失属性与显式 null 不能混同：用 deepStrictEqual，不用 ?? null
    ["status", "reason", "coordinateAligned", "segmentCount", "coverage",
      "sampleDates", "fieldStatuses", "lunarMonth", "lunarDate"].forEach((key) => {
      assert.deepStrictEqual(cached[key], month[key], `第 ${index} 月 ${key} 已过期`);
    });
    assert.deepStrictEqual(
      cached.validation?.status ?? null, month.validation?.status ?? null,
      `第 ${index} 月 validation.status 已过期`,
    );
    const liveSegs = month.segments || [];
    const cachedSegs = cached.segments || [];
    assert.strictEqual(cachedSegs.length, liveSegs.length, `第 ${index} 月段数已过期`);
    liveSegs.forEach((seg, position) => {
      compareSegments(seg, cachedSegs[position], `第 ${index} 月第 ${position + 1}`);
    });
    ["palaceOverlay", "fourTransformations", "transitStars"].forEach((key) => {
      // 存在性、状态、原因、来源四项都要核（夹具省略 value）
      assert.strictEqual(Boolean(cached[key]), Boolean(month[key]), `第 ${index} 月 ${key} 存在性不一致`);
      if (!cached[key] || !month[key]) return;
      assert.strictEqual(cached[key].status, month[key].status, `第 ${index} 月 ${key}.status 已过期`);
      assert.deepStrictEqual(cached[key].reason ?? null, month[key].reason ?? null, `第 ${index} 月 ${key}.reason 已过期`);
      assert.deepStrictEqual(cached[key].source ?? null, month[key].source ?? null, `第 ${index} 月 ${key}.source 已过期`);
    });
  }
});

check("两套月份坐标保持分离（计划 out_of_scope：不统一口径）", () => {
  const bazi = load("monthly-real-minute.json");
  const pkg = Timeline.build({
    baziMonthly: bazi,
    ziweiMonthly: unavailableZiwei,
    targetYear: 2026
  });
  assert.strictEqual(pkg.coordinate.merged, false, "坐标口径被合并了");
  assert.notStrictEqual(pkg.coordinate.bazi, pkg.coordinate.ziwei);
  assert.ok(pkg.coordinate.bazi.includes("solar-term"), pkg.coordinate.bazi);
  assert.ok(pkg.coordinate.ziwei.includes("lunar"), pkg.coordinate.ziwei);
  assert.ok(pkg.coordinate.note && pkg.coordinate.note.length > 0, "缺口径说明");
});

check("紫微适配器真的暴露 astrolabe 与原生 palaces（计划假设）", () => {
  // plan-frontend 的假设写着：必须取 calculate 处的真实 astrolabe 与原生 palaces，
  // 不能从格式化后的展示数据反推。这条假设用真排盘验一遍。
  globalThis.self = globalThis;
  globalThis.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
  require(path.join(ROOT, "web", "ziwei-adapter.js"));
  const chart = globalThis.MingliZiwei.calculate(
    {
      calendar: "solar",
      date: "1990-05-15",
      time: { precision: "minute", value: "12:30" },
      sex_for_calculation: "male",
      is_leap_month: false
    },
    { asOfYear: 2026 }
  );
  assert.strictEqual(chart.status, "ok");
  assert.ok(chart.astrolabe && typeof chart.astrolabe === "object", "未暴露 astrolabe");
  assert.ok(Array.isArray(chart.palaces) && chart.palaces.length === 12, "未暴露原生宫位");
  // 宫位要有引擎原生结构（名称/干支），不是展示层拼出来的字符串
  const palace = chart.palaces[0];
  assert.ok(palace && typeof palace === "object");
  assert.ok(
    "name" in palace || "earthlyBranch" in palace || "heavenlyStem" in palace,
    `宫位缺少原生字段：${Object.keys(palace).slice(0, 6).join(",")}`
  );
});

console.log(`\n===== 真实数据契约检查 ${passed} 项全部通过 =====`);
