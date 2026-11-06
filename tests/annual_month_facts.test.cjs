// 年度层面的事实一致性（.pair/plan.json T5 点名的第二个文件）。
//
// bazi_monthly_facts.test.cjs 校验的是"包结构与证据索引"，这里校验的是
// **年度汇总与逐月事实是否自洽**：大运覆盖统计对不对、relation_audit 的状态有没有说谎、
// schema 1.1 把年中结果收进 mid_year 之后顶层有没有又被污染。
//
// 这些正是最容易出错的地方：顶层说"年度不可用"，却挂着一个具体干支。

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

const ALL = [
  { file: "monthly-real-minute.json", label: "精确到分钟", expectLuck: "ok" },
  { file: "monthly-real-branch.json", label: "只知时辰", expectLuck: "ok" },
  { file: "monthly-real-zishi.json", label: "只知子时", expectLuck: "ok" },
  { file: "monthly-real-unknown.json", label: "时辰未知", expectLuck: "indeterminate" }
];

const LAYERS = ["natal", "annual", "monthly", "luck"];

console.log("--- 逐月大运状态 ---");
check("各精度夹具的逐月 luck 状态符合预期", () => {
  ALL.forEach(({ file, label, expectLuck }) => {
    const pkg = load(file);
    const statuses = [...new Set(pkg.months.map((m) => m.luck.status))];
    assert.deepStrictEqual(statuses, [expectLuck], `${label}: ${statuses}`);
  });
});

check("luck 状态都在许可词表内，且非 ok 的都带原因", () => {
  const allowed = new Set(["ok", "before_start", "indeterminate", "split", "unavailable"]);
  ALL.forEach(({ file, label }) => {
    load(file).months.forEach((month) => {
      const luck = month.luck;
      assert.ok(allowed.has(luck.status), `${label} 第 ${month.index} 月非法状态 ${luck.status}`);
      if (luck.status !== "ok") {
        assert.ok(luck.reason, `${label} 第 ${month.index} 月缺原因`);
      }
    });
  });
});

console.log("\n--- 作用域诚实性 ---");
check("computed 与 omitted 不相交，且原局/流年/流月三层永远在 computed 里", () => {
  ALL.forEach(({ file, label }) => {
    load(file).months.forEach((month) => {
      const scope = month.relation_scope;
      assert.ok(scope, `${label} 第 ${month.index} 月缺 relation_scope`);
      const computed = new Set(scope.computed_layers);
      scope.omitted_layers.forEach((layer) => {
        assert.ok(!computed.has(layer), `${label} 第 ${month.index} 月 ${layer} 既算又没算`);
      });
      ["natal", "annual", "monthly"].forEach((layer) => {
        assert.ok(computed.has(layer), `${label} 第 ${month.index} 月缺 ${layer}`);
      });
      if (scope.omitted_layers.length) {
        assert.ok(scope.reason, `${label} 第 ${month.index} 月省略了层却没写原因`);
      }
    });
  });
});

check("luck 状态与 scope 声明必须一致", () => {
  ALL.forEach(({ file, label }) => {
    load(file).months.forEach((month) => {
      const computed = month.relation_scope.computed_layers;
      const luckComputed = computed.includes("luck");
      if (month.luck.status === "ok") {
        assert.ok(luckComputed, `${label} 第 ${month.index} 月 luck=ok 却声明没算大运`);
      }
      if (month.luck.status === "indeterminate" || month.luck.status === "unavailable") {
        assert.ok(!luckComputed, `${label} 第 ${month.index} 月 luck=${month.luck.status} 却声称算了`);
      }
    });
  });
});

console.log("\n--- 年度汇总 ---");
check("半年覆盖 1..12 且与大运覆盖统计一致", () => {
  ALL.forEach(({ file, label }) => {
    const pkg = load(file);
    const coverage = pkg.relation_audit.luck_coverage;
    const combined = [...coverage.months_with_luck, ...coverage.months_without_luck].sort((a, b) => a - b);
    assert.deepStrictEqual(combined, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], label);

    // 清单必须与逐月实际状态对得上：只比"合并后覆盖 1..12"，
    // 把有运的月份写进 without、没运的写进 with 也能过。
    const actualWithLuck = [...new Set(
      pkg.months
        .filter((month) => (month.relation_scope?.computed_layers || []).includes("luck"))
        .map((month) => month.index)
    )].sort((a, b) => a - b);
    assert.deepStrictEqual(
      [...coverage.months_with_luck].sort((a, b) => a - b),
      actualWithLuck,
      `${label} 的 months_with_luck 与逐月 relation_scope 不一致`,
    );
    assert.deepStrictEqual(
      [...coverage.months_without_luck].sort((a, b) => a - b),
      pkg.months
        .filter((month) => !(month.relation_scope?.computed_layers || []).includes("luck"))
        .map((month) => month.index)
        .sort((a, b) => a - b),
      `${label} 的 months_without_luck 与逐月 relation_scope 不一致`,
    );

    const full = coverage.months_with_luck.length === 12;
    assert.strictEqual(coverage.coverage, full ? "full" : "partial", label);
    // 整体状态还取决于原局是否可信：跨节或只知子时都会把原局标成不确定
    const natalOk = pkg.relation_audit.natal.complete && !pkg.relation_audit.natal.uncertain;
    assert.strictEqual(pkg.relation_audit.status, full && natalOk ? "ok" : "partial", label);
  });
});

check("layers.luck 状态与 months_with_luck 一致", () => {
  ALL.forEach(({ file, label }) => {
    const luck = load(file).layers.luck;
    assert.strictEqual(luck.status, luck.months_with_luck.length ? "ok" : "unavailable", label);
    assert.strictEqual(
      [...luck.months_with_luck, ...luck.months_without_luck].sort((a, b) => a - b).join(","),
      "1,2,3,4,5,6,7,8,9,10,11,12",
      label
    );
  });
});

check("schema 1.1：年中结果收进 mid_year，顶层不再带干支/区间", () => {
  ALL.forEach(({ file, label }) => {
    const pkg = load(file);
    assert.match(pkg.schema_version, /^1\.\d+$/, label);
    const midYear = pkg.layers.luck.mid_year;
    assert.ok(midYear, `${label} 缺 mid_year`);
    assert.strictEqual(midYear.scope, "mid-year");
    ["ganzhi", "from", "to", "sequence", "at", "reason"].forEach((key) => {
      assert.ok(!(key in pkg.layers.luck), `${label} 顶层不该有 ${key}`);
    });
  });
});

check("relation_audit.layers 与 luck 可用性一致", () => {
  ALL.forEach(({ file, label }) => {
    const pkg = load(file);
    const layers = pkg.relation_audit.layers;
    const hasLuck = pkg.layers.luck.months_with_luck.length > 0;
    assert.strictEqual(layers.includes("luck"), hasLuck, label);
    layers.forEach((layer) => assert.ok(LAYERS.includes(layer), `${label} 非法层 ${layer}`));
  });
});

console.log("\n--- 反例：证明上面的检查会失败 ---");
check("把某月的 luck 改成 ok 但 scope 不变，一致性检查必须报错", () => {
  const pkg = JSON.parse(JSON.stringify(load("monthly-real-unknown.json")));
  const month = pkg.months[0];
  month.luck = { ...month.luck, status: "ok", ganzhi: "甲子" };
  const computed = month.relation_scope.computed_layers;
  assert.ok(!computed.includes("luck"), "夹具前提：该月本不绑大运");
  // 复刻上面的判据
  const inconsistent = month.luck.status === "ok" && !computed.includes("luck");
  assert.strictEqual(inconsistent, true, "篡改后应当被判定为不一致");
});

check("把 mid_year 的 ganzhi 摊回顶层，检查必须报错", () => {
  const pkg = JSON.parse(JSON.stringify(load("monthly-real-minute.json")));
  pkg.layers.luck.ganzhi = pkg.layers.luck.mid_year.ganzhi;
  assert.ok("ganzhi" in pkg.layers.luck);
  const violations = ["ganzhi", "from", "to", "sequence", "at", "reason"].filter(
    (key) => key in pkg.layers.luck
  );
  assert.deepStrictEqual(violations, ["ganzhi"]);
});

console.log(`\n===== 年度事实一致性 ${passed} 项全部通过 =====`);
