// 真正**执行**年度时间轴的 DOM 写入代码。
//
// 静态文本分析追不住 `const node = reportContent` 这类间接写入，
// 所以这里从 app.js 抠出函数体，注入假 DOM 直接跑：
// 假 DOM 里只有时间轴节点 + 五个**诱饵**报告容器，诱饵在渲染/清空/异常前后都比对深摘要。

const assert = require("node:assert");
const path = require("node:path");
const { readFileSync } = require("node:fs");

const ROOT = path.join(__dirname, "..");
require(path.join(ROOT, "web", "ziwei-facts.js"));
require(path.join(ROOT, "web", "annual-timeline.js"));

const Timeline = globalThis.MingliAnnualTimeline;
const appJs = readFileSync(path.join(ROOT, "web", "app.js"), "utf8");

let passed = 0;
const pendingChecks = [];
function check(label, fn) {
  const result = fn();
  if (result && typeof result.then === "function") {
    // 异步用例不能"启动了就算过"：收集起来，收尾时 await，失败要能拦住进程
    pendingChecks.push(
      result.then(
        () => {
          passed += 1;
          console.log(`  PASS ${label}`);
        },
        (error) => {
          console.error(`  FAIL ${label}`);
          throw error;
        },
      ),
    );
    return;
  }
  passed += 1;
  console.log(`  PASS ${label}`);
}

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `找不到函数 ${name}`);
  const open = source.indexOf("{", start);
  const end = findBlockEnd(source, open);
  if (end < 0) throw new Error(`${name} 函数体没有闭合`);
  return source.slice(start, end + 1);
}

// 找到与 openIndex 处 `{` 配对的花括号位置。
// 必须跳过字符串、模板字面量、注释里的花括号——`const t = "}";` 不该提前闭合。
function findBlockEnd(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i);
      if (i < 0) return source.length - 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2);
      if (i < 0) return source.length - 1;
      i += 1;
      continue;
    }
    // 正则字面量：`/}/` 里的花括号不能被当作块结束。
    // 靠前一个非空白字符判断是"除号"还是"正则开头"。
    if (ch === "/") {
      let k = i - 1;
      while (k >= 0 && /\s/.test(source[k])) k -= 1;
      const prev = k >= 0 ? source[k] : "";
      // return /}/ 这种：斜杠前是关键字，不是标识符结尾，仍然算正则开头
      let word = "";
      let w = k;
      while (w >= 0 && /[A-Za-z_$]/.test(source[w])) {
        word = source[w] + word;
        w -= 1;
      }
      const REGEX_KEYWORDS = new Set([
        "return", "typeof", "case", "in", "of", "delete", "void", "throw",
        "instanceof", "new", "do", "else", "yield", "await",
      ]);
      // 注意：`)` 之后**不再**当作正则开头。`const x = (a) / 2;` 是除法，
      // 误判成正则会把后面的 `{` 一起吞掉，函数体被截断。
      if (
        prev === ""
        || "(,=:[!&|?{};+-*%<>~".includes(prev)
        || REGEX_KEYWORDS.has(word)
      ) {
        let scan = i + 1;
        let inClass = false;
        let closed = -1;
        while (scan < source.length) {
          const c = source[scan];
          if (c === "\n") break;            // 跨行 → 不是正则，按除法处理
          if (c === "\\") {
            scan += 2;
            continue;
          }
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) {
            closed = scan;
            break;
          }
          scan += 1;
        }
        if (closed > 0) {
          i = closed;                       // 跳过整个正则字面量
          continue;
        }
      }
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function createElement(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: "",
    hidden: false,
    dataset: {},
    children: [],
    // 真 DOM 里 textContent 赋值会移除子节点：清空实现若用 textContent = ""，
    // children 也必须真的变空，否则会被误判成"没清"
    get textContent() {
      return this._textContent ?? "";
    },
    set textContent(value) {
      this._textContent = value;
      // 真 DOM 里任何 textContent 赋值都会替换全部子节点，不只是赋空串
      this.children = [];
    },
    // innerHTML 是真 DOM 的清空手段：赋空串必须真的把子节点清掉，
    // 否则用 innerHTML = "" 清空的实现会被误判成"没清"
    get innerHTML() {
      return this._innerHTML ?? "";
    },
    set innerHTML(value) {
      this._innerHTML = value;
      if (value === "") {
        this.children = [];
        this.textContent = "";
      }
    },
    append(...items) {
      items.forEach((item) => {
        assert.ok(item && typeof item === "object", "append 收到非法节点");
        this.children.push(item);
      });
    },
    replaceChildren(...items) {
      this.children = items;
    },
  };
  return node;
}

function stubNodes() {
  const section = createElement("section");
  section.hidden = true;
  return {
    section,
    year: createElement("h2"),
    summary: createElement("p"),
    fingerprints: createElement("p"),
    checks: createElement("ul"),
    months: createElement("div"),
  };
}

function decoyNodes() {
  // 诱饵必须**预先有内容**：给一个空节点做清空，前后快照都一样，
  // 抓不住 `const node = reportContent; node.replaceChildren();` 这种越界清空。
  const seed = (tag, label) => {
    const node = createElement(tag);
    node.textContent = `${label} 的既有内容`;
    node.className = "existing-report-block";
    node.dataset.existing = "1";
    node.appendChild ? null : null;
    node.children.push(createElement("p"));
    return node;
  };
  return {
    reportContent: seed("div", "既有报告"),
    resultContent: seed("div", "既有结果"),
    aiReadingSection: seed("section", "既有 AI 解读"),
    ziweiContent: seed("div", "既有紫微内容"),
    emptyState: seed("section", "既有空状态"),
  };
}

function digest(node) {
  return {
    hidden: node.hidden,
    textContent: node.textContent,
    innerHTML: node.innerHTML ?? null,
    className: node.className,
    dataset: { ...(node.dataset || {}) },
    children: (node.children || []).map(digest),
  };
}

function snapshot(nodes) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(nodes).map(([name, node]) => [name, digest(node)])),
  );
}

function buildRenderer(overrides = {}, existingNodes = null) {
  const nodes = existingNodes || stubNodes();
  // 复用同一批诱饵：新建的话，异常测试比的就是新诱饵，原有报告被动过也看不出来
  if (!nodes.decoys) {
    nodes.decoys = decoyNodes();
    nodes.decoyBefore = snapshot(nodes.decoys);
  }
  Object.assign(globalThis, nodes.decoys);
  // 记账版存储：localStorage["setItem"](...) 这类写法也会被记下来
  if (!nodes.storage) {
    const calls = [];
    const api = {
      setItem(key, value) { calls.push(["setItem", key, String(value)]); },
      getItem(key) { calls.push(["getItem", key]); return null; },
      removeItem(key) { calls.push(["removeItem", key]); },
      clear() { calls.push(["clear"]); },
    };
    // 用 Proxy 包一层：localStorage["key"] = "v" 这种直接赋值也要被记下来
    const proxied = new Proxy(api, {
      set(target, key, value) {
        calls.push(["set", String(key), String(value)]);
        target[key] = value;
        return true;
      },
      deleteProperty(target, key) {
        calls.push(["delete", String(key)]);
        delete target[key];
        return true;
      },
    });
    nodes.storage = { calls, api: proxied };
  }
  globalThis.localStorage = nodes.storage.api;
  globalThis.sessionStorage = nodes.storage.api;
  const decoys = nodes.decoys;

  const body = [
    functionSource(appJs, "createLine"),
    functionSource(appJs, "clearAnnualTimeline"),
    functionSource(appJs, "renderAnnualTimelineUnsafe"),
    functionSource(appJs, "renderAnnualTimeline"),
    "return { renderAnnualTimelineUnsafe, renderAnnualTimeline, clearAnnualTimeline };",
  ].join("\n");

  const factory = new Function(
    "document",
    "window",
    "annualTimelineSection",
    "annualTimelineYear",
    "annualTimelineSummary",
    "annualTimelineFingerprints",
    "annualTimelineChecks",
    "annualTimelineMonths",
    "currentShanghaiTimeIndex",
    body,
  );
  const api = factory(
    { createElement },
    {
      MingliAnnualTimeline: Timeline,
      MingliZiweiFacts: globalThis.MingliZiweiFacts,
      ...overrides,
    },
    nodes.section,
    nodes.year,
    nodes.summary,
    nodes.fingerprints,
    nodes.checks,
    nodes.months,
    6,
  );
  return { nodes, ...api };
}

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(ROOT, "tests", "fixtures", name), "utf8"));
}

// 提取提交流程里那段 catch 的函数体（不是整个 app.js，也不是别处的 catch）。
// 判据：这段 catch 的 body 里同时出现 renderServerError 与 clearAnnualTimeline。
function extractSubmitCatch(source) {
  // 只在**提交处理器**的范围内找：整份文件里任何一个同形状的 catch 都不算数。
  // 处理器已提成具名函数 handleSubmit，直接按函数名取范围。
  const fnSource = functionSource(source, "handleSubmit");
  source = fnSource.slice(fnSource.indexOf("{") + 1, fnSource.lastIndexOf("}"));

  const marker = "} catch (error) {";
  const matches = [];
  let from = 0;
  while (true) {
    const start = source.indexOf(marker, from);
    if (start < 0) break;
    // 这段 try/catch 必须在处理器**顶层**：包在 if (false) 里就不会执行。
    // 判据是「try 关键字所在位置之前的嵌套深度为 0」——
    // 注意不能在 `} catch` 处量深度，那时 try 的括号还没闭合。
    {
      const tryIndex = source.lastIndexOf("try {", start);
      let depth = 0;
      for (let k = 0; tryIndex >= 0 && k < tryIndex; k += 1) {
        if (source[k] === "{") depth += 1;
        else if (source[k] === "}") depth -= 1;
      }
      if (tryIndex < 0 || depth !== 0) {
        from = start + marker.length;
        continue;
      }
      // 花括号深度为 0 还不够：`if (false)\n  try { … }` 没有花括号也能绕过。
      // 要求 try 的上一行不是控制语句，且以语句边界结尾。
      const before = source.slice(0, tryIndex).split("\n").filter((row) => row.trim());
      const previousLine = before.length ? before[before.length - 1].trim() : "";
      if (/^(if|for|while|else|switch)\b/.test(previousLine) || !/[;{}]\s*$/.test(previousLine)) {
        from = start + marker.length;
        continue;
      }
    }
    if (start < 0) break;
    const open = start + marker.length - 1;
    {
        const close = findBlockEnd(source, open);
        {
          const i = close;
          const body = close < 0 ? "" : source.slice(open + 1, i);
          const tail = source.slice(i, i + 160);
          // 它还必须是**请求失败**那条路径：往前找最近的 try {，其块内要出现 fetch(
          const tryIndex = source.lastIndexOf("try {", start);
          const tryBody = tryIndex >= 0 ? source.slice(tryIndex, start) : "";
          const belongsToRequest = tryBody.includes("fetch(");
          // 必须是**表单提交**那段：body 含两个调用，且紧跟 finally+setLoading(false)。
          // 只看 body 文本的话，随便哪个 catch 写这两句都会被选中。
          const isSubmitCatch =
            belongsToRequest
            && body.includes("renderServerError")
            && body.includes("clearAnnualTimeline")
            && /}\s*finally\s*\{/.test(tail)
            && tail.includes("setLoading(false)");
          if (isSubmitCatch) {
            matches.push(body);
          }
        }
    }
    from = start + marker.length;
  }
  // 模糊匹配最怕"随便挑一个"：候选不唯一就直接失败，逼人来看清楚
  if (matches.length === 0) {
    throw new Error("提交处理器里找不到清理时间轴的 catch");
  }
  assert.strictEqual(
    matches.length, 1,
    `提交处理器里有 ${matches.length} 个看起来像提交失败的 catch，无法确定测的是哪一个`,
  );
  return matches[0];
}

const unavailableZiwei = { status: "unavailable", months: [], reason: "未知时辰，无法建立紫微盘" };

// ---------------------------------------------------------------- 渲染
console.log("--- 渲染成功路径 ---");
check("真实数据渲染后区块显示、12 张月卡都写进了 DOM", () => {
  const { nodes, renderAnnualTimelineUnsafe } = buildRenderer();
  assert.strictEqual(nodes.section.hidden, true, "初始应为隐藏");
  renderAnnualTimelineUnsafe({ monthly_facts: loadFixture("monthly-real-minute.json") }, unavailableZiwei);
  assert.strictEqual(nodes.section.hidden, false);
  assert.ok(nodes.year.textContent.includes("2026"), nodes.year.textContent);
  assert.ok(nodes.summary.textContent.length > 0, "缺摘要");
  assert.ok(nodes.fingerprints.textContent.includes("声明"));
  assert.strictEqual(nodes.months.children.length, 12);
  nodes.months.children.forEach((card, i) => {
    assert.strictEqual(card.dataset.monthIndex, String(i + 1));
    assert.ok(card.children.length >= 4, `第 ${i + 1} 张卡子节点过少`);
  });
});

check("校验项写进 DOM 且带 dataset 标记", () => {
  const { nodes, renderAnnualTimelineUnsafe } = buildRenderer();
  renderAnnualTimelineUnsafe({ monthly_facts: loadFixture("monthly-real-minute.json") }, unavailableZiwei);
  const rows = nodes.checks.children;
  assert.ok(rows.length >= 4);
  rows.forEach((row) => {
    assert.ok(row.dataset.checkId);
    assert.ok(row.dataset.checkPass === "true" || row.dataset.checkPass === "false");
    assert.ok(row.className.includes("annual-timeline-check"));
  });
});

check("紫微不可用时月卡不带四态明细", () => {
  const { nodes, renderAnnualTimelineUnsafe } = buildRenderer();
  renderAnnualTimelineUnsafe({ monthly_facts: loadFixture("monthly-real-minute.json") }, unavailableZiwei);
  nodes.months.children.forEach((card) => {
    assert.strictEqual(card.dataset.ziweiStatus, "unavailable");
    assert.strictEqual(card.children.some((child) => child.tagName === "DETAILS"), false);
  });
});

// ---------------------------------------------------------------- 清空
console.log("\n--- 清空与失败路径 ---");
check("clearAnnualTimeline 真的隐藏并清空所有节点", () => {
  const { nodes, renderAnnualTimelineUnsafe, clearAnnualTimeline } = buildRenderer();
  renderAnnualTimelineUnsafe({ monthly_facts: loadFixture("monthly-real-minute.json") }, unavailableZiwei);
  assert.strictEqual(nodes.months.children.length, 12);
  clearAnnualTimeline();
  assert.strictEqual(nodes.section.hidden, true);
  assert.strictEqual(nodes.months.children.length, 0);
  assert.strictEqual(nodes.checks.children.length, 0);
  // 年份被清成占位符（" — "）也算清掉，关键是不能再显示上一轮的年份数字
  assert.ok(
    !/\d{4}/.test(nodes.year.textContent),
    `清空后旧年份仍留在页面上：${JSON.stringify(nodes.year.textContent)}`,
  );
  assert.strictEqual(nodes.summary.textContent, "");
  assert.strictEqual(nodes.fingerprints.textContent, "");
});

check("monthly_facts 不可用时走清空而不是渲染半截", () => {
  const { nodes, renderAnnualTimelineUnsafe } = buildRenderer();
  renderAnnualTimelineUnsafe({ monthly_facts: loadFixture("monthly-real-minute.json") }, unavailableZiwei);
  renderAnnualTimelineUnsafe({ monthly_facts: { status: "unsupported", months: [] } }, unavailableZiwei);
  assert.strictEqual(nodes.section.hidden, true);
  assert.strictEqual(nodes.months.children.length, 0);
});

check("缺少 monthly_facts 或格式不对都不会抛异常", () => {
  const { nodes, renderAnnualTimelineUnsafe } = buildRenderer();
  [undefined, null, {}, { monthly_facts: null }, { monthly_facts: { status: "ok" } }].forEach((data) => {
    renderAnnualTimelineUnsafe(data, unavailableZiwei);
    assert.strictEqual(nodes.section.hidden, true);
  });
});

// ---------------------------------------------------------------- 既有报告隔离
console.log("\n--- 年份来自数据（不是写死） ---");
check("换一个 target_year，页面年份随之改变", () => {
  // 调用方若把年份硬编码成 2026，这条会失败
  const shifted = JSON.parse(JSON.stringify(loadFixture("monthly-real-minute.json")));
  shifted.target_year = 2031;
  shifted.fingerprint = undefined;
  const { nodes, renderAnnualTimelineUnsafe } = buildRenderer();
  renderAnnualTimelineUnsafe({ monthly_facts: shifted }, unavailableZiwei);
  assert.ok(
    nodes.year.textContent.includes("2031"),
    `页面年份没有跟着 target_year 走：${nodes.year.textContent}`,
  );
});

console.log("\n--- 既有报告隔离（真执行） ---");
check("渲染与清空都不碰既有报告容器与本地存储", () => {
  const { nodes, renderAnnualTimelineUnsafe, clearAnnualTimeline } = buildRenderer();
  const { decoys, decoyBefore, storage } = nodes;
  renderAnnualTimelineUnsafe({ monthly_facts: loadFixture("monthly-real-minute.json") }, unavailableZiwei);
  assert.strictEqual(snapshot(decoys), decoyBefore, "渲染改动了既有报告容器");
  clearAnnualTimeline();
  assert.strictEqual(snapshot(decoys), decoyBefore, "清空改动了既有报告容器");
  assert.deepStrictEqual(
    storage.calls, [],
    `时间轴读写过本地存储：${JSON.stringify(storage.calls)}`,
  );
});

check("渲染内部抛错时外层吞掉、清空，且不碰既有报告", () => {
  // 用同一个**节点集合**：先正常渲染出 12 个月，再换一个会抛错的 timeline 重新装配，
  // 这样"异常后清空"验的是同一批节点，而不是一开就空的另一批
  const seeded = buildRenderer();
  seeded.renderAnnualTimelineUnsafe({ monthly_facts: loadFixture("monthly-real-minute.json") }, unavailableZiwei);
  const sharedNodes = seeded.nodes;
  assert.strictEqual(sharedNodes.months.children.length, 12, "前置：应已渲染出 12 个月");
  assert.strictEqual(sharedNodes.section.hidden, false, "前置：区块应可见");
  const before = snapshot(sharedNodes.decoys);

  const throwingTimeline = {
    ...Timeline,
    build() {
      throw new Error("boom: 模拟装配失败");
    },
  };
  const { renderAnnualTimeline } = buildRenderer({ MingliAnnualTimeline: throwingTimeline }, sharedNodes);
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(
      () => renderAnnualTimeline({ monthly_facts: loadFixture("monthly-real-minute.json") }, unavailableZiwei),
      "外层必须吞掉异常，否则会打断既有报告链路",
    );
  } finally {
    console.warn = realWarn;
  }
  assert.strictEqual(sharedNodes.section.hidden, true, "出错时应隐藏本区块");
  assert.strictEqual(sharedNodes.months.children.length, 0, "出错时应清空旧月份");
  assert.strictEqual(snapshot(sharedNodes.decoys), before, "失败降级时动到了既有报告容器");
});

check("正常路径下外层把参数原样转交给内部实现", () => {
  const { nodes, renderAnnualTimeline } = buildRenderer();
  renderAnnualTimeline({ monthly_facts: loadFixture("monthly-real-minute.json") }, unavailableZiwei);
  assert.strictEqual(nodes.section.hidden, false);
  assert.strictEqual(nodes.months.children.length, 12);
});

check("依赖缺失（timeline 未加载）时也走清空而不是抛错", () => {
  const { nodes, renderAnnualTimeline } = buildRenderer({ MingliAnnualTimeline: undefined });
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(() =>
      renderAnnualTimeline({ monthly_facts: loadFixture("monthly-real-minute.json") }, unavailableZiwei),
    );
  } finally {
    console.warn = realWarn;
  }
  assert.strictEqual(nodes.section.hidden, true);
  assert.strictEqual(nodes.months.children.length, 0);
});

// ---------------------------------------------------------------- 紫微建盘门
console.log("\n--- 紫微流月建盘门 ---");
function spyOnBuildMonthlyTiming() {
  const calls = [];
  const realFacts = globalThis.MingliZiweiFacts;
  const spy = {
    ...realFacts,
    buildMonthlyTiming: (...args) => {
      calls.push(args);
      return { status: "unavailable", months: [] };
    },
  };
  globalThis.MingliZiweiFacts = spy;
  return { calls, restore: () => { globalThis.MingliZiweiFacts = realFacts; } };
}

check("未知时辰时一次都不调用 buildMonthlyTiming", () => {
  const { calls, restore } = spyOnBuildMonthlyTiming();
  try {
    const { renderAnnualTimelineUnsafe } = buildRenderer();
    renderAnnualTimelineUnsafe({ monthly_facts: loadFixture("monthly-real-minute.json") }, unavailableZiwei);
  } finally {
    restore();
  }
  assert.strictEqual(calls.length, 0, `未知时辰却调用了 ${calls.length} 次`);
});

check("紫微可用时恰好调用一次 buildMonthlyTiming", () => {
  const { calls, restore } = spyOnBuildMonthlyTiming();
  let nodes;
  try {
    const renderer = buildRenderer();
    nodes = renderer.nodes;
    renderer.renderAnnualTimelineUnsafe(
      { monthly_facts: loadFixture("monthly-real-minute.json") },
      { status: "ok", astrolabe: { fake: true }, palaces: [{ name: "命宫" }], reason: null },
    );
  } finally {
    restore();
  }
  assert.strictEqual(calls.length, 1, `应调用一次，实际 ${calls.length}`);
  assert.deepStrictEqual(calls[0][0], { fake: true });
  assert.strictEqual(calls[0][1].length, 1);
  assert.strictEqual(nodes.months.children.length, 12, "即使紫微建盘失败，八字侧仍应渲染");
});

// 取出提交处理器的**函数体**，整段放进可控沙箱里执行。
// 这比"抠出 catch 单独跑"强一档：能证明实际的请求失败路径确实走到清空。
function extractSubmitHandlerBody(source) {
  const marker = 'addEventListener("submit"';
  const i = source.indexOf(marker);
  assert.ok(i > 0, "找不到 submit 事件绑定");
  const arrow = source.indexOf("=>", i);
  assert.ok(arrow > i, "submit 绑定的不是箭头函数");
  const open = source.indexOf("{", arrow);
  const end = findBlockEnd(source, open);
  if (end < 0) throw new Error("提交处理器函数体没有闭合");
  return source.slice(open + 1, end);
}

// 宽容沙箱：未声明的标识符一律返回惰性桩，避免因无关的 DOM 细节中途抛错
function makeSandbox(overrides) {
  const lazyStub = () =>
    new Proxy(function () {}, {
      get: () => lazyStub(),
      apply: () => lazyStub(),
      set: () => true,
    });
  return new Proxy(overrides, {
    has: () => true,
    get: (target, key) => {
      if (key === Symbol.unscopables) return undefined;
      if (key in target) return target[key];
      return lazyStub();
    },
  });
}

async function runSubmitHandler(source, overrides) {
  const fnSource = functionSource(source, "handleSubmit");
  const body = fnSource.slice(fnSource.indexOf("{") + 1, fnSource.lastIndexOf("}"));
  const harness = new Function(
    "sandbox",
    `with (sandbox) { return (async (event) => { ${body} })(sandbox.__event); }`,
  );
  return harness(makeSandbox({ __event: { preventDefault() {} }, ...overrides }));
}

// 身份证明：注册上去的那个函数，与测试执行的那份源码必须是同一个。
// 只比函数名挡不住"同名函数表达式"这种脱钩。
function assertExecutedMatchesRegistered(source) {
  const registered = captureSubmitHandler({}).submit;
  assert.ok(typeof registered === "function", "页面没有注册 submit 处理器");
  const extracted = functionSource(source, "handleSubmit");
  const normalize = (text) => {
    const open = text.indexOf("{");
    const end = findBlockEnd(text, open);
    assert.ok(open >= 0 && end > open, "取不到函数体");
    return text.slice(open, end + 1).replace(/\s+/g, " ").trim();
  };
  assert.strictEqual(
    normalize(registered.toString()),
    normalize(extracted),
    "注册的 handleSubmit 与测试执行的源码不是同一个函数",
  );
}

// 运行时捕获提交处理器：把整份 app.js 在 with(sandbox) 里执行一遍，
// form.addEventListener("submit", fn) 会把 fn 交出来。
// 这样拿到的是**真正的函数对象**，完全不需要解析源码、也就没有词法问题。
function captureSubmitHandler(overrides) {
  const handlers = {};
  const handlerOwners = {};
  const makeEl = (selector) => ({
    selector,
    value: "",
    textContent: "",
    hidden: false,
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    elements: new Proxy({}, { get: () => makeEl("field") }),
    options: [{ textContent: "" }, { textContent: "" }, { textContent: "" }],
    addEventListener(type, fn) {
      handlers[type] = fn;
      handlerOwners[type] = selector;
    },
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: (sel) => makeEl(sel),
    querySelectorAll: () => [],
    append() {},
    appendChild() {},
    replaceChildren() {},
    focus() {},
    closest: () => null,
  });
  const sandbox = {
    // 标准内建要原样透传：Proxy 的兜底会把 Intl.DateTimeFormat 变成普通函数，
    // 一旦被 new 就报 "is not a constructor"
    Intl, Date, Math, JSON, Number, String, Boolean, Array, Object, Promise, console,
    setTimeout, clearTimeout, requestAnimationFrame: (fn) => fn(),
    document: {
      querySelector: (sel) => makeEl(sel),
      querySelectorAll: () => [],
      addEventListener(type, fn) {
        handlers[type] = fn;
        handlerOwners[type] = "document";
      },
      createElement: (tag) => makeEl(tag),
      body: makeEl("body"),
    },
    ...overrides,
  };
  // 未知标识符返回**惰性代理**（既可调用、又可按属性/下标继续访问），
  // 直接返回 undefined 会让 `foo[0]` 这类链式访问把整个加载过程打断
  const lazy = () =>
    new Proxy(function () {}, {
      get: () => lazy(),
      apply: () => lazy(),
      set: () => true,
    });
  const proxy = new Proxy(sandbox, {
    has: () => true,
    get: (target, key) => {
      if (key === Symbol.unscopables) return undefined;
      if (key in target) return target[key];
      return lazy();
    },
  });
  const factory = new Function("sandbox", `with (sandbox) { ${appJs} }`);
  // 不吞异常：顶层初始化必须完整跑完，否则"注册成功"可能只是抛错前的半截状态
  factory(proxy);
  return Object.assign(handlers, { __owners: handlerOwners });
}

// ---------------------------------------------------------------- 提交失败分支
console.log("\n--- AC14 提交失败分支（真执行） ---");
check("错误渲染自己抛错时，时间轴也已经被清空", async () => {
  assertExecutedMatchesRegistered(appJs);
  const calls = [];
  const overrides = {
    __event: { preventDefault() {}, target: null },
    fetch: () => {
      calls.push(["fetch"]);
      return Promise.reject(new Error("network down"));
    },
    calculateInBrowser: undefined,
    validate: () => true,
    payload: () => ({ options: {} }),
    errorSummary: { hidden: true, focus() {} },
    emptyState: { hidden: true },
    setLoading: () => {},
    clearAnnualTimeline: () => calls.push(["clear"]),
    renderServerError: () => {
      calls.push(["renderError"]);
      throw new Error("render boom");
    },
    window: {},
  };
  let thrown = null;
  try {
    await runSubmitHandler(appJs, overrides);
  } catch (error) {
    thrown = error;
  }
  const names = calls.map((entry) => entry[0]);
  assert.ok(names.includes("renderError"), `没有走到错误渲染：${JSON.stringify(calls)}`);
  assert.ok(
    names.indexOf("clear") >= 0 && names.indexOf("clear") < names.indexOf("renderError"),
    `错误渲染抛错前必须已经清空：${JSON.stringify(calls)}`,
  );
  assert.ok(thrown, "错误渲染的异常应向外传播（由外层 finally 收尾）");
});

check("setLoading 的真实实现会清空时间轴并恢复按钮", () => {
  // 不用桩：直接跑 setLoading 的真实实现。它会碰一批 DOM 节点与状态变量，
  // 这里把被引用到的全部绑定成可观测的小对象。
  const fnSource = functionSource(appJs, "setLoading");
  const body = fnSource.slice(fnSource.indexOf("{") + 1, fnSource.lastIndexOf("}"));
  const calls = [];
  const attrs = {};
  const el = () => ({
    hidden: false,
    classList: { remove: (name) => calls.push(["classRemove", name]) },
    querySelector: () => ({ textContent: "" }),
  });
  const env = {
    submitButton: { disabled: false, querySelector: () => ({ textContent: "" }) },
    resultPanel: { setAttribute: (key, value) => { attrs[key] = value; } },
    emptyState: el(),
    systemSwitch: el(),
    resultContent: el(),
    ziweiContent: el(),
    aiReadingSection: el(),
    loadingState: el(),
    latestAiContract: { ok: true },
    clearAnnualTimeline: () => calls.push(["clear"]),
  };
  const names = Object.keys(env);
  const run = new Function(
    "loading",
    `with (${JSON.stringify(names).replace(/"/g, "")}) { ${body} }`,
  );
  // with 需要真实的作用域绑定，改用具名参数逐个传入更可靠
  const runner = new Function(
    ...names,
    "loading",
    body,
  );
  runner.apply(null, names.map((name) => env[name]).concat([true]));
  assert.ok(calls.some((entry) => entry[0] === "clear"), "开始加载时应清空旧时间轴");
  assert.strictEqual(env.submitButton.disabled, true, "加载中按钮应禁用");
  assert.strictEqual(env.resultContent.hidden, true, "加载中应隐藏旧结果");
  assert.strictEqual(attrs["aria-busy"], "true", "加载中 aria-busy 应为 true");

  runner.apply(null, names.map((name) => env[name]).concat([false]));
  assert.strictEqual(env.submitButton.disabled, false, "加载结束后按钮必须恢复可用");
  assert.strictEqual(attrs["aria-busy"], "false", "加载结束后 aria-busy 必须复位");
  assert.strictEqual(env.loadingState.hidden, true, "加载结束后应隐藏加载态");
});

check("外层包装器抛错降级时也不碰存储与既有报告", () => {
  // 之前只执行了内层 renderAnnualTimelineUnsafe 与 clearAnnualTimeline，
  // 外层包装器自己的 catch 分支没跑过——那里若偷偷写 localStorage 就发现不了。
  const fnSource = functionSource(appJs, "renderAnnualTimeline");
  const body = fnSource.slice(fnSource.indexOf("{") + 1, fnSource.lastIndexOf("}"));
  const calls = [];
  const storage = [];
  const decoy = { hidden: false, textContent: "既有内容", className: "r", dataset: {}, children: [] };
  const before = JSON.stringify(decoy);
  const spyTarget = {
    setItem: (k, v) => storage.push(["setItem", k, String(v)]),
    getItem: (k) => { storage.push(["getItem", k]); return null; },
    removeItem: (k) => storage.push(["removeItem", k]),
    clear: () => storage.push(["clear"]),
  };
  // 直接赋值（localStorage.leak = "1"）与删除也要记账
  const spy = new Proxy(spyTarget, {
    set(target, key, value) {
      storage.push(["set", String(key), String(value)]);
      target[key] = value;
      return true;
    },
    deleteProperty(target, key) {
      storage.push(["delete", String(key)]);
      delete target[key];
      return true;
    },
  });
  globalThis.localStorage = spy;
  globalThis.sessionStorage = spy;
  const realWarn = console.warn;
  console.warn = () => {};
  const runner = new Function(
    "data",
    "ziweiResult",
    "renderAnnualTimelineUnsafe",
    "clearAnnualTimeline",
    "reportContent",
    body,
  );
  try {
    assert.doesNotThrow(() =>
      runner.apply(null, [
        {},
        {},
        () => { throw new Error("inner boom"); },
        () => calls.push(["clear"]),
        decoy,
      ]),
      "外层必须吞掉内层异常",
    );
  } finally {
    console.warn = realWarn;
  }
  assert.ok(calls.some((entry) => entry[0] === "clear"), "降级时应清空时间轴");
  assert.deepStrictEqual(storage, [], `降级路径碰了本地存储：${JSON.stringify(storage)}`);
  assert.strictEqual(JSON.stringify(decoy), before, "降级路径改动了既有报告容器");
});

check("提交成功路径真的把数据交给年度时间轴渲染", async () => {
  assertExecutedMatchesRegistered(appJs);
  const calls = [];
  const okPayload = {
    status: "ok",
    normalized_input: { profile: { solar_date: "2026-06-01", gender: "male" } },
    pillars: [],
    months: [],
    warnings: [],
  };
  let failure = null;
  try {
    await runSubmitHandler(appJs, {
      __event: { preventDefault() {}, target: null },
      fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(okPayload) }),
      calculateInBrowser: undefined,
      window: {
        MingliZiwei: { calculate: () => ({ status: "unavailable", months: [] }) },
        MingliAiContract: { build: () => ({ ok: true }) },
      },
      renderResult: () => calls.push(["renderResult"]),
      renderAnnualTimeline: (data, ziwei) => calls.push(["renderTimeline", data, ziwei]),
      renderZiwei: () => calls.push(["renderZiwei"]),
      prepareAiReading: () => {},
      selectSystem: () => {},
      setLoading: () => calls.push(["setLoading"]),
      clearAnnualTimeline: () => calls.push(["clear"]),
      renderServerError: () => calls.push(["renderError"]),
      validate: () => true,
      payload: () => ({ options: { annual_cycles_through: 2026 } }),
      currentShanghaiDate: "2026-10-29",
      currentShanghaiTimeIndex: 6,
      systemSwitch: { hidden: true },
      emptyState: { hidden: true },
      errorSummary: { hidden: true, focus() {} },
    });
  } catch (error) {
    failure = error;
  }
  const names = calls.map((entry) => entry[0]);
  assert.ok(
    names.includes("renderTimeline"),
    `提交成功后没有把数据交给年度时间轴：${JSON.stringify(calls)}（${failure && failure.message}）`,
  );
  assert.ok(
    !names.includes("renderError"),
    `提交成功却走了错误分支：${JSON.stringify(names)}`,
  );
  // 交出去的必须就是这次请求拿到的数据，不能是 undefined 或别的对象
  const rendered = calls.find((entry) => entry[0] === "renderTimeline");
  assert.strictEqual(rendered[1], okPayload, "交给时间轴的不是本次响应数据");
  // 真实注册：页面必须把 handleSubmit 绑到 submit 事件上
  // 运行时证明：真的把整份 app.js 执行一遍，看 submit 事件有没有被绑上。
  // 这比"源码里有没有这句话"强得多——放进 if (false) 或不注册都会被抓住。
  const handlers = captureSubmitHandler({});
  assert.ok(
    typeof handlers.submit === "function",
    "执行 app.js 后 submit 事件没有绑定处理器",
  );
  // 还要是**那个**处理器：别的元素绑一个无关 submit 也会被记成 handlers.submit
  assert.strictEqual(
    handlers.submit.name,
    "handleSubmit",
    `submit 绑的不是 handleSubmit（实际是 ${handlers.submit.name || "匿名函数"}）`,
  );
  // 还必须绑在**表单**上：别的元素绑一个同名函数不算数
  const owner = handlers.__owners.submit || "";
  // 精确选择器：#transform 这种名字里带 form 的普通元素不该算数
  assert.strictEqual(
    owner, "#chart-form",
    `submit 绑在了 ${owner || "未知元素"} 上，不是 #chart-form`,
  );
});

check("整段提交处理器在沙箱里执行：fetch 抛错时一定清空时间轴", async () => {
  assertExecutedMatchesRegistered(appJs);
  const calls = [];
  const overrides = {
    event: { preventDefault() {} },
    validate: () => true,
    payload: () => ({ options: {} }),
    errorSummary: { hidden: true, focus() {} },
    emptyState: { hidden: true },
    setLoading: (flag) => calls.push(["setLoading", flag]),
    clearAnnualTimeline: () => calls.push(["clear"]),
    renderServerError: (error) => calls.push(["renderError", String(error && error.message)]),
    renderZiwei: () => {},
    renderAnnualTimeline: () => {},
    prepareAiReading: () => {},
    selectSystem: () => {},
    systemSwitch: { hidden: true },
    window: {},
    document: {
      querySelector: () => ({ textContent: "", setAttribute() {}, addEventListener() {} }),
      querySelectorAll: () => [],
    },
    fetch: () => {
      calls.push(["fetch"]);
      return Promise.reject(new Error("network down"));
    },
    calculateInBrowser: undefined,
    currentShanghaiDate: "2026-10-29",
    currentShanghaiTimeIndex: 6,
    requestPayload: {},
    data: {},
  };
  let rejected = null;
  try {
    await runSubmitHandler(appJs, overrides);
  } catch (error) {
    rejected = error;
  }
  const names = calls.map((entry) => entry[0]);
  assert.ok(names.includes("fetch"), `处理器没有发起请求：${JSON.stringify(calls)}`);
  assert.ok(
    names.includes("renderError"),
    `fetch 失败后没有渲染错误：${JSON.stringify(calls)}（rejected=${rejected && rejected.message}）`,
  );
  assert.ok(names.includes("setLoading"), "处理器没有调用 setLoading");

  // 关键：要区分"提交开始时清空"与"请求失败后清空"。
  // 请求之后必须还发生过一次清空，否则失败路径根本没清。
  const lastClear = names.lastIndexOf("clear");
  const fetchIndex = names.indexOf("fetch");
  const errorIndex = names.indexOf("renderError");
  assert.ok(lastClear > fetchIndex, `请求失败后没有再次清空时间轴：${JSON.stringify(calls)}`);
  assert.ok(errorIndex > fetchIndex, `错误渲染没有发生在请求之后：${JSON.stringify(calls)}`);
  // 清空必须早于错误渲染：反过来写的话，渲染一抛错旧年份就留下了
  assert.ok(
    lastClear < errorIndex,
    `清空应早于错误渲染：${JSON.stringify(calls)}`,
  );
  // finally 收尾：失败后要恢复按钮状态
  const lastSetLoading = calls.map((e) => e[0]).lastIndexOf("setLoading");
  assert.ok(
    lastSetLoading > fetchIndex && calls[lastSetLoading][1] === false,
    `失败后没有恢复加载状态：${JSON.stringify(calls)}`,
  );
});





check("新提交一开始就清空旧时间轴（校验失败也不留旧年份）", async () => {
  // 变异测试发现的缺口：handleSubmit 顶部那句 clearAnnualTimeline() 此前没有断言覆盖，
  // 删掉它整套仍会全过。这里让 validate() 直接失败，只验证「进处理器就先清空」。
  const calls = [];
  await runSubmitHandler(appJs, {
    clearAnnualTimeline: () => calls.push("clear"),
    validate: () => false,
    setLoading: () => calls.push("loading"),
  });
  assert.deepStrictEqual(
    calls.slice(0, 1), ["clear"],
    `进入提交处理器时应先清空时间轴，实际调用序列：${JSON.stringify(calls)}`,
  );
  assert.ok(!calls.includes("loading"), "校验失败时不应进入加载态");
});

Promise.all(pendingChecks)
  .then(() => {
console.log(`\n===== DOM 渲染检查 ${passed} 项全部通过 =====`);
  })
  .catch((error) => {
    console.error(String(error && error.message));
    process.exitCode = 1;
  });
