/**
 * ChartInfo 适配器（plan-chartinfo.json T1/T2/T3）。
 *
 * 作用：把 `MingliZiwei.calculate()` 的结果翻译成钦天门紫微斗数 SKILL
 * §15 引擎契约要求的 11 个顶层字段。
 *
 * **重要免责**：SKILL §15 只列出了这 11 个字段的**名称**，没有给可执行的
 * 参考实现或嵌套结构。因此本文件定义的是**本项目暂定协议**，
 * 不应宣称与某个未知参考实现二进制兼容。若日后拿到消费者样例，
 * 以样例为准调整。
 *
 * 另：`laiyinPalace`（来因宫）按 T2 固定输出 null 并附诊断——
 * SKILL 正文把来因宫列为「本定门高阶·本定版不引入」，而 §15 又要求
 * 该键存在，属于 SKILL 自身矛盾；这里不猜一个"看起来确定"的宫位。
 */
(function (root) {
  "use strict";

  var SCHEMA = "chartinfo/v1-candidate";
  var PALACE_COUNT = 12;
  var FOUR_HUA = ["禄", "权", "科", "忌"];
  var FOUR_LAYERS = ["natal", "decadal", "annual", "monthly"];

  function diag(code, path, message) {
    return { code: code, path: path, message: message };
  }

  function isArray(value) {
    return Object.prototype.toString.call(value) === "[object Array]";
  }

  /** 深拷贝（JSON 安全），避免下游改动污染排盘结果。 */
  function copyArray(value) {
    if (!isArray(value)) return [];
    return value.map(function (item) {
      if (item == null || typeof item !== "object") return item;
      return JSON.parse(JSON.stringify(item));
    });
  }

  /** 只取四层，日/时层明确排除（T1 要求「日、时不得静默挤入四层」）。 */
  var FOUR_LAYER_FIELDS = ["natalPalace", "decadalPalace", "annualPalace", "monthlyPalace"];
  // 十二地支：宫位地支必须在此集合内，不能只是"互不相同"
  var TWELVE_BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
  var TEN_STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];

  function buildFourLayerDieGong(overlay, palaceByBranch) {
    if (!isArray(overlay) || overlay.length !== 12) return null;
    var branches = {};
    var rows = [];
    for (var i = 0; i < overlay.length; i += 1) {
      var item = overlay[i];
      if (!item || !item.branch) return null;
      if (TWELVE_BRANCHES.indexOf(item.branch) < 0) return null; // 必须是十二地支之一
      if (branches[item.branch]) return null; // 地支必须唯一
      branches[item.branch] = true;
      var row = { branch: item.branch };
      for (var f = 0; f < FOUR_LAYER_FIELDS.length; f += 1) {
        var field = FOUR_LAYER_FIELDS[f];
        var value = item[field];
        // 四层宫名任何一个为空，就不能算"四层叠宫成立"
        if (value == null || String(value).trim() === "") return null;
        row[field] = value;
      }
      // 本命宫必须与该地支在本盘中的宫位一致：两行互换 natalPalace 不能蒙混过关
      if (palaceByBranch) {
        var natal = palaceByBranch[item.branch];
        if (!natal || String(natal.name) !== String(row.natalPalace)) return null;
      }
      rows.push(row);
    }
    return { layers: FOUR_LAYERS.slice(), rows: rows };
  }

  function periodFourHua(period) {
    if (!period || !isArray(period.fourTransformations)) return null;
    return copyArray(period.fourTransformations);
  }

  function periodOverlay(period) {
    if (!period || !isArray(period.palaceOverlay)) return null;
    return copyArray(period.palaceOverlay);
  }

  function buildChartInfo(chart, options) {
    options = options || {};
    var diagnostics = [];

    if (!chart || typeof chart !== "object") {
      return {
        status: "invalid",
        chartInfo: null,
        diagnostics: [diag("CHART_MISSING", "", "未提供排盘结果")]
      };
    }
    if (chart.status !== "ok") {
      return {
        status: "unavailable",
        chartInfo: null,
        diagnostics: [diag("CHART_NOT_OK", "status", "排盘状态为 " + String(chart.status))]
      };
    }

    var palaces = chart.palaces;
    // 缺 aiFacts 属于**必要数据缺失**，与"盘本身坏了"不是一类：
    // 前者数据补齐即可用，后者输入非法。分开报，别让调用方误判。
    if (!chart.aiFacts || typeof chart.aiFacts !== "object") {
      return {
        status: "unavailable",
        chartInfo: null,
        diagnostics: [diag("FACTS_MISSING", "aiFacts", "排盘结果缺少 aiFacts，无法构建 ChartInfo")]
      };
    }
    var facts = chart.aiFacts;
    var basics = chart.basics || {};

    if (!isArray(palaces) || palaces.length !== PALACE_COUNT) {
      diagnostics.push(diag(
        "PALACE_COUNT_INVALID", "palaces",
        "十二宫数量应为 " + PALACE_COUNT + "，实际 " + (isArray(palaces) ? palaces.length : "非数组")
      ));
    } else {
      var branches = {};
      var duplicated = [];
      palaces.forEach(function (palace) {
        if (!palace || typeof palace !== "object") {
          diagnostics.push(diag("PALACE_ENTRY_INVALID", "palaces", "存在空宫位条目"));
          return;
        }
        var branch = palace.earthlyBranch;
        if (TWELVE_BRANCHES.indexOf(branch) < 0) {
          diagnostics.push(diag("PALACE_BRANCH_INVALID", "palaces",
            "宫位地支不在十二地支内：" + String(branch)));
        }
        if (branches[branch]) duplicated.push(branch);
        branches[branch] = true;
      });
      if (duplicated.length) {
        diagnostics.push(diag(
          "PALACE_BRANCH_DUPLICATED", "palaces",
          "地支重复：" + duplicated.join("、")
        ));
      }
    }

    var sihua = copyArray(facts.fourTransformations);
    var sihuaKinds = sihua.map(function (item) { return item && item.kind; });
    var sihuaOk = sihua.length === FOUR_HUA.length;
    if (sihuaOk) {
      // 必须恰好是禄权科忌各一，重复或缺失都不算完整
      for (var fh = 0; fh < FOUR_HUA.length; fh += 1) {
        var hits = sihuaKinds.filter(function (k) { return k === FOUR_HUA[fh]; }).length;
        if (hits !== 1) sihuaOk = false;
      }
    }
    if (!sihuaOk) {
      diagnostics.push(diag(
        "SIHUA_INCOMPLETE", "sihua",
        "生年四化必须是禄权科忌各一项，实际 " + JSON.stringify(sihuaKinds)
      ));
    }

    // 来源层自检：aiFacts 自己声称的校验状态必须通过，否则不必往上翻译
    var factsValidation = facts.validation || {};
    if (factsValidation.status !== "pass") {
      diagnostics.push(diag(
        "FACTS_VALIDATION_NOT_PASS", "aiFacts.validation",
        "事实层校验状态为 " + String(factsValidation.status)
      ));
    }
    var flyingValidation = facts.flyingValidation || {};
    if (flyingValidation.status !== "pass") {
      diagnostics.push(diag(
        "FLYING_VALIDATION_NOT_PASS", "aiFacts.flyingValidation",
        "飞星校验状态为 " + String(flyingValidation.status)
      ));
    }

    var periods = facts.periods || {};
    var current = periods.current || {};
    var fineTiming = facts.fineTiming || {};
    var fineCurrent = fineTiming.current || {};

    // 四层叠宫以流月层的 palaceOverlay 为唯一来源：它同一行里带齐
    // natal/decadal/annual/monthly（以及日、时，这两层被显式丢弃）。
    var decadalValidation = (periods.validation || {}).decadal || {};
    var annualValidation = (periods.validation || {}).annual || {};
    var monthlyValidation = (fineTiming.validation || {}).monthly || {};
    if (decadalValidation.status !== "pass") {
      diagnostics.push(diag("DECADAL_VALIDATION_NOT_PASS", "periods.validation.decadal",
        "大限层校验状态为 " + String(decadalValidation.status)));
    }
    if (annualValidation.status !== "pass") {
      diagnostics.push(diag("ANNUAL_VALIDATION_NOT_PASS", "periods.validation.annual",
        "流年层校验状态为 " + String(annualValidation.status)));
    }
    if (fineCurrent.monthly && monthlyValidation.status !== "pass") {
      diagnostics.push(diag("MONTHLY_VALIDATION_NOT_PASS", "fineTiming.validation.monthly",
        "流月层校验状态为 " + String(monthlyValidation.status)));
    }

    var palaceByBranch = {};
    if (isArray(palaces)) {
      palaces.forEach(function (palace) {
        if (palace && palace.earthlyBranch) palaceByBranch[palace.earthlyBranch] = palace;
      });
    }
    var fourLayer = buildFourLayerDieGong(
      fineCurrent.monthly && fineCurrent.monthly.palaceOverlay,
      palaceByBranch
    );
    // T2：来因宫固定 null，并说明原因，不给"看似确定"的宫位
    diagnostics.push(diag(
      "LAIYIN_EXCLUDED", "laiyinPalace",
      "SKILL 正文将来因宫列为「本定门高阶·本定版不引入」，而 §15 要求该键存在；" +
      "本项目不计算、不猜测，该字段不得用于断事"
    ));

    var chartInfo = {
      palaces: copyArray(palaces),
      sihua: sihua,
      selfTransform: copyArray(facts.selfTransformations),
      daxianSihua: periodFourHua(current.decadal),
      liunianSihua: periodFourHua(current.annual),
      dieGong: {
        decadal: periodOverlay(current.decadal),
        annual: periodOverlay(current.annual)
      },
      fourLayerDieGong: fourLayer,
      flyingChains: {
        palaceFlying: copyArray(facts.palaceFlying),
        jiChains: copyArray(facts.jiChains)
      },
      wuxingJu: basics.fiveElementsClass == null ? null : basics.fiveElementsClass,
      yearStem: facts.yearStem == null ? null : facts.yearStem,
      laiyinPalace: null
    };

    var requiredMissing = [];
    if (chartInfo.wuxingJu == null) {
      requiredMissing.push("wuxingJu");
      diagnostics.push(diag("WUXING_JU_MISSING", "wuxingJu", "basics 缺少 fiveElementsClass"));
    }
    if (chartInfo.yearStem == null) {
      requiredMissing.push("yearStem");
      diagnostics.push(diag("YEAR_STEM_MISSING", "yearStem", "aiFacts 缺少 yearStem"));
    } else if (TEN_STEMS.indexOf(chartInfo.yearStem) < 0) {
      requiredMissing.push("yearStem");
      diagnostics.push(diag("YEAR_STEM_INVALID", "yearStem",
        "yearStem 不是单个天干：" + String(chartInfo.yearStem)));
    } else {
      // 与**独立来源**对照：astrolabe.chineseDate 的年柱天干（不是从 aiFacts 自己取）
      var chineseDate = String((chart.astrolabe || {}).chineseDate || "").trim();
      var sourceStem = chineseDate ? chineseDate.split(/\s+/u)[0].charAt(0) : "";
      if (!sourceStem) {
        // 拿不到独立来源时不能声称已核对，但也不因此把整盘判死
        diagnostics.push(diag("YEAR_STEM_SOURCE_UNAVAILABLE", "yearStem",
          "无法从 astrolabe.chineseDate 取得生年干，来源未核对"));
        requiredMissing.push("yearStem");
      } else if (sourceStem !== chartInfo.yearStem) {
        requiredMissing.push("yearStem");
        diagnostics.push(diag("YEAR_STEM_MISMATCH", "yearStem",
          "aiFacts.yearStem=" + chartInfo.yearStem + " 与排盘来源 " + sourceStem + " 不一致"));
      }
    }
    if (!chartInfo.fourLayerDieGong) {
      requiredMissing.push("fourLayerDieGong");
      diagnostics.push(diag("FOUR_LAYER_UNAVAILABLE", "fourLayerDieGong",
        "四层叠宫不完整（需 12 行、地支唯一、四层宫名齐全）"));
    }
    // 数量门槛：12 宫 × 4 化 = 48 条宫干飞化；忌链每个生年忌一条起步
    var MIN_JI_CHAINS = 1;
    // 不是数够 48 条就行：必须 12 宫 × 4 化的组合**全覆盖且不重复**
    var palaceNames = {};
    (isArray(palaces) ? palaces : []).forEach(function (palace) {
      if (palace && palace.name) palaceNames[palace.name] = true;
    });
    var flyingKeys = {};
    var flyingDuplicate = false;
    var flyingIdentity = [];
    chartInfo.flyingChains.palaceFlying.forEach(function (edge) {
      var source = String((edge && edge.sourcePalace) || "");
      var kind = String((edge && edge.kind) || "");
      var key = source + "|" + kind;
      if (flyingKeys[key]) flyingDuplicate = true;
      flyingKeys[key] = true;
      // 起宫必须属于本盘十二宫、化类必须是禄权科忌、目标宫必须落在本盘
      if (!palaceNames[source]) flyingIdentity.push("起宫不在本盘：" + source);
      if (FOUR_HUA.indexOf(kind) < 0) flyingIdentity.push("化类非法：" + kind);
      var target = edge && edge.targetPalace;
      if (target != null && !palaceNames[target]) flyingIdentity.push("目标宫不在本盘：" + target);
      if (target == null) flyingIdentity.push("目标宫缺失：" + source + "|" + kind);
    });
    // 预期键集合由「本盘十二宫 × 四化」构造，逐键比对，不接受任意 48 条
    var expectedTensor = [];
    Object.keys(palaceNames).forEach(function (name) {
      FOUR_HUA.forEach(function (kind) { expectedTensor.push(name + "|" + kind); });
    });
    var missingKeys = expectedTensor.filter(function (key) { return !flyingKeys[key]; });
    var extraKeys = Object.keys(flyingKeys).filter(function (key) {
      return expectedTensor.indexOf(key) < 0;
    });
    var expectedFlying = 12 * FOUR_HUA.length;
    if (chartInfo.flyingChains.palaceFlying.length !== expectedFlying || flyingDuplicate
        || missingKeys.length || extraKeys.length || flyingIdentity.length) {
      requiredMissing.push("flyingChains.palaceFlying");
      diagnostics.push(diag("PALACE_FLYING_INCOMPLETE", "flyingChains.palaceFlying",
        "宫干飞化需与本盘十二宫×四化逐键一致：实际 " +
        chartInfo.flyingChains.palaceFlying.length + " 条 / 缺 " + missingKeys.length +
        " 键 / 多 " + extraKeys.length + " 键 / 重复=" + flyingDuplicate +
        " / 身份非法 " + flyingIdentity.length +
        (flyingIdentity.length ? "（" + flyingIdentity.slice(0, 3).join("；") + "）" : "")));
    }
    // 忌链实际字段是 startPalace + steps[{fromPalace,fromStem,star,toPalace}]，
    // 不是 sourcePalace/targetPalace。校验起点与至少一步可追溯。
    var TERMINATIONS = ["loop", "missing", "max-depth"];
    var jiStarts = {};
    var jiProblems = [];
    chartInfo.flyingChains.jiChains.forEach(function (chain, chainIndex) {
      var label = "chain[" + chainIndex + "]";
      if (!chain || !chain.startPalace) { jiProblems.push(label + " 缺起点"); return; }
      if (!palaceNames[chain.startPalace]) {
        jiProblems.push(label + " 起点不在本盘：" + chain.startPalace);
      }
      if (jiStarts[chain.startPalace]) jiProblems.push(label + " 起点重复：" + chain.startPalace);
      jiStarts[chain.startPalace] = true;
      if (TERMINATIONS.indexOf(chain.termination) < 0) {
        jiProblems.push(label + " 终止状态非法：" + String(chain.termination));
      }
      if (chain.termination === "loop" && !palaceNames[chain.loopPalace]) {
        jiProblems.push(label + " 成环点不在本盘：" + String(chain.loopPalace));
      }
      var steps = chain.steps;
      if (!isArray(steps) || !steps.length) { jiProblems.push(label + " 无步骤"); return; }
      var cursor = chain.startPalace;
      steps.forEach(function (step, stepIndex) {
        if (!step || !step.fromPalace || !step.toPalace || !step.star) {
          jiProblems.push(label + " 第 " + (stepIndex + 1) + " 步字段不全");
          return;
        }
        if (step.fromPalace !== cursor) {
          jiProblems.push(label + " 第 " + (stepIndex + 1) + " 步与前一步断开");
        }
        if (!palaceNames[step.fromPalace] || !palaceNames[step.toPalace]) {
          jiProblems.push(label + " 第 " + (stepIndex + 1) + " 步宫位不在本盘");
        }
        cursor = step.toPalace;
      });
    });
    if (chartInfo.flyingChains.jiChains.length < MIN_JI_CHAINS || jiProblems.length) {
      requiredMissing.push("flyingChains.jiChains");
      diagnostics.push(diag("JI_CHAINS_INVALID", "flyingChains.jiChains",
        "忌链不合格 " + jiProblems.length + " 处" +
        (jiProblems.length ? "：" + jiProblems.slice(0, 3).join("；") : "")));
    }
    // readiness 若声明了支持范围，飞化相关 scope 必须在其中
    var supported = (facts.readiness || {}).supportedScopes
      || (facts.readiness || {}).supported_scopes || [];
    if (isArray(supported) && supported.length) {
      var wanted = ["natal-palace-flying", "natal-ji-chains"];
      wanted.forEach(function (scope) {
        if (supported.indexOf(scope) < 0) {
          diagnostics.push(diag("SCOPE_NOT_DECLARED", "readiness.supportedScopes",
            "未声明支持 " + scope));
        }
      });
    }

    // 输入结构性错误 -> invalid；数据缺失/未通过校验 -> unavailable
    var invalidCodes = [
      "PALACE_COUNT_INVALID", "PALACE_ENTRY_INVALID",
      "PALACE_BRANCH_DUPLICATED", "SIHUA_INCOMPLETE",
      // 地支不在十二地支内属结构错：必须整盘 invalid，
      // 否则"非法地支 + 其他正常"仍会返回 ok
      "PALACE_BRANCH_INVALID",
      // 与独立来源（astrolabe.chineseDate）矛盾属于输入非法，不能降级成「数据缺失」
      "YEAR_STEM_MISMATCH"
    ];
    var unavailableCodes = [
      "WUXING_JU_MISSING", "YEAR_STEM_MISSING", "PALACE_FLYING_INSUFFICIENT",
      "JI_CHAINS_INVALID", "FACTS_VALIDATION_NOT_PASS", "FLYING_VALIDATION_NOT_PASS",
      "DECADAL_VALIDATION_NOT_PASS", "ANNUAL_VALIDATION_NOT_PASS",
      "MONTHLY_VALIDATION_NOT_PASS", "FOUR_LAYER_UNAVAILABLE", "SCOPE_NOT_DECLARED",
      "YEAR_STEM_INVALID", "YEAR_STEM_SOURCE_UNAVAILABLE"
    ];
    var hasInvalid = diagnostics.some(function (item) {
      return invalidCodes.indexOf(item.code) >= 0;
    });
    var hasUnavailable = requiredMissing.length > 0 || diagnostics.some(function (item) {
      return unavailableCodes.indexOf(item.code) >= 0;
    });

    var finalStatus = hasInvalid ? "invalid" : (hasUnavailable ? "unavailable" : "ok");

    return {
      status: finalStatus,
      schema: SCHEMA,
      chartInfo: finalStatus === "ok" ? chartInfo : null,
      requiredMissing: requiredMissing,
      diagnostics: diagnostics
    };
  }

  var api = {
    SCHEMA: SCHEMA,
    FOUR_LAYERS: FOUR_LAYERS.slice(),
    buildChartInfo: buildChartInfo
  };

  root.MingliChartInfo = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
