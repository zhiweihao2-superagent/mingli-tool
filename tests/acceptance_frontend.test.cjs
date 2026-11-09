// 规划验收标准（.pair/plan-frontend.json 的 8 条 + plan.json 的 ac5）的可执行映射。
// 用例名都带 ACnn，与计划里的 acceptance_criteria 序号一一对应。
// 风格与 annual_timeline_view.test.cjs 一致：纯函数 + 静态装配检查，不依赖浏览器。

const assertRaw = require("node:assert");
// 统计断言次数：check() 会核对"这一条真的跑了断言"，
// 光打印 PASS 标签而没有断言的 check 会直接失败。
let __asserts = 0;
const assert = new Proxy(assertRaw, {
  get(target, key) {
    const value = target[key];
    if (typeof value !== "function") return value;
    return (...args) => {
      __asserts += 1;
      return value.apply(target, args);
    };
  },
});
const path = require("node:path");
const { readFileSync, existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
require(path.join(ROOT, "web", "ziwei-facts.js"));
require(path.join(ROOT, "web", "annual-timeline.js"));

const Timeline = globalThis.MingliAnnualTimeline;
const unavailableZiwei = { status: "unavailable", months: [], reason: "夹具：紫微不可用" };
const html = readFileSync(path.join(ROOT, "web", "index.html"), "utf8");
const appJs = readFileSync(path.join(ROOT, "web", "app.js"), "utf8");


// 既有 20/6 主题报告结构的 sha256（只允许在明确要改版时更新）
// 2026-11-05：主题标题改成人话（「八字基础结构」→「你是什么底子」等），属于有意改版。
const EXPECTED_REPORT_STRUCTURE_DIGEST = "3a8382db43664ae4bd8b0f78f5ccd951fb4f27d3498fbbf8983a8694e1d5b04c";

// 把所有引号内的内容替换成等长空格（只用于定位，不用于取值）
function blankQuotedContents(source) {
  let result = "";
  let quote = null;
  let inTag = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
        result += ch;
      } else {
        result += " ";
      }
      continue;
    }
    if (inTag) {
      if (ch === '"' || ch === "'") {
        quote = ch;
        result += ch;
        continue;
      }
      if (ch === ">") inTag = false;
      result += ch;
      continue;
    }
    // 只有标签内部才把引号当定界符：正文里的撇号（如 it's）不该遮蔽后续标签
    if (ch === "<") inTag = true;
    result += ch;
  }
  return result;
}

// 扫描出所有 <script ...> 的属性字符串（引号内的 > 不当作标签结束）
// RCDATA 元素内部再出现同名标签只是文本（浏览器不嵌套），
// 其余（template 等）才需要按深度配对
const RAW_TEXT_ELEMENTS = [
  { tag: "textarea", nested: false },
  { tag: "title", nested: false },
  { tag: "template", nested: true },
  { tag: "noscript", nested: false },
  { tag: "xmp", nested: false },
  { tag: "iframe", nested: false },
  { tag: "style", nested: false },
];

// 把 raw-text 元素的内部内容挖掉（替换成等长空白，保持偏移不变），
// 这些位置里的 <script> 只是文本，浏览器不会执行
// 单遍扫描：按浏览器的"元素上下文"从左到右推进，不做预处理。
//
// 为什么不用"先挖空 raw-text、再找 script"：脚本正文里出现 "<textarea>" 这样的字符串时，
// 预处理会把后面的真实 <script> 一起当成文本吞掉，于是"多出来的 async 脚本"就被漏掉了。
// 单遍状态机在遇到 <script 时立刻消费到 </script，之后才继续，天然没有这个顺序问题。
//
// 覆盖的语义：
//   - 注释 <!-- --> 里的内容不算标签
//   - 属性值里的 ">" / "<script" 不算标签（引号内不解析）
//   - script 元素的文本内容不解析（跳过到 </script）
//   - textarea/title 等 RCDATA、template 等 raw-text 元素的内容不解析
//   - 标签名大小写不敏感、必须有名字边界
// 逐条检查的骨架：断言计数、AC 编号登记、失败即抛
// 页面里 script 标签的完整清单（顺序敏感）。改页面引入时必须同步这里。
const EXPECTED_SCRIPT_TAGS = [
  "<script src=\"/vendor/iztro-v2.6.2.min.js\" defer>",
  "<script src=\"/vendor/renhuai-patterns.js\" defer>",
  "<script src=\"/ziwei-facts.js?v=20261105-1\" defer>",
  "<script src=\"/annual-timeline.js?v=20261105-1\" defer>",
  "<script src=\"/ziwei-adapter.js?v=20261105-1\" defer>",
  "<script src=\"/ziwei-interpretation.js?v=20261105-1\" defer>",
  "<script src=\"/ziwei-knowledge-digest.js?v=20261105-1\" defer>",
  "<script src=\"/bazi-knowledge.js?v=20261105-1\" defer>",
  "<script src=\"/interpretation.js?v=20261105-1\" defer>",
  "<script src=\"/report-structure.js?v=20261105-2\" defer>",
  "<script src=\"/ai-contract.js?v=20261105-1\" defer>",
  "<script src=\"/ai-interpretation.js?v=20261105-3\" defer>",
  "<script src=\"/report-archive.js?v=20261105-1\" defer>",
  "<script src=\"/overview.js?v=20261105-9\" defer>",
  "<script src=\"/home.js?v=20261105-1\" defer>",
  "<script src=\"/date-input.js?v=20261105-1\" defer>",
  "<script src=\"/report-image.js?v=20261107-2\" defer>",
  "<script src=\"/report-export.js?v=20261107-1\" defer>",
  "<script src=\"/app.js?v=20261109-1\" defer>",
];

let passed = 0;
const emittedAcs = new Set();
function check(label, fn) {
  const before = __asserts;
  const ac = label.match(/^AC(\d+)/);
  if (ac) emittedAcs.add(`AC${ac[1].padStart(2, "0")}`);
  fn();
  if (__asserts === before) {
    // 没有任何断言就宣布通过 = 假绿
    throw new Error(`用例「${label}」没有执行任何断言`);
  }
  passed += 1;
  console.log(`  PASS ${label}`);
}

// 把标签里的属性解析成 {name: value}（布尔属性的值为 ""）。
// 关键点：引号内的空格与等号不算分隔符，所以 data-note=" src='/x'" 只有一个属性。
function parseAttributes(text) {
  const result = {};
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (i >= text.length) break;
    let name = "";
    while (i < text.length && !/[\s=]/.test(text[i])) {
      name += text[i];
      i += 1;
    }
    while (i < text.length && /\s/.test(text[i])) i += 1;
    let value = "";
    if (text[i] === "=") {
      i += 1;
      while (i < text.length && /\s/.test(text[i])) i += 1;
      const quote = text[i];
      if (quote === '"' || quote === "'") {
        i += 1;
        while (i < text.length && text[i] !== quote) {
          value += text[i];
          i += 1;
        }
        i += 1;
      } else {
        while (i < text.length && !/\s/.test(text[i])) {
          value += text[i];
          i += 1;
        }
      }
    }
    // 浏览器对重复属性保留**先出现**的那个
    if (name && !(name.toLowerCase() in result)) result[name.toLowerCase()] = value;
  }
  return result;
}

function extractScriptTags(source) {
  const lower = source.toLowerCase();
  const tags = [];
  let i = 0;
  const RCDATA = new Set(["textarea", "title"]);
  const RAW_TEXT = new Set(["template", "noscript", "xmp", "iframe", "style"]);

  // 读一个标签：返回 { name, attrsText, end }（end 指向 '>' 之后）
  function readTag(from) {
    let j = from + 1;
    let name = "";
    while (j < source.length && /[A-Za-z0-9-]/.test(source[j])) {
      name += source[j];
      j += 1;
    }
    let attrs = "";
    let quote = null;
    for (; j < source.length; j += 1) {
      const ch = source[j];
      if (quote) {
        attrs += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        attrs += ch;
        continue;
      }
      if (ch === ">") return { name: name.toLowerCase(), attrsText: attrs.trim(), end: j + 1 };
      attrs += ch;
    }
    return { name: name.toLowerCase(), attrsText: attrs.trim(), end: source.length };
  }

  // 从 from 找到同名结束标签（大小写不敏感，要求名字边界）
  function findClose(tagName, from) {
    const needle = `</${tagName}`;
    let at = lower.indexOf(needle, from);
    while (at >= 0) {
      const after = lower[at + needle.length] || " ";
      if (/[\s>]/.test(after)) return at;
      at = lower.indexOf(needle, at + needle.length);
    }
    return -1;
  }

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt < 0) break;

    if (source.startsWith("<!--", lt)) {
      const close = source.indexOf("-->", lt + 4);
      i = close < 0 ? source.length : close + 3;
      continue;
    }

    const tag = readTag(lt);
    if (!tag.name) {
      i = lt + 1;
      continue;
    }

    if (tag.name === "script") {
      tags.push({ attrsText: tag.attrsText, raw: `<script ${tag.attrsText}>` });
      const close = findClose("script", tag.end);
      i = close < 0 ? source.length : close + "</script".length;
      continue;
    }

    if (tag.name === "plaintext") {
      // plaintext 之后浏览器不再解析任何标签，脚本也都不会执行
      break;
    }

    if (RCDATA.has(tag.name) || RAW_TEXT.has(tag.name)) {
      // 内容不解析：直接跳到该元素的结束标签
      let close = findClose(tag.name, tag.end);
      if (close < 0) break;
      if (RAW_TEXT.has(tag.name) && tag.name === "template") {
        // template 可以嵌套：按深度配对
        let depth = 1;
        let scan = tag.end;
        while (depth > 0) {
          const nextOpen = lower.indexOf("<template", scan);
          const nextClose = findClose("template", scan);
          if (nextClose < 0) break;
          if (nextOpen >= 0 && nextOpen < nextClose) {
            depth += 1;
            scan = nextOpen + "<template".length;
            continue;
          }
          depth -= 1;
          close = nextClose;
          scan = nextClose + "</template".length;
        }
      }
      i = close + (tag.name === "template" ? "</template".length : `</${tag.name}`.length);
      continue;
    }

    i = tag.end;
  }

  return tags.map((entry) => entry.attrsText ? entry.attrsText : "");
}

// ---------------------------------------------------------------- AC5
// ---------------------------------------------------------------- 夹具
const MONTH_LABELS = [
  "正月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "冬月", "腊月",
];

// 12 个首尾相接的流月；边界值与真实历法无关，只用来验证装配契约
function baziMonthlyFixture(year = 2026) {
  const pad = (n) => String(n).padStart(2, "0");
  const months = [];
  for (let i = 0; i < 12; i += 1) {
    const startDay = i * 30 + 1;
    const endDay = (i + 1) * 30 + 1;
    // 用真日历推进：硬把月份夹到 12 会造出 2026-02-30 这种不存在的日期
    const stamp = (dayIndex) => {
      const cursor = new Date(Date.UTC(year, 0, 1));
      cursor.setUTCDate(cursor.getUTCDate() + dayIndex);
      return `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(
        cursor.getUTCDate(),
      )}T00:00:00+08:00`;
    };
    months.push({
      index: i + 1,
      label: MONTH_LABELS[i],
      gan: "甲乙丙丁戊己庚辛壬癸"[i % 10],
      zhi: "寅卯辰巳午未申酉戌亥子丑"[i],
      ganzhi: "甲乙丙丁戊己庚辛壬癸"[i % 10] + "寅卯辰巳午未申酉戌亥子丑"[i],
      jie: "节气" + (i + 1),
      start: stamp(startDay),
      end: stamp(endDay),
      start_utc_offset: "+08:00",
      duration_days: 30,
      boundary_source: "solar_term_apparent_longitude",
      evidence_id: `monthly.months[${i}].coordinate`,
      json_pointer: `/months/${i}`,
      status: "ok",
      luck: {
        status: "ok",
        ganzhi: "甲子",
        from: `${year}-01-01T00:00:00+08:00`,
        to: `${year}-12-31T00:00:00+08:00`,
      },
      relations: [],
      relation_count: 0,
      relation_scope: {
        computed_layers: ["natal", "annual", "monthly"],
        omitted_layers: ["luck"],
        reason: "夹具不提供大运",
        boundaries: [],
        segments: 0,
      },
    });
  }
  return {
    schema_version: "1.1",
    system: "bazi",
    scope: "monthly",
    target_year: year,
    status: "ok",
    annual: { year, gan: "丙", zhi: "午", ganzhi: "丙午" },
    coordinate: {
      year_boundary: "exact_lichun",
      month_boundary: "twelve_jie",
      timezone: "UTC+08:00",
      interval: "half_open[start,end)",
      engine: "fixture",
    },
    months,
    half_years: {
      first_half: {
        months: [1, 2, 3, 4, 5, 6],
        start: months[0].start,
        end: months[5].end,
        first_ganzhi: months[0].ganzhi,
        last_ganzhi: months[5].ganzhi,
        evidence_ids: months.slice(0, 6).map((m) => m.evidence_id),
      },
      second_half: {
        months: [7, 8, 9, 10, 11, 12],
        start: months[6].start,
        end: months[11].end,
        first_ganzhi: months[6].ganzhi,
        last_ganzhi: months[11].ganzhi,
        evidence_ids: months.slice(6).map((m) => m.evidence_id),
      },
    },
    fingerprint: "mf-fixture",
    validation: { status: "pass", checks: [] },
  };
}

function buildPackage(options = {}) {
  const targetYear = options.targetYear ?? 2026;
  return Timeline.build({
    baziMonthly: options.baziMonthly ?? baziMonthlyFixture(targetYear),
    ziweiMonthly: options.ziweiMonthly ?? unavailableZiwei,
    targetYear,
    ...(options.ziweiBlockedReason !== undefined
      ? { ziweiBlockedReason: options.ziweiBlockedReason }
      : {}),
  });
}

console.log("\n--- AC5 引擎校验未通过的紫微字段不得标成 validated ---");
check("AC5 三种引擎校验分别失败时，各自对应的字段都降级", () => {
  // 只验 fourTransformations 一种的话，宫位/流曜两条校验失败时字段仍被标 validated 也发现不了
  const cases = [
    ["monthly_four_hua_complete", "fourTransformations"],
    ["monthly_twelve_palaces_unique", "palaceOverlay"],
    ["monthly_transit_stars_valid", "transitStars"],
  ];
  cases.forEach(([checkId, fieldName]) => {
    const bazi = baziMonthlyFixture(2026);
    const ziwei = okZiweiMonths(bazi);
    const target = ziwei.months[0];
    target.validation.checks = target.validation.checks.map((item) =>
      item.id === checkId ? { ...item, pass: false } : item
    );
    // 故意保留总体状态为 pass：实现必须真的逐项看 checks，
    // 只根据 validationStatus 降级的实现会在这里露馅
    target.validationStatus = "pass";
    target.validation.status = "pass";
    target[fieldName] = { status: "validated", value: [{ fake: true }], reason: null, source: "iztro" };
    target.fieldStatuses = { ...target.fieldStatuses, [fieldName]: "validated" };

    const built = Timeline.build({ baziMonthly: bazi, ziweiMonthly: ziwei, targetYear: 2026 });
    const field = built.months[0].ziwei[fieldName];
    assert.notStrictEqual(
      field.status, "validated",
      `${checkId} 失败时 ${fieldName} 不能标 validated`,
    );
    assert.strictEqual(field.value, null, `${checkId} 失败时 ${fieldName} 不能输出值`);
    assert.ok(field.reason, `${checkId} 失败时 ${fieldName} 要给出降级原因`);
  });
});

check("AC5 校验失败的字段降级且不进入有效事实", () => {
  const bazi = baziMonthlyFixture(2026);
  const ziwei = okZiweiMonths(bazi);
  // 伪造一个"自述 validated、但引擎校验说失败"的字段
  const target = ziwei.months[0];
  target.validation.checks = target.validation.checks.map((item) =>
    item.id === "monthly_four_hua_complete" ? { ...item, pass: false } : item
  );
  target.validationStatus = "fail";
  target.validation.status = "fail";
  target.fourTransformations = {
    status: "validated",
    value: [{ kind: "化禄", star: "天机" }],
    reason: null,
    source: "iztro"
  };
  target.fieldStatuses = { ...target.fieldStatuses, fourTransformations: "validated" };

  const built = Timeline.build({ baziMonthly: bazi, ziweiMonthly: ziwei, targetYear: 2026 });
  const month = built.months[0];
  const field = month.ziwei.fourTransformations;
  assert.notStrictEqual(field.status, "validated", "校验失败的字段不能被标成 validated");
  assert.strictEqual(field.value, null, "校验失败的字段不能输出值");
  assert.ok(field.reason, "应给出降级原因");
  // 该字段也不得进入有效事实白名单
  assert.notStrictEqual(month.ziwei.fieldStatuses?.fourTransformations, "validated");
  const view = Timeline.buildMonthlyView(built);
  const whitelisted = view[0].ziweiDetails?.fourTransformations || [];
  assert.strictEqual(whitelisted.length, 0, "校验失败的字段不应出现在页面的四化明细里");
});

// ---------------------------------------------------------------- AC8
console.log("\n--- AC8 脚本引入顺序 ---");
check("AC8 annual-timeline.js 的 defer 引入在 ziwei-facts.js 之后、app.js 之前", () => {
  // 只用真正的 <script src="..."> 标签，不看全文 indexOf：
  // 注释里出现 /ziwei-facts.js 也能骗过顺序检查
  // 注释里的 <script> 不会被执行：先剥掉 HTML 注释再解析
  // 不能先全局剥注释：脚本正文里的 <!-- 会被误配对，把后面的真实脚本一起删掉。
  // 注释由 extractScriptTags 的状态机在原地跳过。
  const liveHtml = html;
  // 自己扫标签：`[^>]*` 会在引号内的 `>` 处截断，"a > b" 这种属性值会被切坏
  const scripts = extractScriptTags(liveHtml).map((attrs) => {
    // 真正的属性分词：按空白切，遇到引号内的内容不算分隔。
    // 正则版会把 data-note=" src='/x.js'" 里的 src 当成脚本地址。
    const parsed = parseAttributes(attrs);
    return {
      src: parsed.src || null,
      types: parsed.type,
      raw: `<script ${attrs.trim()}>`,
      attrs: Object.keys(parsed),
    };
  }).filter((entry) => entry.src);

  const order = scripts.map((entry) => entry.src);
  // app.js 带查询串（/app.js?v=...），用 startsWith 而不是 endsWith
  // 精确匹配路径：/missing/annual-timeline.js 不是 /annual-timeline.js
  const indexOf = (needle) => order.findIndex((src) => src.split("?")[0] === needle);
  const ziweiPos = indexOf("/ziwei-facts.js");
  const timelinePos = indexOf("/annual-timeline.js");
  const appPos = indexOf("/app.js");

  assert.notStrictEqual(ziweiPos, -1, "index.html 缺 ziwei-facts.js 的 script 标签");
  assert.notStrictEqual(timelinePos, -1, "index.html 缺 annual-timeline.js 的 script 标签");
  assert.notStrictEqual(appPos, -1, "index.html 缺 app.js 的 script 标签");
  assert.ok(ziweiPos < timelinePos, "ziwei-facts.js 必须在 annual-timeline.js 之前");
  assert.ok(timelinePos < appPos, "annual-timeline.js 必须在 app.js 之前");
  // 三个脚本都要 defer：有一个同步执行就会在依赖脚本之前跑
  [["ziwei-facts.js", ziweiPos], ["annual-timeline.js", timelinePos], ["app.js", appPos]]
    .forEach(([label, position]) => {
      assert.ok(
        scripts[position].attrs.includes("defer"),
        `${label} 应带独立的 defer 属性`,
      );
      // async 会覆盖 defer 的顺序保证：带 async 的脚本随时可能先跑
      assert.ok(
        !scripts[position].attrs.includes("async"),
        `${label} 不能同时带 async，否则执行顺序不受控`,
      );
      // type 必须三个一致：module 与普通 defer 混用时，
      // 模块的求值时机与经典脚本不同，顺序保证会失效
      // 同一个脚本只允许一个标签：后面再偷偷引一次 async 版本也能绕过顺序检查
      const occurrences = scripts.filter((entry) => entry.src.split("?")[0].endsWith(`/${label}`)
        || entry.src.split("?")[0].endsWith(label));
      assert.strictEqual(
        occurrences.length, 1,
        `${label} 被引入了 ${occurrences.length} 次，只允许一次`,
      );
      occurrences.forEach((entry) => {
        assert.ok(!entry.attrs.includes("async"), `${label} 的标签里出现了 async`);
        // nomodule：现代浏览器会跳过这些经典脚本，时间轴根本不会加载
        assert.ok(!entry.attrs.includes("nomodule"), `${label} 的标签里出现了 nomodule`);
        const typeAttr = entry.types;
        assert.ok(
          !typeAttr || typeAttr === "text/javascript" || typeAttr === "module",
          `${label} 的 script type 是 ${typeAttr}，浏览器不会当 JavaScript 执行`,
        );
      });
    });

  const types = [ziweiPos, timelinePos, appPos].map(
    (position) => scripts[position].types || "classic",
  );
  assert.strictEqual(
    new Set(types).size, 1,
    `三个脚本的 type 不一致（${types.join(" / ")}），执行顺序不再可靠`,
  );

  // 最后一道闸：整个页面的 script 标签必须**精确等于**这份清单。
  // 扫描器只要有盲区（把真标签藏进文本、漏掉重复引入、把假标签当真），
  // 提取结果就会与期望不符而立刻失败——不依赖"解析得足够聪明"。
  //
  // 注：曾试过"数原文里 <script 的字面出现次数"这种更保守的闸，但它会把
  // 注释/文案里的 `<script` 也算进去（合法的说明文字会让它误报），已撤掉。
  // 不依赖解析器的兜底闸：把登记的 12 条标签原样从 HTML 里扣掉，
  // 剩下的文本里**一个 `<script` 都不许有**。
  // 任何额外/隐藏/伪装的脚本引入（注释、字符串、属性值、plaintext、嵌套 template…）
  // 都会在这里留下痕迹；它不依赖扫描器解析得对不对。
  let residue = liveHtml;
  // 每条登记标签只删除**第一处**：用 split/join 会把隐藏的同名副本一起删掉，
  // 那样"再放一份一模一样的标签"就留不下痕迹了。
  EXPECTED_SCRIPT_TAGS.forEach((tag) => {
    const full = `${tag}</script>`;
    const at = residue.indexOf(full);
    assert.ok(at >= 0, `找不到登记的标签：${tag}`);
    residue = residue.slice(0, at) + residue.slice(at + full.length);
  });
  // 注释里提到 `<script>` 是无害的（浏览器不执行）；隐藏的同名副本已在
  // "只删第一处"那一步留下痕迹，所以这里可以先剥注释再查。
  const residueNoComments = residue.replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(
    !/<script/i.test(residueNoComments),
    "扣除登记标签后仍残留 script 引入：" + JSON.stringify(residueNoComments.match(/.{0,40}<script.{0,40}/i) || ""),
  );

  const extracted = scripts.map((entry) => entry.raw);
  const normalize = (tag) => tag.replace(/\s+/g, " ").replace(/>\s*$/, ">").trim();
  assert.deepStrictEqual(
    extracted.map(normalize), EXPECTED_SCRIPT_TAGS.map(normalize),
    `页面的 script 标签清单与登记的不一致（多、少或被隐藏）：实际 ${JSON.stringify(extracted)}`,
  );
});

// ---------------------------------------------------------------- AC9
console.log("\n--- AC9 组装输入与 12 条月份记录 ---");
check("AC9 组装器真的使用传入的 targetYear（不是写死 2026）", () => {
  const bazi = baziMonthlyFixture(2026);
  const pkg = Timeline.build({
    baziMonthly: bazi,
    ziweiMonthly: { status: "unavailable", months: [] },
    targetYear: 2033,
  });
  assert.strictEqual(pkg.year, 2033, "组装器没有使用传入的 targetYear");
});

check("AC9 组装器收到 monthly_facts.target_year 并产出 12 条记录", () => {
  const pkg = buildPackage();
  assert.strictEqual(pkg.months.length, 12);
  assert.deepStrictEqual(pkg.months.map((m) => m.index), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});
check("AC9 每条记录含节气起止、干支、关系条数与大运字段", () => {
  const bazi = baziMonthlyFixture(2026);
  const pkg = Timeline.build({
    baziMonthly: bazi,
    ziweiMonthly: unavailableZiwei,
    targetYear: 2026
  });
  // 明细在 month 对象上；展示层由 buildMonthlyView 展开
  pkg.months.forEach((month, i) => {
    const source = bazi.months[i];
    assert.ok(month.coordinate, `第 ${i + 1} 月缺 coordinate`);
    assert.strictEqual(month.coordinate.start, source.start);
    assert.strictEqual(month.coordinate.end, source.end);
    assert.strictEqual(month.coordinate.jie, source.jie);
    assert.strictEqual(month.bazi.ganzhi, source.ganzhi);
    assert.strictEqual(month.bazi.relationCount, source.relation_count);
    assert.ok(month.bazi.luck, `第 ${i + 1} 月缺大运字段`);
    assert.strictEqual(month.bazi.luck.status, "ok");
  });
  const view = Timeline.buildMonthlyView(pkg);
  assert.strictEqual(view.length, 12);
  assert.ok(view[0].span.includes("节气1"), view[0].span);
  assert.ok(view[0].facts.includes("关系 0 条"), view[0].facts);
});

// ---------------------------------------------------------------- AC10
console.log("\n--- AC10 三处指纹可读 ---");
check("AC10 声明指纹、复算指纹与 match 标记都能从包内读到", () => {
  const pkg = buildPackage();
  assert.ok(pkg.fingerprints, "缺 fingerprints");
  assert.strictEqual(pkg.fingerprints.declared, "mf-fixture");
  assert.ok(typeof pkg.fingerprints.recomputed === "string" && pkg.fingerprints.recomputed.length > 0);
  assert.strictEqual(typeof pkg.fingerprints.matches, "boolean");
  assert.ok(typeof pkg.fingerprint === "string" && pkg.fingerprint.length > 0, "缺包指纹");

  // matches 必须真的等于 declared === recomputed，而且**两个分支都要覆盖**。
  // declared 取 baziMonthly.fingerprint，recomputed 由 months 现算——
  // 所以先跑一次拿到 recomputed，再把它写回 fingerprint，才能造出"相等"的样本。
  const probe = buildPackage();
  const fixture = baziMonthlyFixture();
  fixture.fingerprint = probe.fingerprints.recomputed;
  const matchedPkg = Timeline.build({
    baziMonthly: fixture,
    ziweiMonthly: { status: "unavailable", months: [] },
    targetYear: fixture.target_year,
  });
  assert.strictEqual(
    matchedPkg.fingerprints.declared,
    matchedPkg.fingerprints.recomputed,
    "前置：构造包的两个指纹应相等",
  );
  assert.strictEqual(matchedPkg.fingerprints.matches, true, "两指纹相等时 matches 必须是 true");

  const okPkg = buildPackage();
  assert.strictEqual(
    okPkg.fingerprints.matches,
    okPkg.fingerprints.declared === okPkg.fingerprints.recomputed,
    "正常包的 matches 与两者是否相等不一致",
  );
  // 篡改要作用在**月度事实输入**上：拿装配好的包当输入，改的是包指纹，
  // 根本走不到"声明指纹与复算指纹比对"那条路径
  const broken = baziMonthlyFixture(2026);
  broken.fingerprint = "mf-00000000";
  const brokenBuilt = Timeline.build({
    baziMonthly: broken,
    ziweiMonthly: unavailableZiwei,
    targetYear: 2026,
  });
  assert.notStrictEqual(
    brokenBuilt.fingerprints.declared,
    brokenBuilt.fingerprints.recomputed,
    "篡改包的两个指纹应不相等",
  );
  assert.strictEqual(brokenBuilt.fingerprints.matches, false, "篡改包的 matches 必须是 false");
});

check("AC10 边界被改动时复算指纹与声明值不一致", () => {
  const bazi = baziMonthlyFixture(2026);
  const pkg = Timeline.build({ baziMonthly: bazi, ziweiMonthly: unavailableZiwei, targetYear: 2026 });
  bazi.months[3].start = "2026-01-01T00:00:00+08:00";
  const tampered = Timeline.build({ baziMonthly: bazi, ziweiMonthly: unavailableZiwei, targetYear: 2026 });
  assert.notStrictEqual(tampered.fingerprints.recomputed, pkg.fingerprints.recomputed);
});

// ---------------------------------------------------------------- AC11
console.log("\n--- AC11 未知时辰不建紫微流月 ---");
check("AC11 未知时辰时 monthlyZiweiPlan 明确不允许建盘", () => {
  const plan = Timeline.monthlyZiweiPlan({ status: "unavailable" });
  assert.strictEqual(plan.shouldBuild, false);
  assert.ok(plan.note && plan.note.length > 0, "应给出不建盘的原因");
});
check("AC11 app.js 只在 shouldBuild 为真时调用 buildMonthlyTiming", () => {
  const gate = appJs.indexOf("if (ziweiPlan.shouldBuild)");
  assert.ok(gate > 0, "找不到 shouldBuild 门");
  const occurrences = [...appJs.matchAll(/buildMonthlyTiming\s*\(/g)].map((m) => m.index);
  assert.strictEqual(occurrences.length, 1, `buildMonthlyTiming 应只有一处调用，实际 ${occurrences.length} 处`);

  // 只比文本先后不够：条件块结束后无条件调用同样会「在上面之后」。
  // 这里做花括号配对，证明调用点确实落在 if 的语句块内部。
  const open = appJs.indexOf("{", appJs.indexOf(")", gate) >= 0 ? appJs.indexOf(")", gate) : gate);
  assert.ok(open > gate, "找不到 if 语句块起始花括号");
  let depth = 0;
  let close = -1;
  for (let i = open; i < appJs.length; i += 1) {
    const ch = appJs[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) { close = i; break; }
    }
  }
  assert.ok(close > open, "if 语句块没有闭合");
  assert.ok(
    occurrences[0] > open && occurrences[0] < close,
    `buildMonthlyTiming 不在 if 语句块内（块范围 ${open}..${close}，调用点 ${occurrences[0]}）`
  );
});
check("AC11 12 个月紫微状态为 unavailable 且原因非空", () => {
  const blockedReason = "未知时辰，未建立紫微盘";
  const pkg = buildPackage({
    ziweiMonthly: { status: "unavailable", months: [] },
    ziweiBlockedReason: blockedReason,
  });
  assert.strictEqual(pkg.months.length, 12);
  pkg.months.forEach((month) => {
    assert.strictEqual(month.ziwei.status, "unavailable", `第 ${month.index} 月状态不对`);
    // 原因必须是传进去的那句话：实现换成无关的通用原因就该失败
    assert.ok(
      month.ziwei.reason && month.ziwei.reason.includes(blockedReason),
      `第 ${month.index} 月的原因没有带上未知时辰说明：${month.ziwei.reason}`,
    );
  });
  const view = Timeline.buildMonthlyView(pkg);
  view.forEach((row) => {
    assert.strictEqual(row.ziweiDetails, null);
    assert.ok(row.ziwei.length > 0);
  });
});

// ---------------------------------------------------------------- AC12
console.log("\n--- AC12 四态展示 ---");
check("AC12 unavailable/failed/unverifiable 显示对应状态与非空原因", () => {
  ["unavailable", "failed", "unverifiable"].forEach((state) => {
    const built = Timeline.build({
      baziMonthly: baziMonthlyFixture(2026),
      ziweiMonthly: {
        status: state,
        months: [{ index: 1, status: state, reason: `fixture-${state}` }]
      },
      targetYear: 2026,
      ziweiBlockedReason: `blocked-${state}`
    });
    // 输入里给了该月的状态 → 原样透传，并带原因
    const first = built.months[0].ziwei;
    assert.strictEqual(first.status, state, `第 1 月应透传 ${state}`);
    assert.ok(first.reason && first.reason.length > 0, `第 1 月缺原因`);
    // 输入里没有的月份 → unavailable，且原因不能是空串
    built.months.slice(1).forEach((month) => {
      assert.strictEqual(month.ziwei.status, "unavailable", `第 ${month.index} 月应为 unavailable`);
      assert.ok(month.ziwei.reason && month.ziwei.reason.length > 0, `第 ${month.index} 月缺原因`);
    });
    const view = Timeline.buildMonthlyView(built);
    // 展示文字必须带上**具体状态**和**原因**：三个状态都显示同一句"紫微不可用"、
    // 或者把原因吞掉，都不算四态展示
    // 文案取自产品自己的状态词表，避免测试与实现各写一套
    const statusText = Timeline.ziweiStatusText[state];
    assert.ok(statusText, `产品没有为状态 ${state} 定义展示文案`);
    // 三种状态必须能区分：都映射成同一句话就不算四态展示
    const allTexts = ["ok", "unavailable", "failed", "unverifiable"].map(
      (key) => Timeline.ziweiStatusText[key],
    );
    assert.strictEqual(
      new Set(allTexts).size, 4,
      `四态文案有重复：${allTexts.join(" / ")}`,
    );
    view.forEach((row) => {
      assert.strictEqual(row.ziweiDetails, null, "非 ok 月份不应有四态明细");
      assert.ok(row.ziwei.includes("紫微"), row.ziwei);
      // 只有输入里给了状态的那个月带该状态文案；其余月份是 unavailable
      const expectedText = row.index === 1 ? statusText : Timeline.ziweiStatusText.unavailable;
      assert.ok(
        row.ziwei.includes(expectedText),
        `第 ${row.index} 月的展示里没有预期文案（${expectedText}）：${row.ziwei}`,
      );
      // 原因必须是**输入里的原文**：拿装配结果自己比自己，实现把具体原因
      // 换成通用说明也照样通过
      const expectedReason = row.index === 1
        ? `fixture-${state}`
        : `blocked-${state}`;
      assert.ok(
        row.ziwei.includes(expectedReason),
        `第 ${row.index} 月的展示里没有输入给出的原因（${expectedReason}）：${row.ziwei}`,
      );
    });
  });
});
// 造一份「坐标对齐 + 引擎校验通过 + 取样日期属于本月」的紫微流月：
// 四条同时成立，装配层才会把字段当成有效事实。
function okZiweiMonths(bazi) {
  const specs = Timeline.monthSpecsFrom(bazi);
  const built = specs.map((spec) => ({
      index: spec.index,
      status: "ok",
      reason: null,
      coordinateAligned: true,
      segments: [{
        index: 1,
        from: spec.startDate,
        to: spec.endDate,
        days: Math.round(
          (Date.UTC(...spec.endDate.split("-").map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))))
            - Date.UTC(...spec.startDate.split("-").map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))))) / 86400000,
        ) + 1,
        verified: true,
        isDominant: true,
      }],
      segmentCount: 1,
      coverage: "full",
      validation: {
        status: "pass",
        checks: [
          { id: "monthly_twelve_palaces_unique", pass: true },
          { id: "monthly_four_hua_complete", pass: true },
          { id: "monthly_transit_stars_valid", pass: true }
        ],
        hardFailures: []
      },
      validationStatus: "pass",
      sampleDates: { start: spec.startDate, midpoint: spec.midpoint, end: spec.endDate },
      lunarMonth: `农历${spec.index}月`,
      ganzhi: "甲寅",
      palaceOverlay: { status: "validated", value: [{ branch: "寅" }], reason: null, source: "iztro" },
      fourTransformations: { status: "validated", value: [{ kind: "化禄", star: "天机" }], reason: null, source: "iztro" },
      transitStars: { status: "validated", value: [{ name: "文昌" }], reason: null, source: "iztro" },
      fieldStatuses: {
        palaceOverlay: "validated",
        fourTransformations: "validated",
        transitStars: "validated"
      }
    }));
  // 单段整月：段级 envelope 与月级同源，装配层会按主段复核顶层字段
  built.forEach((month) => {
    month.segments.forEach((seg) => {
      seg.palaceOverlay = month.palaceOverlay;
      seg.fourTransformations = month.fourTransformations;
      seg.transitStars = month.transitStars;
    });
  });
  return { status: "ok", months: built };
}

check("AC12 ok 月份才携带四态事实", () => {
  const bazi = baziMonthlyFixture(2026);
  const built = Timeline.build({
    baziMonthly: bazi,
    ziweiMonthly: okZiweiMonths(bazi),
    targetYear: 2026
  });
  const first = built.months[0].ziwei;
  assert.strictEqual(first.status, "ok", `第一个月未通过装配校验：${first.reason}`);
  assert.ok(Array.isArray(first.fourTransformations?.value));
  assert.ok(Array.isArray(first.transitStars?.value));
  assert.ok(Array.isArray(first.palaceOverlay?.value));
  const view = Timeline.buildMonthlyView(built);
  assert.ok(view[0].ziweiDetails, "ok 月份应渲染四态明细");
  assert.ok(view[0].ziwei.includes("紫微：可用"), view[0].ziwei);
});

// ---------------------------------------------------------------- AC13
console.log("\n--- AC13 不触碰既有报告 ---");
check("AC13 行为已由 DOM 执行测试覆盖（执行式证明）", () => {
  // 静态文本分析追不住 const node = reportContent 这类间接写入，
  // 真正的证明在 annual_timeline_dom.test.cjs：它注入只有时间轴节点的假 DOM，
  // 直接执行 renderAnnualTimelineUnsafe / clearAnnualTimeline 并检查节点。
  // 真的把它跑一遍：只检查文件里有这些字符串，放注释里也能过
  const output = execFileSync(
    process.execPath,
    [path.join(ROOT, "tests", "annual_timeline_dom.test.cjs")],
    { encoding: "utf8" },
  );
  assert.ok(/DOM 渲染检查 \d+ 项全部通过/.test(output), `DOM 套件没有全绿：${output.slice(-200)}`);
  ["渲染与清空都不碰既有报告容器", "渲染内部抛错时外层吞掉、清空"].forEach((label) => {
    assert.ok(output.includes(label), `DOM 套件里没有执行「${label}」`);
  });
});

check("AC13 时间轴渲染只写自己的节点，不碰既有报告容器", () => {
  // 真正的写入在 renderAnnualTimelineUnsafe；外层只是 try/catch 包装
  const block = functionBody(appJs, "renderAnnualTimelineUnsafe");

  const refs = [...block.matchAll(/\bdocument\.(?:getElementById|querySelector(?:All)?)\(\s*["'`]([^"'`]+)/g)]
    .map((m) => m[1]);
  // 除了直接查询，还可能用预取好的常量引用
  const constRefs = [...block.matchAll(/\b(annualTimeline[A-Za-z]*)\b/g)].map((m) => m[1]);
  assert.ok(refs.length + constRefs.length > 0, "渲染函数里找不到任何节点引用，匹配规则失效");

  refs.forEach((ref) => {
    assert.ok(/^#?annual-timeline|^annualTimeline/.test(ref), `渲染函数引用了非时间轴节点：${ref}`);
  });
  assert.ok(constRefs.length > 0, "应通过 annualTimeline* 常量写 DOM");

  ["report-content", "annual-report", "ai-reading", "ziwei-content"].forEach((node) => {
    assert.ok(!block.includes(`"${node}"`) && !block.includes(`'${node}'`), `不应写 ${node}`);
  });

  // 光看"查询了哪些节点"不够：函数里可能顺手对预取常量做写操作。
  // 任何 X.replaceChildren / X.innerHTML = / X.textContent = 的 X 都必须是 annualTimeline*
  const writes = [...block.matchAll(/\b([A-Za-z_$][\w$]*)\.(?:replaceChildren|append|appendChild|innerHTML|textContent|className|dataset)\b/g)]
    .map((match) => match[1]);
  const allowed = new Set(["annualTimelineSection", "annualTimelineYear", "annualTimelineSummary",
    "annualTimelineFingerprints", "annualTimelineChecks", "annualTimelineMonths", "node", "row",
    "card", "details", "list", "item", "view", "pkg", "timeline", "ziweiApi", "monthly", "specs",
    "ziweiMonthly", "diagnostics", "data", "result", "this"]);
  writes.forEach((name) => {
    assert.ok(
      /^annualTimeline/.test(name) || allowed.has(name),
      `渲染函数对非时间轴对象 ${name} 做了写操作`,
    );
  });

  // 动态查询会把写入目标藏起来：document.getElementById(someVar) 之后
  // 无论写成 node.textContent 还是别的，静态检查都追不到。
  const dynamicLookup = [...block.matchAll(/document\.(?:getElementById|querySelector(?:All)?)\(\s*([^)]*)\)/g)]
    .map((match) => match[1].trim())
    .filter((arg) => !/^["'][^"'$]*["']$/.test(arg));
  assert.deepStrictEqual(dynamicLookup, [], `渲染函数用了动态节点查询：${dynamicLookup}`);
});
check("AC13 外层包装只有 try/catch，不掺渲染逻辑", () => {
  const wrapper = functionBody(appJs, "renderAnnualTimeline");
  assert.ok(wrapper.includes("try"), "包装应有 try");
  assert.ok(wrapper.includes("catch"), "包装应有 catch");
  assert.ok(wrapper.includes("clearAnnualTimeline"), "失败时应隐藏本区块");
  assert.ok(
    !/document\./.test(wrapper),
    "包装层不应直接操作 DOM，否则出错时无法隔离"
  );
});
check("AC13 既有缓存键未被改写", () => {
  // 真正写 DOM / 可能顺手写缓存的是 Unsafe 版本，两个函数体都要扫
  const block = functionBody(appJs, "renderAnnualTimelineUnsafe")
    + "\n" + functionBody(appJs, "renderAnnualTimeline");
  ["localStorage.setItem", "sessionStorage.setItem", "cacheApi", "cacheKey"].forEach((token) => {
    assert.ok(!block.includes(token), `时间轴渲染不应触碰缓存：${token}`);
  });
});
check("AC13 清空函数只操作时间轴节点", () => {
  const block = functionBody(appJs, "clearAnnualTimeline");
  const refs = [...block.matchAll(/document\.(?:getElementById|querySelector(?:All)?)\(\s*["'`]([^"'`]+)/g)]
    .map((m) => m[1]);
  refs.forEach((ref) => {
    assert.ok(/^#?annual-timeline|^annualTimeline/.test(ref), `清空函数引用了非时间轴节点：${ref}`);
  });
});
check("AC13 既有报告主题数量仍是 20 / 6", () => {
  require(path.join(ROOT, "web", "report-structure.js"));
  const Structure = globalThis.MingliReportStructure;
  assert.ok(Structure, "未导出 MingliReportStructure");
  assert.strictEqual(Structure.topics.length, 20, "20 主题主报告被改动");
  assert.strictEqual(Structure.annualTopics.length, 6, "6 主题年度报告被改动");
  assert.strictEqual(Structure.baziTopics.length + Structure.ziweiTopics.length, 20);

  // 数量对不代表内容没被换掉：把主题名钉死
  assert.deepStrictEqual(
    Structure.topics.map((topic) => topic.id),
    ["bazi-foundation", "bazi-strength", "bazi-pattern", "bazi-useful",
     "bazi-climate", "bazi-relations", "bazi-cycles",
     "overview", "personality", "love", "career", "wealth", "health", "family",
     "children", "move", "friends", "home", "spirit", "parents"],
    "20 主题的 id 列表被改动",
  );
  assert.deepStrictEqual(
    Structure.annualTopics.map((topic) => topic.id),
    ["annual-overview", "annual-career", "annual-relationship", "annual-wealth",
     "annual-wellbeing", "annual-home"],
    "6 主题年度报告的 id 列表被改动",
  );

  // id 没变但标题/方法/反思问题被改也是"改动既有报告"：
  // 用整体摘要钉住，任何字段变化都会让摘要变。
  const digest = require("node:crypto")
    .createHash("sha256")
    .update(JSON.stringify({
      topics: Structure.topics,
      annualTopics: Structure.annualTopics,
      baziTopics: Structure.baziTopics,
      ziweiTopics: Structure.ziweiTopics,
    }))
    .digest("hex");
  assert.strictEqual(
    digest, EXPECTED_REPORT_STRUCTURE_DIGEST,
    "既有 20/6 主题报告的结构被改动（标题、方法或反思问题变了）",
  );
});

// ---------------------------------------------------------------- AC14
console.log("\n--- AC14 提交失败/新提交清空旧时间轴 ---");
check("AC14 清空行为已由 DOM 执行测试覆盖", () => {
  const output = execFileSync(
    process.execPath,
    [path.join(ROOT, "tests", "annual_timeline_dom.test.cjs")],
    { encoding: "utf8" },
  );
  assert.ok(output.includes("clearAnnualTimeline 真的隐藏并清空所有节点"), "DOM 套件没有执行清空用例");
  assert.ok(/项全部通过/.test(output), "DOM 套件没有全绿");
});

check("AC14 新提交开始时清空时间轴", () => {
  // 只看"函数开头 1200 字符里出现 clearAnnualTimeline()"太松：
  // 放在结束分支里、甚至放到函数外面都能过。这里取出函数体，
  // 要求清空调用落在 if (loading) { … } 那个分支内。
  const body = functionBody(appJs, "setLoading");
  const startBranch = body.indexOf("if (loading)");
  assert.ok(startBranch > 0, "setLoading 里找不到 if (loading) 分支");
  const elseBranch = body.indexOf("} else {", startBranch);
  assert.ok(elseBranch > startBranch, "if (loading) 分支没有闭合到 else");
  const loadingBranch = body.slice(startBranch, elseBranch);
  const callIndex = loadingBranch.indexOf("clearAnnualTimeline()");
  assert.ok(callIndex >= 0, "新提交开始时（loading=true 分支）必须调用 clearAnnualTimeline()");
  // 调用点之前不能出现嵌套的 if/for/while：那样它可能根本不执行（例如 if (false)）
  // 跳过 "if (loading) {" 本身，只检查分支内部还有没有别的条件
  const before = loadingBranch.slice(loadingBranch.indexOf("{") + 1, callIndex);
  assert.ok(
    !/\b(if|for|while|switch)\s*\(/.test(before),
    "清空调用被包在条件分支里，不能保证新提交时真的执行",
  );
  assert.ok(
    !/\breturn\b/.test(before),
    "清空调用之前有 return，新提交时可能根本不执行",
  );
  assert.ok(
    !/\bthrow\b/.test(before),
    "清空调用之前有 throw，新提交时可能根本不执行",
  );
  const tailAfterLoading = body.slice(elseBranch);
  assert.ok(
    !tailAfterLoading.includes("clearAnnualTimeline()"),
    "清空不应写在结束分支或分支之外",
  );
});
check("AC14 失败分支清空时间轴（执行式证明）", () => {
  // 不再是"调用点后 N 个字符里出现过"这种弱断言：
  // annual_timeline_dom.test.cjs 会把提交流程 catch 的**函数体**抠出来真跑一遍，
  // 断言先清空、再渲染错误，并且错误渲染抛错时清空也已发生。
  const output = execFileSync(
    process.execPath,
    [path.join(ROOT, "tests", "annual_timeline_dom.test.cjs")],
    { encoding: "utf8" },
  );
  assert.ok(/DOM 渲染检查 \d+ 项全部通过/.test(output), `DOM 套件没有全绿：${output.slice(-200)}`);
  // 这两条用例已合并进"整段提交处理器在沙箱里执行"，改为核对新的用例名
  [
    "整段提交处理器在沙箱里执行：fetch 抛错时一定清空时间轴",
    "提交成功路径真的把数据交给年度时间轴渲染",
  ].forEach((label) => {
    assert.ok(output.includes(label), `没有执行「${label}」`);
  });
});
// 判断某个调用是不是"提交处理器顶层、无条件执行"的那条语句。
// 三条一起才够：独占一行、花括号深度 0、上一行不是控制语句。
// 从源码里取出某个具名函数的函数体（花括号配对，不用正则）
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `找不到函数 ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`${name} 的函数体没有闭合`);
}

function assertTopLevelStatement(block, statement, label) {
  const index = block.indexOf(statement);
  assert.ok(index >= 0, `提交处理器里找不到 ${label}`);
  const lineStart = block.lastIndexOf("\n", index) + 1;
  const lineEnd = block.indexOf("\n", index);
  const line = block.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
  assert.strictEqual(line, statement, `${label} 不是独占一行的语句（实际：${JSON.stringify(line)}）`);

  let nesting = 0;
  for (let i = 0; i < lineStart; i += 1) {
    if (block[i] === "{") nesting += 1;
    else if (block[i] === "}") nesting -= 1;
  }
  assert.strictEqual(nesting, 0, `${label} 不在提交处理器顶层（嵌套深度 ${nesting}）`);

  const previous = block.slice(0, lineStart).split("\n").filter((row) => row.trim()).pop() || "";
  assert.ok(
    !/^(if|for|while|else|switch)\b/.test(previous.trim()),
    `${label} 的上一行是控制语句（${JSON.stringify(previous.trim())}）`,
  );
  // 上一行还必须是一条**已结束**的语句：`skip:` 这种标签也能让调用"独占一行"，
  // 但带标签的语句可以被前置条件跳过。
  assert.ok(
    /[;{}]\s*$/.test(previous.trim()),
    `${label} 的上一行不是语句边界（${JSON.stringify(previous.trim())}），可能被标签或前置条件包住`,
  );
  return index;
}

check("AC14 提交入口确实调用 setLoading(true) 且随后发起请求", () => {
  // 在**提交处理器自己的函数体**里查，而不是在整份 app.js 里全局搜字符串：
  // 全局搜的话，把调用删掉只留一句注释也能命中。
  const handlerIndex = appJs.indexOf("async function handleSubmit(");
  assert.ok(handlerIndex > 0, "找不到 submit 事件绑定");
  const open = appJs.indexOf("{", handlerIndex);
  let depth = 0;
  let close = -1;
  for (let i = open; i < appJs.length; i += 1) {
    if (appJs[i] === "{") depth += 1;
    else if (appJs[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  assert.ok(close > open, "submit 处理器函数体没有闭合");
  // 先剥掉注释：`// setLoading(true);` 这种把调用注释掉仍能被 includes 命中
  const live = appJs
    .slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  assert.ok(live.includes("setLoading(true)"), "提交处理器里必须真的调用 setLoading(true)");
  const startCall = live.indexOf("setLoading(true)");
  // 必须在该处理器的**顶层**执行：放进 if (false) { ... } 里字符串照样在，
  // 但运行时不会跑。守卫子句（if (!validate()) return;）不改变花括号深度，所以放行。
  // 只判花括号深度不够：`if (false) setLoading(true);` 没有花括号也能绕过。
  // 要求它单独成句——整行去掉缩进后正好是 `setLoading(true);`
  const lineStart = live.lastIndexOf("\n", startCall) + 1;
  const lineEnd = live.indexOf("\n", startCall);
  const callLine = live.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
  assert.strictEqual(
    callLine, "setLoading(true);",
    `setLoading(true) 不是独占一行的语句（实际：${JSON.stringify(callLine)}），可能被条件包住`,
  );
  // 独占一行还不够：`if (false) {\n  setLoading(true);\n}` 也满足上一句。
  // 再要求它在处理器的顶层（花括号深度 0）。
  let nesting = 0;
  for (let i = 0; i < lineStart; i += 1) {
    if (live[i] === "{") nesting += 1;
    else if (live[i] === "}") nesting -= 1;
  }
  assert.strictEqual(
    nesting, 0,
    `setLoading(true) 不在提交处理器顶层（嵌套深度 ${nesting}），可能不会执行`,
  );
  // 还有一招：`if (false)\n  setLoading(true);`——没花括号、独占一行、深度 0。
  // 所以再看上一行：不能是 if/for/while/else/switch 开头。
  const previousLines = live.slice(0, lineStart).split("\n").filter((row) => row.trim());
  const previousLine = previousLines.length ? previousLines[previousLines.length - 1].trim() : "";
  assert.ok(
    !/^(if|for|while|else|switch)\b/.test(previousLine),
    `setLoading(true) 的上一行是控制语句（${JSON.stringify(previousLine)}），可能不会执行`,
  );
  const fetchIndex = live.indexOf("fetch(", startCall);
  assert.ok(fetchIndex > startCall, "setLoading(true) 之后应在同一处理器里发起 fetch");
  // 清空调用也必须是顶层无条件语句：`if (false) clearAnnualTimeline();` 不算
  const clearIndex = assertTopLevelStatement(live, "clearAnnualTimeline();", "clearAnnualTimeline()");
  // 更硬的判据：清空之前的语句只允许是事件收尾调用（preventDefault/stopPropagation），
  // 任何 if/return/throw/赋值都不能排在它前面——否则某些路径会跳过清空。
  const linesBefore = live.slice(0, clearIndex).split("\n").map((row) => row.trim()).filter(Boolean);
  const allowedPrefix = /^(\/\/|\/\*|\*|event\.(preventDefault|stopPropagation)\(\);?$)/;
  const unexpectedStatements = linesBefore.filter((row) => !allowedPrefix.test(row));
  assert.deepStrictEqual(
    unexpectedStatements, [],
    `clearAnnualTimeline() 之前还有别的语句，某些路径可能跳过清空：${unexpectedStatements}`,
  );
  // 而且要在 `if (!validate()) return;` 之前：无效的新提交同样要清掉旧年份
  const guardIndex = live.search(/if\s*\(\s*!\s*validate\(\)\s*\)/);
  if (guardIndex >= 0) {
    assert.ok(
      clearIndex >= 0 && clearIndex < guardIndex,
      "clearAnnualTimeline() 必须在 validate() 的提前返回之前调用",
    );
  }
});

check("AC14 clearAnnualTimeline 会隐藏区块并清空内容", () => {
  const start = appJs.indexOf("function clearAnnualTimeline()");
  assert.ok(start > 0);
  const block = appJs.slice(start, start + 1200);
  assert.ok(block.includes("hidden"), "应隐藏区块");
  assert.ok(/innerHTML\s*=\s*""/.test(block) || block.includes("replaceChildren"), "应清空内容");
  const dynamicClear = [...block.matchAll(/document\.(?:getElementById|querySelector(?:All)?)\(\s*([^)]*)\)/g)]
    .map((match) => match[1].trim())
    .filter((arg) => !/^["'`]/.test(arg));
  assert.deepStrictEqual(dynamicClear, [], `清空函数用了动态节点查询：${dynamicClear}`);
  const clearWrites = [...block.matchAll(/\b([A-Za-z_$][\w$]*)\.(?:replaceChildren|append|appendChild|innerHTML|textContent|className)\b/g)]
    .map((match) => match[1]);
  clearWrites.forEach((name) => {
    assert.ok(
      /^annualTimeline/.test(name),
      `清空函数写到了非时间轴对象 ${name}`,
    );
  });
});

// ---------------------------------------------------------------- AC15
console.log("\n--- AC15 回归测试存在且被记录 ---");
check("AC15 本次运行真的覆盖了 15 条标准，且文档有映射", () => {
  // 不依赖"自己刚生成的报告"（那会死循环：报告要等本套件跑完才写）。
  // 可核对的是：本次运行确实发出了 AC01..AC15 各自至少一条 PASS，
  // 且 ACCEPTANCE.md 里逐条写了映射与判据。
  // 本套件负责的是前端计划那几条；AC01–AC04/06/07 由后端套件覆盖。
  const frontendAcs = ["AC05", "AC08", "AC09", "AC10", "AC11", "AC12", "AC13", "AC14", "AC15"];
  const missing = frontendAcs.filter((ac) => !emittedAcs.has(ac));
  assert.deepStrictEqual(missing, [], `本次运行没有覆盖这些标准：${missing}`);

  // 文档必须对 15 条都有映射行（含后端负责的那几条）
  const doc = readFileSync(path.join(ROOT, "tests", "ACCEPTANCE.md"), "utf8");
  const allAcs = Array.from({ length: 15 }, (_, i) => `AC${String(i + 1).padStart(2, "0")}`);
  const undocumented = allAcs.filter((ac) => !doc.includes(`| ${ac} |`));
  assert.deepStrictEqual(undocumented, [], `ACCEPTANCE.md 缺少这些标准的映射行：${undocumented}`);
});

check("AC15 验收与回归测试文件齐备且非空壳", () => {
  const required = [
    "tests/test_acceptance_backend.py",
    "tests/acceptance_frontend.test.cjs",
    "tests/test_bazi_months.py",
    "tests/annual_timeline.test.cjs",
    "tests/annual_timeline_view.test.cjs"
  ];
  required.forEach((file) => {
    const full = path.join(ROOT, file);
    assert.ok(existsSync(full), `缺少 ${file}`);
    const text = readFileSync(full, "utf8");
    assert.ok(text.length > 1024, `${file} 太小，可能是空壳`);
    // 至少要真有断言点，不能只有文件头
    const assertions = (text.match(/assert\.|self\.assert|check\(/g) || []).length;
    assert.ok(assertions >= 8, `${file} 只有 ${assertions} 处断言，覆盖不足`);
  });
});


console.log(`\n===== 验收检查 ${passed} 项全部通过 =====`);
