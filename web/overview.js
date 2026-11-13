/*
 * 一页速览：把八字与紫微已经算出来的东西排成「先看这三行，再看这一年」。
 *
 * 这里只做两件事：
 *   1. 取数：从 bazi 计算结果与 ziwei 计算结果里挑出人一眼要看的字段；
 *   2. 规则：按流年十神、地支关系、紫微流年四化落宫，给出六个领域的倾向句。
 *
 * 不写事件预告，不编造没有的事实：每条结论都带 basis（它凭什么这么说）。
 */
(function (global) {
  "use strict";

  const SCHEMA = "mingli.overview/v1";
  const ELEMENTS = ["木", "火", "土", "金", "水"];
  const ELEMENT_CLASS = { 木: "wood", 火: "fire", 土: "earth", 金: "metal", 水: "water" };
  const PILLARS = [
    ["year", "年柱"],
    ["month", "月柱"],
    ["day", "日柱"],
    ["hour", "时柱"]
  ];

  // 十神归族：比劫 / 食伤 / 财 / 官杀 / 印
  const TEN_GOD_FAMILY = {
    比肩: "peer", 劫财: "peer",
    食神: "output", 伤官: "output",
    偏财: "wealth", 正财: "wealth",
    七杀: "officer", 偏官: "officer", 正官: "officer",
    偏印: "resource", 正印: "resource", 枭神: "resource"
  };

  const FAMILY_LABEL = {
    peer: "比劫", output: "食伤", wealth: "财星", officer: "官杀", resource: "印星"
  };

  const CLASH_KINDS = new Set([
    "branch-six-clash", "stem-clash", "branch-punishment", "branch-harm", "branch-break"
  ]);
  const HARMONY_KINDS = new Set([
    "branch-six-combine", "branch-three-harmony", "branch-half-harmony",
    "stem-combine", "stem-three-combine", "branch-hidden-combine"
  ]);

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function familyOf(tenGod) {
    return TEN_GOD_FAMILY[text(tenGod)] || null;
  }

  function familyLabel(family) {
    return FAMILY_LABEL[family] || "";
  }

  function parseAgeRange(range) {
    const match = /^(\d+)\s*-\s*(\d+)/.exec(text(range));
    if (!match) return null;
    return { from: Number(match[1]), to: Number(match[2]) };
  }

  function birthYearOf(bazi) {
    const solar = text(bazi?.calculation?.calendar_display?.solar);
    const match = /^(\d{4})/.exec(solar);
    return match ? Number(match[1]) : null;
  }

  // ── 取数 ────────────────────────────────────────────────────────────────

  function chartOf(bazi) {
    const pillars = bazi?.calculation?.pillars || {};
    const list = PILLARS.map(([key, label]) => {
      const pillar = pillars[key] || {};
      return {
        key,
        label,
        ganzhi: text(pillar.ganzhi),
        stem: text(pillar.stem),
        branch: text(pillar.branch),
        tenGod: text(pillar.ten_god),
        hidden: asArray(pillar.hidden_stems).map(item => ({
          stem: text(item.stem),
          element: text(item.element),
          tenGod: text(item.ten_god),
          role: text(item.role)
        }))
      };
    });
    const day = list.find(item => item.key === "day") || {};
    const month = pillars.month || {};
    const aux = bazi?.ai_facts?.auxiliary_chart || {};
    const auxiliaryValue = entry => {
      if (!entry) return [];
      if (Array.isArray(entry)) return entry.map(text);
      if (typeof(entry) === "object" && entry.value != null) {
        return Array.isArray(entry.value) ? entry.value.map(text) : [text(entry.value)];
      }
      return [];
    };
    list.forEach(pillar => {
      const raw = pillars[pillar.key] || {};
      const primary = pillar.hidden[0];
      pillar.branchGod = primary ? primary.tenGod : "";
      pillar.stage = text(raw.day_master_life_stage);
      const nayinEntry = (aux.nayin || {})[pillar.key];
      pillar.nayin = text(nayinEntry && typeof nayinEntry === "object" ? nayinEntry.value : nayinEntry);
      pillar.xunkong = auxiliaryValue((aux.xunkong || {})[pillar.key]);
      pillar.stemElement = text(raw.stem_element);
      pillar.branchElement = text(raw.branch_element);
      pillar.sitting = text(raw.stem_life_stage);
    });
    return {
      pillars: list,
      dayMaster: {
        stem: text(day.stem),
        element: text(month.stem_element) === "" ? "" : text(day.stem_element) || elementOfStem(text(day.stem)),
        tenGodOfMonth: text(month.ten_god)
      },
      monthCommand: {
        branch: text(month.branch),
        element: text(month.branch_element)
      },
      solar: text(bazi?.calculation?.calendar_display?.solar),
      lunar: text(bazi?.calculation?.calendar_display?.lunar)
    };
  }

  // 天干五行只在引擎没给时才用，避免把「甲=木」写死在结论里当事实。
  function elementOfStem(stem) {
    const map = { 甲: "木", 乙: "木", 丙: "火", 丁: "火", 戊: "土", 己: "土", 庚: "金", 辛: "金", 壬: "水", 癸: "水" };
    return map[stem] || "";
  }

  function elementOfBranch(branch) {
    const map = { 子: "水", 丑: "土", 寅: "木", 卯: "木", 辰: "土", 巳: "火", 午: "火", 未: "土", 申: "金", 酉: "金", 戌: "土", 亥: "水" };
    return map[branch] || "";
  }

  const ELEMENT_GENERATES = { 木: "火", 火: "土", 土: "金", 金: "水", 水: "木" };
  const ELEMENT_CONTROLS = { 木: "土", 土: "水", 水: "火", 火: "金", 金: "木" };

  // 旺相休囚死：当令者旺、令生者相、生令者休、克令者囚、令克者死。
  function stateOf(element, monthCommand) {
    if (!element || !monthCommand) return "";
    if (element === monthCommand) return "旺";
    if (ELEMENT_GENERATES[monthCommand] === element) return "相";
    if (ELEMENT_GENERATES[element] === monthCommand) return "休";
    if (ELEMENT_CONTROLS[element] === monthCommand) return "囚";
    if (ELEMENT_CONTROLS[monthCommand] === element) return "死";
    return "";
  }

  function elementsOf(facts) {
    const counts = facts?.element_inventory?.counts || {};
    const weights = {};
    ELEMENTS.forEach(element => { weights[element] = 0; });
    const add = (group, factor) => {
      const bucket = counts[group];
      if (!bucket || typeof bucket !== "object") return;
      ELEMENTS.forEach(element => {
        const value = Number(bucket[element]);
        if (Number.isFinite(value)) weights[element] += value * factor;
      });
    };
    add("visible_stems", 1);
    add("branch_primary_elements", 1);
    add("hidden_stems_nominal_weight", 1);
    const total = ELEMENTS.reduce((sum, element) => sum + weights[element], 0);
    const monthCommand = text(facts?.element_inventory?.month_command?.primary_element);
    return ELEMENTS.map(element => ({
      element,
      className: ELEMENT_CLASS[element],
      weight: Math.round(weights[element] * 100) / 100,
      percent: total > 0 ? Math.round((weights[element] / total) * 1000) / 10 : 0,
      state: stateOf(element, monthCommand)
    }));
  }

  function structureOf(bazi) {
    const rules = bazi?.ai_facts?.derived_rules || {};
    const strength = rules.strength || {};
    const pattern = rules.pattern || {};
    const useful = rules.useful_elements?.resolution || {};
    const axes = rules.useful_elements?.axes || {};
    const climate = rules.climate_adjustment || {};
    const primary = asArray(useful.selectedCandidateElements);
    const fallbackPrimary = ELEMENTS.filter(element =>
      asArray(axes.balance?.primaryElements).includes(element)
    );
    const secondary = asArray(useful.crossAxisConsensusElements).length
      ? []
      : ELEMENTS.filter(element => asArray(axes.balance?.secondaryElements).includes(element));
    return {
      strength: {
        label: text(strength.conclusion) || "未判定",
        band: text(strength.band),
        supportRatio: Number.isFinite(Number(strength.supportRatio)) ? Number(strength.supportRatio) : null
      },
      pattern: {
        name: text(pattern.primaryCandidate) || "未成格",
        candidates: asArray(pattern.candidates).map(item => text(item.name)).filter(Boolean)
      },
      useful: {
        primary: primary.length ? primary : fallbackPrimary,
        secondary,
        avoid: asArray(useful.excludedConflictElements).length
          ? asArray(useful.excludedConflictElements)
          : ELEMENTS.filter(element => asArray(axes.balance?.avoidElements).includes(element)),
        basis: text(useful.selectionBasis) || text(useful.status)
      },
      climate: {
        label: text(climate.conclusion) || text(climate.status) || "",
        elements: asArray(climate.primaryElements)
      }
    };
  }

  function palaceOf(ziwei, name) {
    return asArray(ziwei?.palaces).find(palace => text(palace.name) === name) || null;
  }

  function palaceBrief(ziwei, name) {
    const palace = palaceOf(ziwei, name);
    if (!palace) return null;
    const majors = asArray(palace.majorStars).map(star => ({
      name: text(star.name),
      brightness: text(star.brightness),
      transformation: text(star.transformation) || null
    }));
    return {
      palace: text(palace.name),
      branch: text(palace.earthlyBranch),
      stem: text(palace.heavenlyStem),
      stars: majors,
      empty: majors.length === 0,
      borrowed: asArray(palace.borrowedMajorStars).map(star => text(star.name))
    };
  }

  function palacesOf(ziwei) {
    const basics = ziwei?.basics || {};
    const periods = ziwei?.aiFacts?.periods || {};
    const selfTransformRows = asArray(ziwei?.aiFacts?.selfTransformations);
    const soul = palaceBrief(ziwei, "命宫") || {
      palace: "命宫",
      branch: text(basics.soulPalaceBranch),
      stars: [],
      empty: true,
      borrowed: []
    };
    let body = palaceBrief(ziwei, "身宫");
    if (!body && basics.bodyPalaceBranch) {
      const same = asArray(ziwei?.palaces).find(palace => text(palace.earthlyBranch) === text(basics.bodyPalaceBranch));
      if (same) body = palaceBrief(ziwei, text(same.name));
    }
    return {
      soul,
      body,
      fiveElementsClass: text(basics.fiveElementsClass),
      soulRuler: text(basics.soulRuler),
      bodyRuler: text(basics.bodyRuler),
      zodiac: text(basics.zodiac),
      originalPalace: basics.originalPalace
        ? {
          palace: text(basics.originalPalace.palace),
          branch: text(basics.originalPalace.branch),
          stem: text(basics.originalPalace.stem)
        }
        : null,
      // 12 宫按固定方位摆放，前端画 4×4 方盘用。
      // 每格除了主星，还要带大限岁数、十二长生、神煞、流年岁数——
      // 这是参考小程序的排法：一格之内把「这一宫十年、一年、一生」的坐标都放全。
      ring: asArray(ziwei?.palaces).map(palace => {
        const branch = text(palace.earthlyBranch);
        const cycles = palace.cycles || {};
        const overlay = asArray(periods?.annual?.palaceOverlay)
          .find(row => text(row.branch) === branch) || null;
        return {
          name: text(palace.name),
          branch,
          stem: text(palace.heavenlyStem),
          isBody: Boolean(palace.isBodyPalace),
          majors: asArray(palace.majorStars).map(star => ({
            name: text(star.name),
            brightness: text(star.brightness),
            transformation: text(star.transformation) || null
          })),
          minorNames: asArray(palace.minorStars).map(star => text(star.name)).filter(Boolean),
          auxNames: asArray(palace.auxiliaryStars).map(star => text(star.name)).filter(Boolean),
          selfTransforms: selfTransformsOf(selfTransformRows, text(palace.name)),
          ages: asArray(palace.ages).map(Number).filter(Number.isFinite),
          minorLimitAges: asArray(palace.minorLimitAges).map(Number).filter(Number.isFinite),
          changsheng: text(cycles.changsheng12) || null,
          shensha: [text(cycles.suiqian12), text(cycles.boshi12)].filter(Boolean),
          periodPalace: overlay ? text(overlay.periodPalace) || null : null,
          isPeriodSoul: Boolean(overlay && text(overlay.periodPalace) === "命宫"),
          isDecadalSoul: Boolean(overlay && text(overlay.decadalPalace) === "命宫"),
          decadal: palace.decadal ? {
            from: palace.decadal.fromAge ?? palace.decadal.range?.[0] ?? null,
            to: palace.decadal.toAge ?? palace.decadal.range?.[1] ?? null,
            ganzhi: text(palace.decadal.ganzhi)
              || (text(palace.decadal.heavenlyStem) + text(palace.decadal.earthlyBranch))
          } : null
        };
      })
    };
  }

  // 本宫自化：只取「落在本宫自己身上」的两条（↑ 禄入、↓ 忌出），
  // 因为方盘一格放不下十二宫之间的全部飞化，格子里只留本宫记号；
  // 完整的飞化链条在下面的紫微细节里照旧能看到。
  function selfTransformsOf(rows, palaceName) {
    if (!palaceName) return [];
    return asArray(rows)
      .filter(row => text(row.palace) === palaceName)
      .map(row => ({
        kind: text(row.kind),
        star: text(row.star),
        symbol: text(row.symbol) || (text(row.direction) === "inward" ? "↑" : "↓")
      }))
      .slice(0, 2);
  }

  function annualCycleOf(bazi, year) {
    const cycles = asArray(bazi?.ai_facts?.annual_cycles);
    return cycles.find(item => Number(item.year) === Number(year)) || null;
  }

  function luckCycleOf(bazi, age) {
    const cycles = asArray(bazi?.ai_facts?.luck_cycles);
    if (!Number.isFinite(age)) return null;
    return cycles.find(item => {
      const range = parseAgeRange(item.age_range);
      return range && age >= range.from && age <= range.to;
    }) || null;
  }

  function ziweiAnnualOf(ziwei, year) {
    const annual = ziwei?.aiFacts?.periods?.current?.annual || null;
    if (!annual || Number(annual.year) !== Number(year)) return null;
    return {
      year: Number(annual.year),
      ganzhi: text(annual.ganzhi),
      fourHua: asArray(annual.fourTransformations).map(item => ({
        kind: text(item.kind),
        star: text(item.star),
        natalPalace: text(item.natalPalace),
        natalPalaceBranch: text(item.natalPalaceBranch),
        periodPalace: text(item.periodPalace),
        evidenceId: text(item.evidenceId)
      }))
    };
  }

  function relationsOf(annual) {
    const relations = asArray(annual?.relations_to_natal);
    const clashes = relations.filter(item => CLASH_KINDS.has(text(item.kind)));
    const harmonies = relations.filter(item => HARMONY_KINDS.has(text(item.kind)));
    const label = item => {
      const values = asArray(item.values).map(text).join("、");
      const participants = asArray(item.participants).map(text);
      const target = participants.find(name => name !== `annual-${annual?.year}` && name !== "annual");
      const targetLabel = { year: "年支", month: "月支", day: "日支", hour: "时支" }[target] || target || "原局";
      return { kind: text(item.kind), target: targetLabel, values };
    };
    return {
      clashes: clashes.map(label),
      harmonies: harmonies.map(label)
    };
  }

  function yearOf(bazi, ziwei, year, sex) {
    const yearNumber = Number(year) || Number(ziweiAnnualOf(ziwei, year)?.year) || null;
    const annual = annualCycleOf(bazi, yearNumber);
    const birthYear = birthYearOf(bazi);
    const age = birthYear && yearNumber ? yearNumber - birthYear + 1 : null;
    const luck = luckCycleOf(bazi, age);
    const relations = relationsOf(annual);
    return {
      year: yearNumber,
      ganhzi: text(annual?.ganzhi),
      ganzhi: text(annual?.ganzhi),
      tenGod: text(annual?.ten_god),
      tenGodFamily: familyOf(annual?.ten_god),
      age,
      sex: text(sex),
      luck: luck ? {
        sequence: text(luck.sequence),
        ageRange: text(luck.age_range),
        ganzhi: text(luck.ganzhi),
        tenGod: text(luck.ten_god),
        tenGodFamily: familyOf(luck.ten_god)
      } : null,
      clashes: relations.clashes,
      harmonies: relations.harmonies,
      ziwei: ziweiAnnualOf(ziwei, yearNumber)
    };
  }

  // ── 六领域规则 ──────────────────────────────────────────────────────────
  // 每个领域只说「这一年这类事更容易被推到台面」，并给出可观察的表现与做法；
  // 判断依据来自流年十神、地支关系与紫微流年四化，逐条写进 basis。

  const DOMAINS = [
    { key: "career", label: "事业节奏" },
    { key: "relationship", label: "关系与相处" },
    { key: "wealth", label: "钱财进出" },
    { key: "health", label: "身心状态" },
    { key: "home", label: "家里的事" },
    { key: "growth", label: "学习与调整" }
  ];

  const TEN_GOD_TEXT = {
    officer: {
      headline: "责任被推到台前",
      detail: "流年落在官杀一类，事情更像「有人把事情交到你手上」：机会与压力是同一件事，先把职责边界写清楚再答应。"
    },
    wealth: {
      headline: "资源与结果是主线",
      detail: "流年落在财星一类，注意力和时间更容易花在「做出结果、换到资源」上；同时要把支出和承诺分开记。"
    },
    output: {
      headline: "表达与产出更顺",
      detail: "流年落在食伤一类，适合把想法做成可以拿给别人看的东西；说话比平时更容易被听见，也更容易说过头。"
    },
    resource: {
      headline: "适合补基础",
      detail: "流年落在印星一类，适合学东西、考证、把旧事收尾；不急着开新战场，先把底子补厚。"
    },
    peer: {
      headline: "同侪与竞争同框",
      detail: "流年落在比劫一类，同行、同事、朋友的动静会变多；合作先把分工和钱的算法说清楚。"
    }
  };

  function pushBasis(list, item) {
    if (!item) return;
    const value = text(item);
    if (value && !list.includes(value)) list.push(value);
  }

  function domainCards(model) {
    const year = model.year || {};
    const palaces = model.palaces || {};
    const family = year.tenGodFamily;
    const tenGodText = TEN_GOD_TEXT[family] || null;
    const cards = [];
    const basisBase = [];
    if (year.ganzhi) pushBasis(basisBase, `流年${year.ganzhi}${year.tenGod ? ` · ${year.tenGod}` : ""}`);
    if (year.luck) pushBasis(basisBase, `大限${year.luck.ganzhi}${year.luck.tenGod ? ` · ${year.luck.tenGod}` : ""}`);

    const yearStemElement = elementOfStem(text(model.year?.ganzhi).slice(0, 1));
    const usefulPrimary = asArray(model.structure?.useful?.primary);
    const usefulAvoid = asArray(model.structure?.useful?.avoid);
    const stemElementBasis = yearStemElement
      ? `流年天干属${yearStemElement}（${usefulPrimary.includes(yearStemElement) ? "喜用" : usefulAvoid.includes(yearStemElement) ? "偏忌" : "中性"}）`
      : "";
    const clashTargets = new Set(asArray(year.clashes).map(item => item.target));
    const harmonyTargets = new Set(asArray(year.harmonies).map(item => item.target));
    const huaTargets = new Map();
    asArray(year.ziwei?.fourHua).forEach(item => {
      huaTargets.set(item.kind, item);
    });

    const clone = extra => basisBase.concat(extra);

    // 事业：官杀/印/食伤各自的口径 + 流年冲年支（外部环境）
    {
      const basis = clone([]);
      let headline = tenGodText?.headline || "按部就班推进";
      let detail = tenGodText?.detail || "这一年没有特别集中的十神主题，事业更适合延续原来的节奏，把手上事做扎实。";
      if (family === "officer") headline = "责任被推到台前";
      if (clashTargets.has("年支")) {
        pushBasis(basis, "流年冲年支，外部环境容易改规则");
        detail += " 另外流年冲年支，外部规则或上级安排容易变，别把计划写得太死。";
      }
      const ji = huaTargets.get("忌");
      if (ji && ["官禄宫", "命宫"].includes(ji.periodPalace)) {
        pushBasis(basis, `紫微流年忌入${ji.periodPalace}（${ji.star}）`);
        detail += " 紫微这一年的忌落在官禄/命宫，工作上的消耗感会更明显，留出返工时间。";
        headline = "任务重、返工多";
      }
      cards.push({ key: "career", label: "事业节奏", tone: family === "officer" || huaTargets.has("忌") ? "caution" : "neutral", headline, detail, basis });
    }

    // 关系：男看财、女看官；再看夫妻宫是否被冲/被化忌
    {
      const basis = clone([]);
      let headline = "关系维持原有节奏";
      let detail = "这一年关系不是最突出的一条线，按平时的相处方式走即可。";
      const partnerFamily = model.sex === "female" ? "officer" : "wealth";
      if (family === partnerFamily) {
        headline = "关系的议题会被提起";
        detail = "流年落在伴侣星的族类上，关于「要不要更近一步 / 怎么分配时间」的话题更容易出现；先把期待讲明白，比猜更省事。";
        pushBasis(basis, `流年${year.tenGod}属${familyLabel(family)}，是伴侣星所在族类`);
      }
      const ji = huaTargets.get("忌");
      const lu = huaTargets.get("禄");
      if (ji && ["夫妻宫", "交友宫"].includes(ji.periodPalace)) {
        pushBasis(basis, `紫微流年忌入${ji.periodPalace}（${ji.star}）`);
        headline = "相处里容易起摩擦";
        detail = "紫微这一年的忌落在夫妻/交友宫，摩擦多半来自「表达方式」而不是事情本身；重要的话当面说。";
      } else if (lu && ["夫妻宫", "交友宫"].includes(lu.periodPalace)) {
        pushBasis(basis, `紫微流年禄入${lu.periodPalace}（${lu.star}）`);
        headline = "人缘与关系更顺";
        detail = "紫微这一年的禄落在夫妻/交友宫，认识新朋友、把关系往前推都比平时容易。";
      }
      if (clashTargets.has("日支")) {
        pushBasis(basis, "流年冲日支（夫妻宫位）");
        if (headline === "关系维持原有节奏") {
          headline = "相处节奏容易被打断";
          detail = "流年冲日支，关系里的节奏容易被外部安排打断；不是谁的错，先把时间对上再谈情绪。";
        } else if (headline === "人缘与关系更顺") {
          // 禄与冲同时出现时不能只说好的一面。
          headline = "关系有推进也有打断";
          detail = "紫微这一年的禄落在夫妻/交友宫，认识人、把关系往前推都容易；但流年冲日支，节奏容易被外部安排打断，别在赶时间的时候谈重要的事。";
        } else {
          detail += " 流年冲日支，相处节奏容易被打断，别在情绪高点做决定。";
        }
      }
      if (harmonyTargets.has("日支")) {
        pushBasis(basis, "流年合日支（夫妻宫位）");
        detail += " 流年合日支，关系上有推进的机会，适合把话说开。";
      }
      cards.push({ key: "relationship", label: "关系与相处", tone: headline.includes("摩擦") ? "caution" : headline.includes("顺") || headline.includes("提起") ? "opportunity" : "neutral", headline, detail, basis });
    }

    // 钱财：财星族类 + 忌/禄入财帛、田宅
    {
      const basis = clone([]);
      let headline = "收支按常态走";
      let detail = "这一年钱的主题不突出，维持原来的预算结构即可。";
      if (family === "wealth") {
        headline = "进出的账要分开记";
        detail = "流年落在财星一类，机会和开销会同时变多；把「收入增长」和「支出升级」分开看，别用一笔流水判断全年。";
        pushBasis(basis, `流年${year.tenGod}属财星`);
      }
      if (family === "peer" || family === "resource") {
        headline = "以守为主";
        detail = "流年落在比劫/印星一类，钱更适合放在已有安排里；大额支出先放一晚再决定。";
      }
      if (stemElementBasis) pushBasis(basis, stemElementBasis);
      if (yearStemElement && usefulPrimary.includes(yearStemElement) && headline === "收支按常态走") {
        headline = "进项更有支撑";
        detail = "流年天干落在喜用五行上，同样的努力更容易换来资源；把多出来的部分存起来，而不是同步抬高开销。";
      }
      const ji = huaTargets.get("忌");
      if (ji && ["财帛宫", "田宅宫"].includes(ji.periodPalace)) {
        pushBasis(basis, `紫微流年忌入${ji.periodPalace}（${ji.star}）`);
        headline = "支出容易超预期";
        detail = "紫微这一年的忌落在财帛/田宅宫，先留一笔应急，再谈投资或大件。";
      }
      cards.push({ key: "wealth", label: "钱财进出", tone: headline.includes("超预期") ? "caution" : "neutral", headline, detail, basis });
    }

    // 健康：忌入疾厄/冲命，或十神属官杀（耗）
    {
      const basis = clone([]);
      let headline = "作息是主轴";
      let detail = "这一年没有明显的健康提示，照常睡眠与运动即可。";
      const ji = huaTargets.get("忌");
      if (ji && ["疾厄宫", "命宫"].includes(ji.periodPalace)) {
        pushBasis(basis, `紫微流年忌入${ji.periodPalace}（${ji.star}）`);
        headline = "体力容易被透支";
        detail = "紫微这一年的忌落在疾厄/命宫，疲惫会来得比平时早；把休息当成日程的一部分，而不是剩余时间。";
      }
      if (family === "officer") {
        pushBasis(basis, "流年官杀主压力");
        detail += " 官杀年份压力偏大，注意肩颈与睡眠。";
      }
      cards.push({ key: "health", label: "身心状态", tone: headline.includes("透支") ? "caution" : "neutral", headline, detail, basis });
    }

    // 家里：忌入田宅/父母/子女，或冲月支（家庭宫位）
    {
      const basis = clone([]);
      let headline = "家里的事按计划走";
      let detail = "这一年家庭议题不突出，维持原有安排即可。";
      const ji = huaTargets.get("忌");
      if (ji && ["田宅宫", "父母宫", "子女宫"].includes(ji.periodPalace)) {
        pushBasis(basis, `紫微流年忌入${ji.periodPalace}（${ji.star}）`);
        headline = "家里的事需要你出面";
        detail = "紫微这一年的忌落在田宅/父母/子女宫，家里容易有事需要你协调；提前把时间留出来。";
      }
      if (clashTargets.has("月支")) {
        pushBasis(basis, "流年冲月支（家庭与工作交界）");
        detail += " 流年冲月支，家里与工作的安排容易互相挤，先排好优先级。";
      }
      cards.push({ key: "home", label: "家里的事", tone: headline.includes("出面") ? "caution" : "neutral", headline, detail, basis });
    }

    // 学习与调整：印星 / 化科入命或官禄
    {
      const basis = clone([]);
      let headline = "把节奏调回来";
      let detail = "这一年适合做小幅度调整：换习惯、补短板，比大改更划算。";
      if (family === "resource") {
        headline = "适合补课与考证";
        detail = "流年落在印星一类，学习、资格、手续类的事更容易推进；挑一件能长期用的本事。";
        pushBasis(basis, `流年${year.tenGod}属印星`);
      }
      if (stemElementBasis) pushBasis(basis, stemElementBasis);
      if (yearStemElement && usefulPrimary.includes(yearStemElement) && headline === "把节奏调回来") {
        headline = "适合把基础打厚";
        detail = "流年天干落在喜用五行上，学东西的回报率比平时高；选一项能持续用三年的技能。";
      }
      const ke = huaTargets.get("科");
      if (ke && ["命宫", "官禄宫"].includes(ke.periodPalace)) {
        pushBasis(basis, `紫微流年科入${ke.periodPalace}（${ke.star}）`);
        headline = "适合被看见";
        detail = "紫微这一年的科落在命/官禄宫，适合把成果整理出来给别人看：投稿、汇报、面试都算。";
      }
      cards.push({ key: "growth", label: "学习与调整", tone: headline.includes("补课") || headline.includes("看见") ? "opportunity" : "neutral", headline, detail, basis });
    }

    return cards.map(card => ({
      ...card,
      basis: card.basis.length ? card.basis : basisBase.slice()
    }));
  }

  // ── 组装 ────────────────────────────────────────────────────────────────

  function build(input) {
    const bazi = input?.bazi || null;
    const ziwei = input?.ziwei || null;
    const sex = text(input?.sex || input?.profile?.sex_for_calculation);
    if (!bazi && !ziwei) {
      return { schema: SCHEMA, status: "unavailable", reason: "还没有排盘结果" };
    }
    const year = Number(input?.year) || new Date().getFullYear();
    const model = {
      schema: SCHEMA,
      status: "ok",
      sex,
      chart: bazi ? chartOf(bazi) : null,
      elements: bazi ? elementsOf(bazi.ai_facts || {}) : [],
      structure: bazi ? structureOf(bazi) : null,
      palaces: ziwei ? palacesOf(ziwei) : null,
      year: yearOf(bazi, ziwei, year, sex)
    };
    model.domains = domainCards(model);
    // 年份清单要先建：下面的「往后几年」和范围判断都拿它当边界。
    model.yearOptions = Array.isArray(bazi?.ai_facts?.annual_cycles)
      ? bazi.ai_facts.annual_cycles.map(item => Number(item.year)).filter(Number.isFinite)
      : [];
    model.outlook = outlookOf(model, bazi, ziwei, sex);
    model.centers = ziwei ? centersOf(ziwei, sex) : null;
    // 年份下拉只能选算过的年份；调用方偶尔会塞一个范围外的年份进来
    // （比如 URL 参数或年度报告点名），这时要说清楚「没算」，而不是画一张空盘。
    model.yearCoverage = {
      inRange: model.yearOptions.length ? model.yearOptions.includes(Number(model.year.year)) : false,
      first: model.yearOptions.length ? Math.min(...model.yearOptions) : null,
      last: model.yearOptions.length ? Math.max(...model.yearOptions) : null
    };
    return model;
  }

  // 往后几年：用同一套领域规则逐年算一遍，只留三句最常用的
  //（事业 / 关系 / 钱财）。这一块是「今年怎么样、明年怎么样」的直接回答，
  // 不用等模型；每句仍带依据，和上面六张卡是同一套判断。
  const OUTLOOK_FIELDS = ["career", "relationship", "wealth"];
  const OUTLOOK_YEARS = 5;

  // 能画几年的前提是「那几年的流年已经算好」。盘按「重点年份」算到哪一年为止，
  // 所以这里先取窗口：从当前这年往后数，能取几年取几年；不够 5 年就往前补。
  // 不编没算过的年份——宁可只画 3 年，也不画一条看起来正常的空行。
  function outlookWindow(yearOptions, focus) {
    const list = asArray(yearOptions).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!list.length || !Number.isFinite(focus)) return [];
    const forward = list.filter(year => year >= focus).slice(0, OUTLOOK_YEARS);
    if (forward.length >= OUTLOOK_YEARS) return forward;
    const back = list.filter(year => year < focus).slice(-(OUTLOOK_YEARS - forward.length));
    return back.concat(forward);
  }

  function outlookOf(model, bazi, ziwei, sex) {
    const focus = Number(model.year?.year) || null;
    const years = outlookWindow(model.yearOptions, focus);
    if (years.length < 2) return [];
    return years.map(year => {
      const probe = { ...model, year: yearOf(bazi, ziwei, year, sex) };
      const cards = domainCards(probe);
      const pick = key => {
        const card = cards.find(item => item.key === key);
        return card ? { key: card.key, label: card.label, headline: card.headline, tone: card.tone } : null;
      };
      return {
        year,
        ganzhi: probe.year.ganzhi,
        tenGod: probe.year.tenGod,
        age: probe.year.age,
        luck: probe.year.luck ? { ganzhi: probe.year.luck.ganzhi, ageRange: probe.year.luck.ageRange } : null,
        items: OUTLOOK_FIELDS.map(pick).filter(Boolean)
      };
    });
  }

  // 方盘中间 2×2：放「这是谁的盘」的坐标（几局、什么性别、四柱、农历、公历）。
  // 参考小程序也把这些放在正中，因为四周十二宫只有位置，没有身份。
  function centersOf(ziwei, sex) {
    const display = ziwei?.calendarDisplay || {};
    const dual = ziwei?.dualFourPillars || {};
    const pillars = asArray(dual.solarTermPillars).map(text).join(" ");
    return {
      gender: { male: "男", female: "女" }[text(sex)] || text(sex),
      pillars,
      lunar: text(display.lunar),
      solar: text(display.solar),
      time: text(display.time)
    };
  }

  // ── 渲染（返回 HTML 字符串，便于测试）────────────────────────────────

  function escapeHtml(value) {
    return text(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function elementTagClass(element) {
    return ELEMENT_CLASS[element] ? ` el-${ELEMENT_CLASS[element]}` : "";
  }

  // 四柱表：干神 / 天干 / 地支 / 藏干 / 支神 / 纳音 / 空亡 / 地势。
  // 右边再接两列「大运」「流年」——参考小程序的排法：
  // 一横排把「本命四柱 + 眼下十年 + 这一年」放在同一张表里，从上往下读一遍就串起来了。
  function renderChart(model) {
    if (!model.chart) return "";
    const pillars = model.chart.pillars.slice();
    const extra = [];
    const year = model.year || {};
    if (year.luck && year.luck.ganzhi) {
      extra.push({
        label: "大运",
        ganzhi: year.luck.ganzhi,
        tenGod: year.luck.tenGod,
        ageRange: year.luck.ageRange
      });
    }
    if (year.ganzhi) {
      extra.push({ label: "流年", ganzhi: year.ganzhi, tenGod: year.tenGod, ageRange: year.age ? `${year.age} 岁` : "" });
    }
    extra.forEach(item => {
      const chars = Array.from(item.ganzhi);
      pillars.push({
        key: "extra",
        label: item.label,
        ganzhi: item.ganzhi,
        stem: chars[0] || "",
        branch: chars[1] || "",
        tenGod: item.tenGod || "",
        hidden: [],
        branchGod: "",
        ageRange: item.ageRange || "",
        nayin: "",
        xunkong: [],
        stage: "",
        stemElement: elementOfStem(chars[0] || ""),
        branchElement: elementOfBranch(chars[1] || ""),
        isExtra: true
      });
    });
    // 大运/流年两列只有干支与十神，其余几行留空而不是画一排「—」：
    // 一排短横会让人以为「这里缺数据」，实际是这两列本来就没有藏干/纳音/空亡。
    const cell = (pillar, value, extra2 = "") =>
      pillar && pillar.isExtra && !text(value)
        ? `<span class="ov-tcell ov-tcell-blank${extra2}"></span>`
        : `<span class="ov-tcell${extra2}">${escapeHtml(value) || "—"}</span>`;
    const colored = (pillar, value, element) => cell(pillar, value, ` ov-char${elementTagClass(element)}`);
    const row = (label, items, className = "") =>
      `<div class="ov-trow${className} cols-${pillars.length}"><span class="ov-tlabel">${label}</span>${items.join("")}</div>`;
    const head = `<div class="ov-trow is-head cols-${pillars.length}"><span class="ov-tlabel"></span>${pillars
      .map(pillar => `<span class="ov-tcell${pillar.isExtra ? " is-extra" : ""}">${escapeHtml(pillar.label)}</span>`)
      .join("")}</div>`;
    const rows = [
      row("干神", pillars.map(pillar => cell(pillar, pillar.tenGod))),
      row("天干", pillars.map(pillar => colored(pillar, pillar.stem, pillar.stemElement)), " is-strong"),
      row("地支", pillars.map(pillar => colored(pillar, pillar.branch, pillar.branchElement)), " is-strong"),
      row("藏干", pillars.map(pillar => {
        if (!pillar.hidden.length) return cell(pillar, "");
        return `<span class="ov-tcell ov-hidden">${pillar.hidden
          .map(item => `${escapeHtml(item.stem)}<small>${escapeHtml(item.tenGod)}</small>`)
          .join("")}</span>`;
      })),
      row("支神", pillars.map(pillar => cell(pillar, pillar.branchGod))),
      row("纳音", pillars.map(pillar => cell(pillar, pillar.nayin))),
      row("空亡", pillars.map(pillar => cell(pillar, pillar.xunkong.join("")))),
      row("地势", pillars.map(pillar => cell(pillar, pillar.stage))),
      // 「行运」这行只给大运/流年写岁数，四柱那四格留白：
      // 本命柱的岁数没有意义，写「—」反而像缺数据。
      row("行运", pillars.map(pillar => (pillar.isExtra
        ? cell(pillar, pillar.ageRange)
        : `<span class="ov-tcell ov-tcell-blank"></span>`)))
    ].join("");
    const useful = model.structure?.useful || { primary: [], secondary: [], avoid: [] };
    const chips = list => list.map(item => `<span class="ov-chip">${escapeHtml(item)}</span>`).join("");
    const elements = (model.elements || []).map(item => `
      <li class="ov-element ov-element-${escapeHtml(item.className)}">
        <span class="ov-element-name">${escapeHtml(item.element)}${item.state ? `<small>${escapeHtml(item.state)}</small>` : ""}</span>
        <span class="ov-element-bar"><b style="width:${Math.max(2, Math.min(100, item.percent))}%"></b></span>
        <span class="ov-element-percent">${item.percent}%</span>
      </li>`).join("");
    return `
      <div class="ov-chart">
        <div class="ov-table">${head}${rows}</div>
        <p class="ov-chart-meta">${escapeHtml(model.chart.solar)}${model.chart.lunar ? ` · 农历 ${escapeHtml(model.chart.lunar)}` : ""}</p>
        <p class="ov-chart-line">日主 <strong>${escapeHtml(model.chart.dayMaster.stem)}${escapeHtml(model.chart.dayMaster.element)}</strong>${model.structure ? ` · ${escapeHtml(model.structure.strength.label)} · ${escapeHtml(model.structure.pattern.name)}` : ""}</p>
        <ul class="ov-elements">${elements}</ul>
        <p class="ov-useful">喜用 ${chips(useful.primary) || "<span class=\"ov-muted\">未定</span>"}${useful.avoid.length ? ` <span class="ov-muted">少用</span> ${chips(useful.avoid)}` : ""}</p>
      </div>`;
  }

  function renderPalaces(model) {
    if (!model.palaces) return "";
    const soul = model.palaces.soul;
    const body = model.palaces.body;
    const original = model.palaces.originalPalace;
    const starLine = palace => palace && palace.stars.length
      ? palace.stars.map(star => `${star.name}${star.brightness ? `(${star.brightness})` : ""}`).join(" ")
      : "借对宫";
    const ages = list => (list || []).slice(0, 4).join(" ");
    const cells = model.palaces.ring.map(palace => {
      const stars = palace.majors.length
        ? palace.majors.map(star => `<em>${escapeHtml(star.name)}</em>${star.brightness ? `<small>${escapeHtml(star.brightness)}</small>` : ""}${star.transformation ? `<b class="ov-hua">${escapeHtml(star.transformation)}</b>` : ""}`).join("")
        : `<span class="ov-empty">空</span>`;
      const others = (palace.minorNames || []).concat(palace.auxNames || []);
      const isSoul = palace.name === "命宫";
      const isOriginal = original && palace.branch === original.branch;
      const tags = [isSoul ? "命" : "", palace.isBody ? "身" : "", isOriginal ? "因" : ""].filter(Boolean);
      const self = (palace.selfTransforms || [])
        .map(item => `<span class="ov-self">${escapeHtml(item.symbol)}${escapeHtml(item.kind)}<small>${escapeHtml(item.star)}</small></span>`)
        .join("");
      return `
        <div class="ov-cell${palace.isBody ? " is-body" : ""}${isSoul ? " is-soul" : ""}${isOriginal ? " is-original" : ""}${palace.isPeriodSoul ? " is-period-soul" : ""}" data-branch="${escapeHtml(palace.branch)}">
          <span class="ov-cell-head">
            <span class="ov-cell-stem">${escapeHtml(palace.stem)}${escapeHtml(palace.branch)}</span>
            ${palace.decadal && palace.decadal.from != null ? `<span class="ov-cell-decadal">${palace.decadal.from}-${palace.decadal.to}</span>` : ""}
          </span>
          <span class="ov-cell-stars">${stars}</span>
          ${others.length ? `<span class="ov-cell-others">${others.map(escapeHtml).join(" ")}</span>` : ""}
          ${self ? `<span class="ov-cell-self">${self}</span>` : ""}
          <span class="ov-cell-ages">
            ${palace.periodPalace ? `<span>流年<b>${escapeHtml(palace.periodPalace)}</b></span>` : ""}
            ${palace.ages && palace.ages.length ? `<span>小限<b>${escapeHtml(ages(palace.ages))}</b></span>` : ""}
            ${palace.changsheng ? `<span class="ov-cell-changsheng">${escapeHtml(palace.changsheng)}</span>` : ""}
          </span>
          ${palace.shensha && palace.shensha.length ? `<span class="ov-cell-shensha">${palace.shensha.map(escapeHtml).join(" · ")}</span>` : ""}
          <span class="ov-cell-name">${escapeHtml(palace.name)}${tags.length ? `<small>${escapeHtml(tags.join(""))}</small>` : ""}</span>
        </div>`;
    }).join("");
    const center = model.centers || {};
    const centerRows = [];
    if (center.gender) centerRows.push(["", `${center.gender} · ${escapeHtml(model.palaces.fiveElementsClass)}`]);
    if (center.pillars) centerRows.push(["节气四柱", escapeHtml(center.pillars)]);
    if (center.lunar) centerRows.push(["农历", escapeHtml(center.lunar)]);
    if (center.solar) centerRows.push(["公历", escapeHtml(center.solar)]);
    return `
      <div class="ov-ziwei">
        <p class="ov-chart-line">命宫 <strong>${escapeHtml(soul.branch)}</strong> ${escapeHtml(starLine(soul))}${body ? ` · 身宫 <strong>${escapeHtml(body.branch)}</strong>` : ""}</p>
        <p class="ov-chart-meta">${escapeHtml(model.palaces.fiveElementsClass)} · 命主 ${escapeHtml(model.palaces.soulRuler)} · 身主 ${escapeHtml(model.palaces.bodyRuler)}${original ? ` · 来因 ${escapeHtml(original.palace)}` : ""}</p>
        <div class="ov-ring">${cells}<div class="ov-ring-center">
          <svg class="ov-taiji" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
            <circle cx="50" cy="50" r="46" fill="#faf7ef" stroke="currentColor" stroke-width="1.5"></circle>
            <path d="M50 4a46 46 0 0 1 0 92 23 23 0 0 1 0-46 23 23 0 0 0 0-46z" fill="currentColor" opacity="0.82"></path>
            <circle cx="50" cy="27" r="7" fill="#faf7ef"></circle>
            <circle cx="50" cy="73" r="7" fill="currentColor" opacity="0.82"></circle>
          </svg>
          <div class="ov-center-rows">
            <p class="ov-center-title">紫微斗数</p>
            ${centerRows.map(([label, value]) => `<p>${label ? `<span>${label}</span>` : ""}${value}</p>`).join("")}
            <p><span>命主</span>${escapeHtml(model.palaces.soulRuler)}<span>身主</span>${escapeHtml(model.palaces.bodyRuler)}</p>
            ${body ? `<p><span>身宫</span>${escapeHtml(body.branch)}${original ? `<span>来因</span>${escapeHtml(original.palace)}` : ""}</p>` : ""}
            <p class="ov-center-legend">↑ 本宫自化 · 庙旺为亮度 · 数字为流年虚岁</p>
          </div>
        </div></div>
      </div>`;
  }

  function renderYear(model) {
    const year = model.year || {};
    const coverage = model.yearCoverage || null;
    const basis = [];
    if (year.ganzhi) basis.push(`${year.ganzhi}${year.tenGod ? ` · ${year.tenGod}` : ""}`);
    if (year.luck) basis.push(`大限 ${year.luck.ganzhi}${year.luck.tenGod ? ` · ${year.luck.tenGod}` : ""}（${year.luck.ageRange}）`);
    return `
      <div class="ov-year-head">
        <p class="ov-year-line">${year.year ? `<strong>${year.year}</strong> 年 ｜ ` : ""}${escapeHtml(basis.join(" ｜ "))}${year.age ? ` ｜ 虚岁 ${year.age}` : ""}</p>
        ${year.ziwei ? `<p class="ov-chart-meta">紫微流年：${year.ziwei.fourHua.map(item => `${escapeHtml(item.kind)}→${escapeHtml(item.periodPalace)}(${escapeHtml(item.star)})`).join("、")}</p>` : `<p class="ov-chart-meta">紫微流年四化只对当前年份计算，其他年份按八字流年给倾向。</p>`}
        ${coverage && coverage.inRange === false && coverage.first != null
          ? `<p class="ov-year-note">这一年不在本次算好的范围里（${coverage.first}–${coverage.last} 年）。改看出生资料里的「重点年份」再排一次，或直接看年度报告。</p>`
          : ""}
      </div>`;
  }

  function renderOutlook(model) {
    const rows = asArray(model.outlook);
    if (rows.length < 2) return "";
    const toneClass = { opportunity: "is-opportunity", caution: "is-caution", neutral: "" };
    const first = rows[0].year;
    const last = rows[rows.length - 1].year;
    const focus = Number(model.year?.year) || null;
    // 后面还有没有算过的年份，决定这句话是「往后看」还是「只能回看」。
    const hasFuture = Number.isFinite(focus) && last > focus;
    const lead = hasFuture
      ? `从 ${first} 到 ${last} 年，每年三句话：事业、关系、钱财。用的是同一套规则；想细看某一年，把上面那张表的年份切过去。`
      : `${first}–${last} 年，每年三句话：事业、关系、钱财。这几年的流年已经算好；想看 ${last + 1} 年往后，把出生资料里的「重点年份」调后一点再排一次。`;
    return `
      <section class="ov-block ov-outlook">
        <h3 class="ov-outlook-title">这几年各是什么调子</h3>
        <p class="ov-outlook-lead">${escapeHtml(lead)}</p>
        <ol class="ov-outlook-list">
          ${rows.map(row => `
            <li class="ov-outlook-row${row.year === focus ? " is-current" : ""}">
              <p class="ov-outlook-year"><strong>${row.year}</strong> <span>${escapeHtml(row.ganzhi)}${row.tenGod ? ` · ${escapeHtml(row.tenGod)}` : ""}</span>${row.age ? `<em>虚岁 ${row.age}</em>` : ""}</p>
              <div class="ov-outlook-items">
                ${row.items.map(item => `<p class="ov-outlook-item ${toneClass[item.tone] || ""}"><span>${escapeHtml(item.label)}</span>${escapeHtml(item.headline)}</p>`).join("")}
              </div>
            </li>`).join("")}
        </ol>
      </section>`;
  }

  function renderDomains(model) {
    const toneClass = { opportunity: "is-opportunity", caution: "is-caution", neutral: "" };
    return (model.domains || []).map(card => `
      <article class="ov-domain ${toneClass[card.tone] || ""}">
        <h4>${escapeHtml(card.label)}</h4>
        <p class="ov-domain-head">${escapeHtml(card.headline)}</p>
        <p class="ov-domain-text">${escapeHtml(card.detail)}</p>
        ${card.basis.length ? `<p class="ov-domain-basis">依据：${card.basis.map(escapeHtml).join("；")}</p>` : ""}
      </article>`).join("");
  }

  function render(model) {
    if (!model || model.status !== "ok") {
      const reason = escapeHtml(model?.reason || "");
      return `<p class="ov-empty-note">还没有可以汇总的盘。${reason ? ` ${reason}` : ""}</p>`;
    }
    return `
      <div class="ov-grid">
        <section class="ov-block">${renderChart(model)}</section>
        <section class="ov-block">${renderPalaces(model)}</section>
      </div>
      <section class="ov-block ov-year">${renderYear(model)}<div class="ov-domains">${renderDomains(model)}</div></section>
      ${renderOutlook(model)}`;
  }

  const api = {
    SCHEMA,
    build,
    render,
    // 供测试直接调用
    chartOf,
    elementsOf,
    structureOf,
    palacesOf,
    yearOf,
    domainCards,
    familyOf,
    parseAgeRange,
    renderChart,
    renderPalaces,
    renderYear,
    renderDomains,
    outlookOf,
    renderOutlook
  };

  global.MingliOverview = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
