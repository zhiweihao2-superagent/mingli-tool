"use strict";

(() => {
  const ENGINE_VERSION = "2.6.2";
  const STEMS = Object.freeze(["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]);
  const BRANCHES = Object.freeze(["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]);
  const RULE_PROFILE = Object.freeze({
    id: "iztro-default-v1",
    algorithm: "default",
    yearDivide: "normal",
    horoscopeDivide: "normal",
    ageDivide: "normal",
    dayDivide: "forward",
    fixLeap: true,
    // 闰月口径：文墨天机 2.0.15 默认「月中分界」——闰月 1–15 日视同本月、16 日以后视同次月。
    // iztro 的 fixLeap=true 内部就是这条规则（fixLunarMonthIndex 里 `o > 15` 才进位），
    // 两者一致，因此保留 fixLeap=true，并在结果里输出 leapMonthPolicy 供对账。
    leapMonthRule: "mid-split",
    leapMonthSplitDay: 15,
    // 晚子时口径：23:00–23:59 归次日（子时按次日算）。
    // 依据：文墨天机 2.0.15 的默认配置是「视为次日」（GlobalVars 初始化里 zzs 变量 = "2"，
    // 设置界面把 state 绑定到 == "1"，即 "1"=当日、"2"=次日）；
    // iztro 的 dayDivide="forward" 与之同义（timeIndex 12 且 dayDivide 不为 "current" 时日 +1）。
    lateZishiRule: "next-day",
    lateZishiBasis: "文墨天机 2.0.15 默认「视为次日」(zzs=2)；iztro dayDivide=forward 同义",
    trueSolarTime: false,
    schoolRules: Object.freeze({
      // 亮度默认取「斗数全书派」(qs)：文墨天机 2.0.15 的出厂值就是 "1"
      // （GlobalVars.as:926 初始化 `...5F7D066C...52218K = "1"`，getter 里 "1"→_AX_SB_QS）。
      // 样盘 14 颗主星与该表逐颗一致，而 xd1 在太阴@未 上是「平」（样本是「不」）。
      // 四套表都在 facts 层，切换只改这里或传 brightnessSchool。
      brightnessSchool: "qs",
      gengYearSihua: "GYWYT",
      tianmaSchool: "year-branch",
      tiankongSchool: "iztro-2.6.2-default",
      jiekongSchool: "double",
      kuiyueSchool: "qs1",
      tianshiTianshang: "iztro-2.6.2-default",
      changshengSchool: "yin-yang-shun-ni",
      lateZishi: "next-day",
      leapMonth: "mid-split"
    }),
    selectableSchoolRules: false
  });

  const BRANCH_TIME_INDEX = Object.freeze({
    丑: 1, 寅: 2, 卯: 3, 辰: 4, 巳: 5, 午: 6,
    未: 7, 申: 8, 酉: 9, 戌: 10, 亥: 11
  });

  const PALACE_TOPICS = Object.freeze({
    命宫: "自我认识与行动方式",
    兄弟: "手足、同辈与协作",
    夫妻: "伴侣与亲密关系",
    子女: "子女、创作与培养",
    财帛: "金钱观与资源安排",
    疾厄: "身心状态与健康习惯",
    迁移: "外部环境、出行与适应",
    仆役: "朋友、合作与团队",
    官禄: "工作方式、事业与责任",
    田宅: "家庭、居所与长期资产",
    福德: "内在满足、休息与精神状态",
    父母: "长辈、支持与成长背景"
  });

  function resolveTimeIndex(time) {
    if (!time || time.precision === "unknown") {
      return { available: false, code: "ZIWEI_TIME_REQUIRED", message: "紫微斗数需要出生时辰；八字结果仍然可以正常查看。" };
    }
    if (time.precision === "branch") {
      if (time.branch === "子") {
        return { available: false, code: "ZIWEI_RAT_HOUR_AMBIGUOUS", message: "子时横跨两个公历日期，请改填具体出生时间，才能区分晚上 23 点和凌晨 0 点。" };
      }
      const index = BRANCH_TIME_INDEX[time.branch];
      return Number.isInteger(index)
        ? { available: true, index }
        : { available: false, code: "ZIWEI_TIME_INVALID", message: "请选择有效的出生时辰。" };
    }
    const match = /^(\d{2}):(\d{2})$/.exec(time.value || "");
    if (!match) return { available: false, code: "ZIWEI_TIME_INVALID", message: "请填写有效的出生时间。" };
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return { available: false, code: "ZIWEI_TIME_INVALID", message: "请填写有效的出生时间。" };
    if (hour === 0) return { available: true, index: 0 };
    if (hour === 23) return { available: true, index: 12 };
    return { available: true, index: Math.floor((hour + 1) / 2) };
  }

  function adaptStar(star) {
    return {
      name: star.name,
      type: star.type,
      scope: star.scope || "origin",
      brightness: star.brightness || null,
      transformation: star.mutagen || null
    };
  }

  function adaptPalace(palace) {
    const traditionalName = palace.name.endsWith("宫") ? palace.name : `${palace.name}宫`;
    return {
      index: palace.index,
      name: traditionalName,
      topic: PALACE_TOPICS[palace.name] || PALACE_TOPICS[traditionalName] || "传统十二宫观察位置",
      heavenlyStem: palace.heavenlyStem,
      earthlyBranch: palace.earthlyBranch,
      isBodyPalace: Boolean(palace.isBodyPalace),
      isOriginalPalace: Boolean(palace.isOriginalPalace),
      majorStars: (palace.majorStars || []).map(adaptStar),
      minorStars: (palace.minorStars || []).map(adaptStar),
      auxiliaryStars: (palace.adjectiveStars || []).map(adaptStar),
      cycles: {
        changsheng12: palace.changsheng12 || null,
        boshi12: palace.boshi12 || null,
        jiangqian12: palace.jiangqian12 || null,
        suiqian12: palace.suiqian12 || null
      },
      ages: Array.isArray(palace.ages) ? [...palace.ages] : [],
      minorLimitAges: Array.isArray(palace.ages) ? [...palace.ages] : [],
      decadal: palace.decadal ? {
        fromAge: palace.decadal.range?.[0] ?? null,
        toAge: palace.decadal.range?.[1] ?? null,
        ganzhi: `${palace.decadal.heavenlyStem || ""}${palace.decadal.earthlyBranch || ""}`
      } : null
    };
  }

  function enrichPalaces(palaces) {
    palaces.forEach(palace => {
      const opposite = palaces.find(candidate => candidate.index === (palace.index + 6) % 12);
      palace.oppositePalace = opposite?.name || null;
      palace.isEmpty = palace.majorStars.length === 0;
      palace.borrowedFromPalace = palace.isEmpty ? opposite?.name || null : null;
      palace.borrowedMajorStars = palace.isEmpty
        ? (opposite?.majorStars || []).map(star => star.name)
        : [];
    });
    return palaces;
  }

  function ganzhiForYear(year) {
    const offset = ((year - 1984) % 60 + 60) % 60;
    return `${STEMS[offset % 10]}${BRANCHES[offset % 12]}`;
  }

  function buildDualFourPillars(chart) {
    const raw = chart.rawDates || {};
    const solarPillars = raw.chineseDate;
    const lunar = raw.lunarDate;
    if (!solarPillars || !lunar) return null;
    let lunarYear = Number(lunar.lunarYear);
    let lunarMonth = Math.abs(Number(lunar.lunarMonth));
    if (lunar.isLeap && Number(lunar.lunarDay) > 15) lunarMonth += 1;
    if (lunarMonth > 12) {
      lunarMonth = 1;
      lunarYear += 1;
    }
    const yearGanzhi = ganzhiForYear(lunarYear);
    const yearStemIndex = STEMS.indexOf(yearGanzhi.charAt(0));
    const monthStemBase = ((yearStemIndex % 5) * 2 + 2) % 10;
    const monthStemIndex = (monthStemBase + lunarMonth - 1) % 10;
    const monthBranchIndex = (lunarMonth + 1) % 12;
    return {
      solarTermPillars: [
        `${solarPillars.yearly?.[0] || ""}${solarPillars.yearly?.[1] || ""}`,
        `${solarPillars.monthly?.[0] || ""}${solarPillars.monthly?.[1] || ""}`,
        `${solarPillars.daily?.[0] || ""}${solarPillars.daily?.[1] || ""}`,
        `${solarPillars.hourly?.[0] || ""}${solarPillars.hourly?.[1] || ""}`
      ],
      lunarCalendarPillars: [
        yearGanzhi,
        `${STEMS[monthStemIndex]}${BRANCHES[monthBranchIndex]}`,
        `${solarPillars.daily?.[0] || ""}${solarPillars.daily?.[1] || ""}`,
        `${solarPillars.hourly?.[0] || ""}${solarPillars.hourly?.[1] || ""}`
      ],
      lunarMonthPolicy: RULE_PROFILE.schoolRules.leapMonth
    };
  }

  // 建盘前的输入归一化：直接农历输入与公历输入共用同一套规则。
  // 闰月标志必须是布尔（Boolean("false") === true 会把「非闰月」洗成闰月），
  // 农历月必须是 1–12 的整数、日必须是 1–30 的整数，非法值不参与建盘（r740 major）。
  function normalizeLunarInput(profile) {
    const calendar = profile?.calendar === "lunar" ? "lunar" : "solar";
    const rawDate = String(profile?.date || "").trim();
    const leapRaw = profile?.is_leap_month;
    if (leapRaw !== undefined && leapRaw !== null && typeof leapRaw !== "boolean") {
      return { status: "invalid", field: "is_leap_month", reason: `闰月标志必须是布尔值，收到 ${String(leapRaw)}` };
    }
    const isLeapMonth = leapRaw === true;
    if (calendar !== "lunar") {
      return { status: "ok", calendar, date: rawDate, month: null, day: null, isLeapMonth };
    }
    const matched = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(rawDate);
    if (!matched) {
      return { status: "invalid", field: "date", reason: `农历日期格式应为 YYYY-MM-DD，收到 ${rawDate || "(empty)"}` };
    }
    const month = Number(matched[2]);
    const day = Number(matched[3]);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return { status: "invalid", field: "lunarMonth", reason: `农历月必须是 1–12 的整数，收到 ${matched[2]}` };
    }
    if (!Number.isInteger(day) || day < 1 || day > 30) {
      return { status: "invalid", field: "lunarDay", reason: `农历日必须是 1–30 的整数，收到 ${matched[3]}` };
    }
    return { status: "ok", calendar, date: rawDate, month, day, isLeapMonth };
  }

  function calculate(profile, options = {}) {
    const resolvedTime = resolveTimeIndex(profile?.time);
    if (!resolvedTime.available) return { status: "unavailable", reason: resolvedTime };
    const lunarInput = normalizeLunarInput(profile);
    if (lunarInput.status !== "ok") {
      return {
        status: "error",
        error: { code: "ZIWEI_INPUT_INVALID", message: lunarInput.reason, field: lunarInput.field }
      };
    }
    if (!globalThis.iztro?.astro?.withOptions) {
      return {
        status: "error",
        error: { code: "ZIWEI_ENGINE_UNAVAILABLE", message: "紫微排盘引擎未加载，请刷新页面后重试。" }
      };
    }
    // 劫煞/龙德等安星校正在事实层里，缺了它盘面就是「静默少两颗星」。
    // 宁可明确失败，也不能返回 status=ok 的半成品（Codex r741 major）。
    if (!globalThis.MingliZiweiFacts?.build) {
      return {
        status: "error",
        error: { code: "ZIWEI_FACTS_UNAVAILABLE", message: "紫微事实层未加载，无法完成安星校正，请刷新页面后重试。" }
      };
    }

    try {
      const buildAstrolabe = fixLeap => globalThis.iztro.astro.withOptions({
        type: profile.calendar,
        dateStr: profile.date.replace(/-0?/g, "-").replace(/^-/, ""),
        timeIndex: resolvedTime.index,
        gender: profile.sex_for_calculation === "male" ? "男" : "女",
        isLeapMonth: lunarInput.isLeapMonth,
        fixLeap,
        language: "zh-CN",
        config: {
          algorithm: RULE_PROFILE.algorithm,
          yearDivide: RULE_PROFILE.yearDivide,
          horoscopeDivide: RULE_PROFILE.horoscopeDivide,
          ageDivide: RULE_PROFILE.ageDivide,
          dayDivide: RULE_PROFILE.dayDivide
        }
      });
      let astrolabe = buildAstrolabe(RULE_PROFILE.fixLeap);
      let chart = astrolabe.toJSON();
      // 闰月「月中分界」：iztro 的 fixLeap=true 内部只在农历日 > 15 时才把闰月当下月
      // （bundle 的 fixLunarMonthIndex: `u && t && o > 15 ? +1 : 0`），等价于文墨默认口径，
      // 所以这里不重建盘，只把实际采用的口径如实记下来供对账与审查。
      const rawLunar = chart.rawDates?.lunarDate || null;
      const leapMonthPolicy = describeLeapMonth(rawLunar);
      // 晚子时策略同样显式输出，便于对账时区分「按当日」与「按次日」两种算法。
      const lateZishiPolicy = {
        rule: RULE_PROFILE.lateZishiRule,
        applies: resolvedTime.index === 12,
        timeIndex: resolvedTime.index,
        treatedAs: resolvedTime.index === 12 ? "next-day" : "same-day",
        basis: RULE_PROFILE.lateZishiBasis
      };
      const fallbackYear = Number(new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        timeZone: "Asia/Shanghai"
      }).format(new Date()));
      const asOfYear = Number.isInteger(options.asOfYear) ? options.asOfYear : fallbackYear;
      const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(options.asOfDate || "")
        ? options.asOfDate
        : `${asOfYear}-01-01`;
      const asOfTimeIndex = Number.isInteger(options.asOfTimeIndex) && options.asOfTimeIndex >= 0 && options.asOfTimeIndex <= 12
        ? options.asOfTimeIndex
        : 0;

      const timeCorrection = profile.time_correction || { applied: false };
      const normalizedInput = {
        calendar: profile.calendar,
        date: profile.date,
        isLeapMonth: lunarInput.isLeapMonth,
        timeIndex: resolvedTime.index,
        sexForCalculation: profile.sex_for_calculation,
        timeCorrection
      };
      const palaces = enrichPalaces(chart.palaces.map(adaptPalace));
      const dualFourPillars = buildDualFourPillars(chart);
      const aiFacts = globalThis.MingliZiweiFacts?.build({
        chart,
        astrolabe,
        palaces,
        normalizedInput,
        ruleProfile: RULE_PROFILE,
        brightnessSchool: options.brightnessSchool || RULE_PROFILE.schoolRules.brightnessSchool,
        asOfYear,
        asOfDate,
        asOfTimeIndex,
        dualFourPillars
      }) || null;

      return {
        status: "ok",
        normalizedInput,
        engine: {
          name: "SylarLong/iztro",
          version: ENGINE_VERSION,
          license: "MIT"
        },
        ruleProfile: { ...RULE_PROFILE, trueSolarTime: Boolean(timeCorrection.applied) },
        calendarDisplay: {
          solar: chart.solarDate,
          lunar: chart.lunarDate,
          ganzhi: chart.chineseDate,
          time: `${chart.time} · ${chart.timeRange}`
        },
        basics: {
          fiveElementsClass: chart.fiveElementsClass,
          soulRuler: chart.soul,
          bodyRuler: chart.body,
          soulPalaceBranch: chart.earthlyBranchOfSoulPalace,
          bodyPalaceBranch: chart.earthlyBranchOfBodyPalace,
          zodiac: chart.zodiac,
          // 来因宫（originalPalace）：宫干与生年干相同的那个宫。iztro 用「宫干==年干 且 支不在子/丑」
          // 消歧（bundle 里 `!["ziEarthly","chouEarthly"].includes(X) && P===_`），因此恒为唯一一处。
          originalPalace: originalPalaceOf(palaces)
        },
        dualFourPillars,
        leapMonthPolicy,
        lateZishiPolicy,
        palaces,
        // 原始 iztro 盘面：流月等细运计算需要它，不能从格式化后的展示字段反推，
        // 否则口径可能与建盘不一致。
        astrolabe,
        aiFacts,
        disclaimer: "紫微斗数属于传统文化体系。这里展示确定性排盘字段，不据此断言性格、疾病、婚姻、财富或未来事件。"
      };
    } catch (error) {
      return {
        status: "error",
        error: { code: "ZIWEI_ENGINE_FAILURE", message: error?.message || "紫微排盘失败，请检查出生信息。" }
      };
    }
  }

  // 纯函数：把 iztro 的 rawDates.lunarDate 翻译成「闰月口径」描述。
  // 独立出来是为了能用「人造农历元数据」验证越界、缺失与闰十二月回绕（Codex r740）。
  // 来因宫：宫干与生年干相同的宫。`palaces[i].isOriginalPalace` 由 iztro 判定，
  // 我们只做结构化转出，不自己另立一套口径（对账见 docs/wmt-chart-crosscheck.md L9）。
  function originalPalaceOf(palaces) {
    const list = (palaces || []).filter((palace) => palace.isOriginalPalace);
    if (list.length !== 1) return null;
    const [palace] = list;
    return { palace: palace.name, branch: palace.earthlyBranch, stem: palace.heavenlyStem };
  }

  function describeLeapMonth(rawLunar) {
    const monthRaw = rawLunar ? rawLunar.lunarMonth : undefined;
    const dayRaw = rawLunar ? rawLunar.lunarDay : undefined;
    // 只接受真正的整数：字符串 "5"、true、5.5 都不算合法农历月日。
    // 先做 Number() 转换会把它们洗成看起来合法的值（Codex r739 major）。
    const lunarMonthValid = typeof monthRaw === "number" && Number.isInteger(monthRaw) && monthRaw >= 1 && monthRaw <= 12;
    const lunarDayValid = typeof dayRaw === "number" && Number.isInteger(dayRaw) && dayRaw >= 1 && dayRaw <= 30;
    const lunarValid = lunarMonthValid && lunarDayValid;
    // 闰月标志必须是布尔：缺失、null、"false" 一律视为无效元数据，
    // 否则会凭空算出一个「有效月份」（Codex r739 major）。
    const leapFlagValid = typeof rawLunar?.isLeap === "boolean";
    const isLeapMonth = leapFlagValid ? rawLunar.isLeap : false;
    const treatedAsNextMonth = leapFlagValid && isLeapMonth && lunarValid
      && dayRaw > RULE_PROFILE.leapMonthSplitDay;
    // treatedAsMonth 只在月日都合法时给出；否则 null，避免把「无法确定前后半月」
    // 的数据呈现成一个看似有效的月份（Codex r740）。
    const treatedAsMonth = lunarValid && leapFlagValid
      ? (treatedAsNextMonth ? (monthRaw % 12) + 1 : monthRaw)
      : null;
    return {
      rule: RULE_PROFILE.leapMonthRule,
      splitDay: RULE_PROFILE.leapMonthSplitDay,
      isLeapMonth,
      lunarMonth: lunarMonthValid ? monthRaw : null,
      lunarDay: lunarDayValid ? dayRaw : null,
      leapFlagValid,
      fixLeap: RULE_PROFILE.fixLeap,
      treatedAsNextMonth,
      treatedAsMonth,
      valid: lunarValid && leapFlagValid,
      invalidReason: lunarValid && leapFlagValid
        ? null
        : [
          lunarValid ? null : `农历月日越界、缺失或非整数：month=${rawLunar?.lunarMonth ?? "(none)"} day=${rawLunar?.lunarDay ?? "(none)"}`,
          leapFlagValid ? null : `闰月标志不是布尔值：isLeap=${rawLunar?.isLeap ?? "(none)"}`
        ].filter(Boolean).join("；")
    };
  }

  globalThis.MingliZiwei = Object.freeze({
    calculate,
    engineVersion: ENGINE_VERSION,
    resolveTimeIndex,
    // 测试钩子：验证闰月口径需要能传入人造农历元数据，真实盘构造不出越界/缺失
    describeLeapMonth,
    normalizeLunarInput,
    ruleProfile: RULE_PROFILE
  });
})();
