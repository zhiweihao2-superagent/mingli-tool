/**
 * 年度月份事实包的装配层。
 *
 * 只做一件事：把已经算好的两部分确定性事实合并成一个可寻址的结构。
 *   - 八字侧：服务端 monthly_facts（节气分月、流月干支、四层关系）
 *   - 紫微侧：浏览器内 buildMonthlyTiming（农历月流月、叠宫、四化、流曜）
 *
 * 这里不计算任何日期、干支、宫位或四化；也不合并两套体系对同一件事的结论。
 * 证据用 JSON Pointer 表示，便于上层按路径引用与校验。
 */
(() => {
  "use strict";

  const SCHEMA_VERSION = "mingli-annual-timeline/v1";
  const MONTH_COUNT = 12;

  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  /** 解析 JSON Pointer（RFC 6901 子集：仅 / 分隔与 ~0 ~1 转义）。 */
  function resolvePointer(root, pointer) {
    if (pointer === "") return root;
    if (typeof pointer !== "string" || pointer[0] !== "/") return undefined;
    return pointer
      .slice(1)
      .split("/")
      .map(token => token.replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce((node, token) => {
        if (node === null || node === undefined) return undefined;
        if (Array.isArray(node)) {
          const index = Number(token);
          return Number.isInteger(index) ? node[index] : undefined;
        }
        if (typeof node === "object") return node[token];
        return undefined;
      }, root);
  }

  // 事实包声明 UTC+08:00，引擎也按固定 +8 计算（不追历史夏令时），
  // 所以取日历日期必须加 8 小时再按 UTC 读，不能用 toISOString 直接取。
  // 否则北京时间 00:00–07:59 的节气时刻会被算到前一天。
  const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

  const stampOf = value => (typeof value === "number" ? value : Date.parse(value));

  /** 按事实包声明的 UTC+08:00 取日历日。 */
  function beijingDateOf(value) {
    const stamp = stampOf(value);
    if (!Number.isFinite(stamp)) return null;
    return new Date(stamp + TZ_OFFSET_MS).toISOString().slice(0, 10);
  }

  function monthSpecsFrom(baziMonthly) {
    const months = baziMonthly?.months || [];
    return months.map(month => {
      const start = stampOf(month.start);
      const end = stampOf(month.end);
      return {
        index: month.index,
        ganzhi: month.ganzhi,
        midpoint: Number.isFinite(start) && Number.isFinite(end)
          ? beijingDateOf((start + end) / 2)
          : null,
        // 判断农历月是否覆盖整个节气月：取月首日 + 区间内最后一刻所在的北京日期。
        // 不能用 end-24h：若 end 在当天 00:00 之后，会退到前一天，漏掉最后一天。
        startDate: beijingDateOf(month.start),
        endDate: Number.isFinite(end) ? beijingDateOf(end - 1) : null
      };
    });
  }

  /** 与 Python 侧 month_fingerprint 同一算法，用于复算边界指纹。 */
  function monthFingerprint(months) {
    const text = months
      .map(month => `${month.index}|${month.start}|${month.end}`)
      .join("|");
    const bytes = typeof TextEncoder === "function"
      ? new TextEncoder().encode(text)
      : Uint8Array.from(text, ch => ch.charCodeAt(0));
    let value = 0x811c9dc5;
    for (const byte of bytes) {
      value ^= byte;
      value = Math.imul(value, 0x01000193) >>> 0;
    }
    return `mf-${value.toString(16).padStart(8, "0")}`;
  }

  /** 每月证据路径：只列真实存在的字段，避免指向 null。 */
  // 装配边界不信任上游：段结构、天数、相邻关系、主段唯一性与 coverage 自洽性都要核。
  // 返回 {ok, segments, main} —— 不 ok 时调用方一律降级为不可用。
  const isRealDay = (text) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text));
    if (!match) return false;
    const [, y, m, d] = match;
    const cursor = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    const pad = n => String(n).padStart(2, "0");
    return cursor.getUTCFullYear() === Number(y)
      && pad(cursor.getUTCMonth() + 1) === m
      && pad(cursor.getUTCDate()) === d;
  };
  const nextDay = (text) => {
    const [y, m, d] = String(text).split("-").map(Number);
    const cursor = new Date(Date.UTC(y, m - 1, d + 1));
    const pad = n => String(n).padStart(2, "0");
    return `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`;
  };
  const dayCount = (from, to) => {
    const parse = text => {
      const [y, m, d] = String(text).split("-").map(Number);
      return Date.UTC(y, m - 1, d);
    };
    return Math.round((parse(to) - parse(from)) / 86400000) + 1;
  };

  function inspectSegments(source) {
    const segments = Array.isArray(source?.segments) ? source.segments : null;
    if (!segments || segments.length === 0 || segments.length > 2) return { ok: false };
    if (source.segmentCount !== segments.length) return { ok: false };
    let previousTo = null;
    for (const seg of segments) {
      if (!isRealDay(seg?.from) || !isRealDay(seg?.to)) return { ok: false };
      if (typeof seg?.days !== "number" || !Number.isInteger(seg.days) || seg.days < 1) {
        return { ok: false };
      }
      if (typeof seg?.verified !== "boolean") return { ok: false };
      // 天数必须与日期区间一致
      if (dayCount(seg.from, seg.to) !== seg.days) return { ok: false };
      // 相邻段必须"次日相接"，不能有缝也不能重叠
      if (previousTo !== null && seg.from !== nextDay(previousTo)) return { ok: false };
      previousTo = seg.to;
    }
    const dominant = segments.filter(seg => seg.isDominant === true);
    if (dominant.length !== 1) return { ok: false };
    // 主段必须是天数最多的那段（并列取靠前的）
    const longest = segments.reduce((a, b) => (b.days > a.days ? b : a));
    if (dominant[0] !== longest) return { ok: false };
    const anyVerified = segments.some(seg => seg.verified === true);
    const expectedCoverage = !anyVerified
      ? "none"
      : (segments.length === 1 && segments[0].verified === true ? "full" : "partial");
    if (source.coverage !== expectedCoverage) return { ok: false };
    return { ok: true, segments, main: dominant[0] };
  }

  function evidenceOf(monthsOffset, hasBazi, ziwei, relations) {
    // 用**最终数组位置**，不能用业务 index：稀疏或乱序输入会指错
    const base = `/months/${monthsOffset}`;
    const pointers = [];
    if (hasBazi) {
      pointers.push(`${base}/bazi/ganzhi`, `${base}/bazi/start`, `${base}/bazi/end`);
    }
    // 每条关系都要有可解析的定位路径，不能只给一个 evidence_id 字符串
    (relations || []).forEach((_, position) => {
      pointers.push(`${base}/bazi/relations/${position}`);
    });
    pointers.push(`${base}/ziwei/status`);
    if (ziwei?.validation) pointers.push(`${base}/ziwei/validation/status`);
    // 只有字段级状态为 validated 时才把该字段路径放进证据索引
    // 证据必须解析到**非 null 的值**：validated 但 value 为 null 时不能进索引，
    // 否则 pointers_resolvable 会红。
    const fieldPointer = (key) => {
      const envelope = ziwei?.[key];
      if (envelope?.status === "validated" && envelope.value != null) {
        pointers.push(`${base}/ziwei/${key}/value`);
      }
    };
    fieldPointer("transitStars");
    fieldPointer("fourTransformations");
    fieldPointer("palaceOverlay");
    return pointers;
  }

  function build({ baziMonthly, ziweiMonthly, targetYear, ziweiBlockedReason = null }) {
    const baziMonths = baziMonthly?.months || [];
    const ziweiMonths = ziweiMonthly?.months || [];
    const ziweiByIndex = new Map(ziweiMonths.map(item => [item.index, item]));
    const declaredYear = baziMonthly?.target_year;
    const annualYear = baziMonthly?.annual?.year;
    const birthPillars = baziMonthly?.birth_pillars ?? null;

    const PILLAR_LAYER = {
      year: "natal", month: "natal", day: "natal", hour: "natal",
      dayun: "luck", liunian: "annual", liuyue: "monthly"
    };

    const months = baziMonths.map((bazi, monthsOffset) => {
      const source = ziweiByIndex.get(bazi.index) || null;
      // 该月应有的取样规格：用来核对传进来的紫微事实确实属于本月
      const expected = monthSpecsFrom({ months: [bazi] })[0];

      // 装配边界不信任输入：只有「状态 ok + 校验通过 + 坐标对齐 + 取样日期属于本月」
      // 四条同时成立，才把紫微字段当作有效事实复制进包；否则降级并清空可用字段。
      const sampleMatches = Boolean(source?.sampleDates)
        && source.sampleDates.start === expected.startDate
        && source.sampleDates.midpoint === expected.midpoint
        && source.sampleDates.end === expected.endDate;

      // 月份坐标可信 = 有来源 + 取样日期属于本月 + (坐标对齐 或 已按农历月切段) + 来源状态 ok。
      // 跨农历月的节气月会切成 1–2 段（coverage: "partial"），顶层字段取天数最多的那段，
      // 因此不再要求整月对齐——否则紫微侧永远是"不可用"。
      // 字段是否可用不看整月 validation 汇总，交给各自的 envelope。
      // T3：字段可用性由**主段是否已验证**决定（coverage !== "none"），
      // coordinateAligned 只作整月坐标标记，不再单独决定字段可用性。
      // 有 segments 就按段校验；没有段的老来源才退回坐标对齐判定。
      const hasSegments = Array.isArray(source?.segments) && source.segments.length > 0;
      // T3：与生成侧共用同一份结构校验，并传入本月的真实边界。
      // 共享函数缺失时一律降级，不允许绕过校验。
      // 浏览器里挂在 window，测试里挂在 globalThis；两边都要取到
      const ziweiFactsLib = (typeof window !== "undefined" && window.MingliZiweiFacts)
        || globalThis.MingliZiweiFacts
        || null;
      const sharedAssess = (ziweiFactsLib && typeof ziweiFactsLib.assessSegments === "function")
        ? ziweiFactsLib.assessSegments
        : null;
      // T3：与生成侧共用同一份结构校验，并传入本月的真实边界；
      // 共享函数缺失时一律降级，不允许绕过校验。
      const segInfo = hasSegments
        ? (sharedAssess
          ? sharedAssess(source, { startDate: expected.startDate, endDate: expected.endDate })
          : null)
        : null;
      // 两套校验返回形状不同：本地 inspectSegments 给 main，共享 assessSegments 给 mainIndex
      const mainSegment = !segInfo?.ok
        ? null
        : (segInfo.main || segInfo.segments?.[segInfo.mainIndex] || null);
      // 有段就按段校验；没有段的老来源退回坐标对齐判定（兼容既有夹具）。
      // 没有段就不可用：空 segments + full coverage 自相矛盾，
      // 且字段值会绕过"主段已验证"这道门。
      const structureOk = hasSegments && segInfo
        ? (segInfo.ok && Boolean(mainSegment) && mainSegment.verified === true)
        : false;
      const coverageUsable = hasSegments && segInfo
        ? (segInfo.ok && source.coverage !== "none")
        : false;
      const sourceUsable = Boolean(source)
        && sampleMatches
        && structureOk
        && coverageUsable
        && source.status === "ok";

      // 坐标/来源不可信时全字段清空；否则逐字段保留其自身状态。
      // 但 envelope 的自述也要按**引擎校验项**复核：
      // 声明 validated 而对应 check 没 pass 的，一律降级，不得进入证据白名单。
      const verifiedStatus = (envelope, checkId) => {
        if (!envelope) return "unavailable";
        const check = (source?.validation?.checks || []).find(item => item.id === checkId);
        if (envelope.status !== "validated") return envelope.status;
        return check && check.pass === true ? "validated" : "failed";
      };
      // 逐字段与**主段**比对：顶层自称 validated 但主段不是同一个值，一律降级。
      // 稳定深比较：键顺序不同但内容相同应视为相等
      const stableEqual = (a, b) => {
        if (a === b) return true;
        if (typeof a !== typeof b) return false;
        if (a === null || b === null) return a === b;
        if (typeof a !== "object") return false;
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        if (Array.isArray(a)) {
          if (a.length !== b.length) return false;
          return a.every((item, index) => stableEqual(item, b[index]));
        }
        const aKeys = Object.keys(a).sort();
        const bKeys = Object.keys(b).sort();
        if (aKeys.length !== bKeys.length) return false;
        if (aKeys.some((key, index) => key !== bKeys[index])) return false;
        return aKeys.every((key) => stableEqual(a[key], b[key]));
      };

      // 与主段比对：主段**必须**提供同名 envelope，且 status 与 value 都要一致。
      // 缺 envelope、缺 value、单侧为 null 都算不一致——否则顶层会输出主段不支持的值。
      const agreesWithMain = (key, status, value) => {
        if (!hasSegments || !segInfo?.ok) return false;
        const mainEnvelope = mainSegment?.[key];
        if (!mainEnvelope) return false;
        if (mainEnvelope.status !== status) return false;
        if (!Object.prototype.hasOwnProperty.call(mainEnvelope, "value")) return false;
        return stableEqual(mainEnvelope.value ?? null, value ?? null);
      };

      const FIELD_STATUSES = ["validated", "failed", "unavailable"];

      // T2：求值顺序固定为
      //   1) 来源不可用 → unavailable/null（结构原因优先，source 清空）
      //   2) 先比**未经降级**的顶层与主段 envelope（类型/status/value 全一致）
      //   3) 再看引擎检查结果，按状态表决定最终状态
      const fieldFrom = (envelope, checkId, fieldKey) => {
        if (!source) {
          return { status: "unavailable", value: null, reason: "无该月紫微数据", source: null };
        }
        if (!sourceUsable) {
          return {
            status: "unavailable",
            value: null,
            reason: (segInfo && !segInfo.ok && segInfo.reason)
              || (source && source.reason)
              || "该月紫微坐标或来源不可信",
            source: null,
          };
        }
        if (!envelope || typeof envelope !== "object") {
          return {
            status: "unavailable",
            value: null,
            reason: fieldKey ? "顶层字段与主段不一致" : "缺少该类字段",
            source: null,
          };
        }

        const upstreamStatus = envelope.status;
        const hasValue = Object.prototype.hasOwnProperty.call(envelope, "value");
        const upstreamValue = hasValue ? envelope.value : undefined;

        // 2) 与主段比：两侧都必须是合法状态、都自带 value、status 相同、value 相等
        if (fieldKey) {
          const mainEnvelope = mainSegment?.[fieldKey];
          const mainHasValue = Boolean(mainEnvelope)
            && Object.prototype.hasOwnProperty.call(mainEnvelope, "value");
          const consistent = Boolean(hasSegments && segInfo?.ok)
            && mainEnvelope && typeof mainEnvelope === "object"
            && hasValue            // 顶层必须自带 value
            && mainHasValue        // 主段也必须自带 value
            && FIELD_STATUSES.includes(upstreamStatus)
            && FIELD_STATUSES.includes(mainEnvelope.status)
            && mainEnvelope.status === upstreamStatus
            && stableEqual(mainEnvelope.value, upstreamValue);
          if (!consistent) {
            return {
              status: "unavailable",
              value: null,
              reason: "顶层字段与主段不一致",
              source: null,
            };
          }
        }

        // 3) 状态表
        const check = (source.validation?.checks || []).find(item => item.id === checkId);
        const checkPassed = check ? check.pass === true : false;

        if (upstreamStatus === "validated") {
          if (checkPassed) {
            return { status: "validated", value: upstreamValue ?? null, reason: null, source: envelope.source ?? null };
          }
          return { status: "failed", value: null, reason: "字段检查未通过", source: envelope.source ?? null };
        }
        if (upstreamStatus === "failed") {
          return {
            status: "failed",
            value: null,
            reason: envelope.reason || "字段检查未通过",
            source: envelope.source ?? null,
          };
        }
        if (upstreamStatus === "unavailable") {
          return {
            status: "unavailable",
            value: null,
            reason: envelope.reason || "字段不可用",
            source: envelope.source ?? null,
          };
        }
        // 非法状态：不原样输出
        return { status: "unavailable", value: null, reason: "字段状态非法", source: null };
      }

      // 三个最终 envelope 只算一次，顶层与主段段副本共用（唯一真源）
      const finalPalace = fieldFrom(source?.palaceOverlay, "monthly_twelve_palaces_unique", "palaceOverlay");
      const finalHua = fieldFrom(source?.fourTransformations, "monthly_four_hua_complete", "fourTransformations");
      const finalStars = fieldFrom(source?.transitStars, "monthly_transit_stars_valid", "transitStars");;

      let ziwei;
      if (!source) {
        ziwei = {
          status: "unavailable",
          // 整体不可用时（如未知时辰）沿用上层原因，不能每行都说"未提供该月份"
          reason: ziweiBlockedReason || "紫微流月未提供该月份",
          coordinateAligned: false,
          validation: { status: "unavailable", checks: [], hardFailures: [] },
          segments: [],
          segmentCount: 0,
          coverage: "none",
          eligibility: { declared: null, validation: null, aligned: false, sampleMatches: false },
          ganzhi: null,
          // 没有来源数据时，字段也要有明确状态，不能留 null 让上层猜
          palaceOverlay: { status: "unavailable", value: null, reason: "无该月紫微数据", source: null },
          fourTransformations: { status: "unavailable", value: null, reason: "无该月紫微数据", source: null },
          transitStars: { status: "unavailable", value: null, reason: "无该月紫微数据", source: null }
        };
      } else {
        const normalized = ["ok", "unavailable", "failed", "unverifiable"].includes(source.status)
          ? source.status
          : "unavailable";
        ziwei = {
          status: sourceUsable ? "ok" : (normalized === "ok" ? "unverifiable" : normalized),
          reason: sourceUsable
            ? null
            : (segInfo && !segInfo.ok
              ? `段结构不可信：${segInfo.reason}`
              : (source.reason || "取样日期或坐标与本月份不符，字段不作为有效事实")),
          validation: source.validation,
          validationStatus: source.validationStatus ?? source.validation?.status ?? null,
          asOfDate: source.asOfDate,
          sampleDates: source.sampleDates ?? null,
          lunarDate: source.lunarDate,
          lunarMonth: source.lunarMonth ?? null,
          lunarAtStart: source.lunarAtStart ?? null,
          lunarAtEnd: source.lunarAtEnd ?? null,
          // T4：非布尔（缺失/null/字符串）输出 null，让校验能发现来源说谎；
          // 下游按布尔消费的地方用 === true 判断，null 等价于 false。
          coordinateAligned: typeof source.coordinateAligned === "boolean"
            ? source.coordinateAligned
            : null,
          // 按月切段：只有来源可信时才透传段；来源不可信（取样不匹配/状态非 ok）时
          // 段也不能被引用为已验证事实。段指针按**最终输出位置**重写。
          // 没有分段的合法来源也要**材料化**成一个整月段：
          // 否则会出现「空 segments + full coverage」这种自相矛盾的输出。
          segments: sourceUsable
            ? (hasSegments
              ? source.segments.map((seg, segIndex) => ({
                ...seg,
                // 段副本必须与最终投影一致：主段直接用顶层那一份，
                // 未验证段的三个字段一律清空，避免"顶层降级、段仍是 validated"的矛盾
                // T3：每段的三个字段都必须是**存在的对象**，否则 fieldPointer 解不到东西
                ...(() => {
                  if (seg === mainSegment) {
                    return { palaceOverlay: finalPalace, fourTransformations: finalHua, transitStars: finalStars };
                  }
                  const placeholder = (reason) => ({
                    status: "unavailable", value: null, reason, source: null,
                  });
                  if (seg.verified !== true) {
                    return {
                      palaceOverlay: placeholder("该段未验证"),
                      fourTransformations: placeholder("该段未验证"),
                      transitStars: placeholder("该段未验证"),
                    };
                  }
                  // 已验证的非主段：保留合法 envelope；缺失或非法时给占位，保证指针可解析
                  const keepOr = (value, reason) => {
                    const valid = value && typeof value === "object"
                      && ["validated", "failed", "unavailable"].includes(value.status);
                    if (!valid) return placeholder(reason);
                    if (!Object.prototype.hasOwnProperty.call(value, "value")) return placeholder(reason);
                    if (value.status === "validated") {
                      // 合法 envelope 原样保留（含原始 reason/source）
                      return {
                        status: "validated",
                        value: value.value ?? null,
                        reason: value.reason ?? null,
                        source: value.source ?? null,
                      };
                    }
                    // failed/unavailable：清空 value，保留非空原因（空串才回退）
                    return {
                      status: value.status,
                      value: null,
                      reason: value.reason || reason,
                      source: value.source ?? null,
                    };
                  };
                  return {
                    palaceOverlay: keepOr(seg.palaceOverlay, "该段字段缺失或无效"),
                    fourTransformations: keepOr(seg.fourTransformations, "该段字段缺失或无效"),
                    transitStars: keepOr(seg.transitStars, "该段字段缺失或无效"),
                  };
                })(),
                evidenceId: `months[${monthsOffset}].ziwei.segments[${segIndex}]`,
                jsonPointer: `/months/${monthsOffset}/ziwei/segments/${segIndex}`,
                // T3：段级 fieldStatuses 由**最终的**三个 envelope 重建，
                // 不信任上游同名映射（否则顶层降级、段里仍写 validated）
                fieldStatuses: (() => {
                  // 只看**最终** envelope：主段用 final，其余按是否 verified 与信封是否合法判定
                  const statusOf = (final, raw) => {
                    if (seg === mainSegment) return final.status;
                    if (seg.verified !== true) return "unavailable";
                    const valid = raw && typeof raw === "object"
                      && ["validated", "failed", "unavailable"].includes(raw.status)
                      && Object.prototype.hasOwnProperty.call(raw, "value");
                    return valid ? raw.status : "unavailable";
                  };
                  const segPalace = { status: statusOf(finalPalace, seg.palaceOverlay) };
                  const segHua = { status: statusOf(finalHua, seg.fourTransformations) };
                  const segStars = { status: statusOf(finalStars, seg.transitStars) };
                  return {
                    palaceOverlay: segPalace.status,
                    fourTransformations: segHua.status,
                    transitStars: segStars.status,
                  };
                })(),
                fieldPointers: {
                  palaceOverlay: `/months/${monthsOffset}/ziwei/segments/${segIndex}/palaceOverlay`,
                  fourTransformations: `/months/${monthsOffset}/ziwei/segments/${segIndex}/fourTransformations`,
                  transitStars: `/months/${monthsOffset}/ziwei/segments/${segIndex}/transitStars`,
                },
              }))
              : [])
            : [],
          segmentCount: sourceUsable
            ? (hasSegments ? source.segments.length : 1)
            : 0,
          // 来源不可信时不能透传 coverage：空段 + full 是自相矛盾的
          coverage: sourceUsable
            ? (source.coverage ?? (source.coordinateAligned === true ? "full" : "partial"))
            : "none",
          coordinateBasis: source.coordinateBasis,
          coordinateNote: source.coordinateNote,
          eligibility: {
            declared: source.status ?? null,
            validation: source.validation?.status ?? null,
            aligned: source.coordinateAligned === true,
            sampleMatches,
            sourceUsable
          },
          ganzhi: sourceUsable ? source.ganzhi : null,
          // 字段级包装原样保留（validated/failed/unavailable），
          // 只有坐标或来源不可信时才整体降级。
          palaceOverlay: finalPalace,
          fourTransformations: finalHua,
          transitStars: finalStars,
          // 复用已计算的 final envelope：单次求值，状态必然与字段一致
          fieldStatuses: {
            palaceOverlay: finalPalace.status,
            fourTransformations: finalHua.status,
            transitStars: finalStars.status
          }
        };
      }

      return {
        index: bazi.index,
        // 四层原始柱值：用于校验每条关系的 binding 是否真的对应本月输入
        sourcePillars: {
          year: birthPillars?.year ?? null,
          month: birthPillars?.month ?? null,
          day: birthPillars?.day ?? null,
          hour: birthPillars?.hour ?? null,
          liunian: baziMonthly?.annual?.gan
            ? { stem: baziMonthly.annual.gan, branch: baziMonthly.annual.zhi }
            : null,
          liuyue: { stem: bazi.gan ?? null, branch: bazi.zhi ?? null },
          dayun: bazi.luck?.status === "ok"
            ? { stem: bazi.luck.gan ?? null, branch: bazi.luck.zhi ?? null }
            : null,
          // 跨运月按分段保留大运柱，关系通过 relation.segment 解析到对应分段
          dayunSegments: Array.isArray(bazi.luck?.segments)
            ? bazi.luck.segments.reduce((acc, seg) => {
              acc[String(seg.segment)] = { stem: seg.gan ?? null, branch: seg.zhi ?? null };
              return acc;
            }, {})
            : null
        },
        coordinate: {
          basis: "solar-term",
          jie: bazi.jie,
          start: bazi.start,
          end: bazi.end,
          timezone: "UTC+08:00",
          interval: "half_open[start,end)",
          // 每个边界单独标注确定性来源：起于本月的节气，止于下个月的节气
          startSource: {
            jie: bazi.jie ?? null,
            longitude: bazi.jie_longitude ?? null,
            basis: "solar-term-apparent-longitude",
            timezone: "UTC+08:00"
          },
          endSource: {
            jie: bazi.next_jie ?? null,
            basis: "solar-term-apparent-longitude",
            timezone: "UTC+08:00"
          }
        },
        bazi: {
          ganzhi: bazi.ganzhi,
          gan: bazi.gan,
          zhi: bazi.zhi,
          start: bazi.start,
          end: bazi.end,
          label: bazi.label ?? null,
          // 逐月绑定流年年份，便于核对每年事实是否被装错包
          annualYear: annualYear ?? null,
          // 大运状态：ok / indeterminate / before_start / unavailable
          luck: bazi.luck ?? null,
          relationScope: bazi.relation_scope ?? null,
          relationCount: bazi.relation_count ?? (bazi.relations || []).length,
          relations: bazi.relations || [],
          evidenceIds: (bazi.relations || []).map(item => item.evidence_id)
        },
        ziwei,
        evidence: evidenceOf(monthsOffset, true, ziwei, bazi.relations || [])
      };
    });

    const summarize = group => ({
      months: group.map(item => item.index),
      start: group[0]?.coordinate.start || null,
      end: group[group.length - 1]?.coordinate.end || null,
      firstGanzhi: group[0]?.bazi.ganzhi || null,
      lastGanzhi: group[group.length - 1]?.bazi.ganzhi || null,
      baziRelationTotal: group.reduce((sum, item) => sum + item.bazi.relationCount, 0),
      ziweiValidated: group.filter(item => item.ziwei.status === "ok").length
    });

    const firstHalf = months.slice(0, 6);
    const secondHalf = months.slice(6);

    const checks = [];
    const record = (id, pass, message) => checks.push({ id, pass: Boolean(pass), message });

    // 上游事实源自报无效时，整包不能算通过。
    // 这里要求明确通过（pass），缺省、unavailable、未知值一律拒绝 —— 不做 fail-open。
    record(
      "source.bazi_status",
      baziMonthly?.status === "ok",
      `八字事实源状态：${baziMonthly?.status ?? "缺失"}`
    );
    record(
      "source.bazi_validation",
      baziMonthly?.validation?.status === "pass",
      `八字事实源校验：${baziMonthly?.validation?.status ?? "缺失"}（要求 pass）`
    );
    // 复算边界指纹：即使上游校验显示 pass，边界被改过也必须被发现
    const declaredFingerprint = baziMonthly?.fingerprint ?? null;
    const recomputed = baziMonths.length ? monthFingerprint(baziMonths) : null;
    record(
      "source.bazi_fingerprint",
      Boolean(declaredFingerprint) && declaredFingerprint === recomputed,
      declaredFingerprint
        ? (declaredFingerprint === recomputed
          ? `边界指纹一致：${recomputed}`
          : `边界指纹不符：声明 ${declaredFingerprint}，复算 ${recomputed}`)
        : "八字事实源未提供边界指纹"
    );

    record("months.count", months.length === MONTH_COUNT, `实际 ${months.length} 个月`);
    record(
      "months.index",
      months.every((item, position) => item.index === position + 1),
      "索引应为 1..12 顺序排列"
    );
    record(
      "months.contiguous",
      months.every((item, position) =>
        position === 0 || item.coordinate.start === months[position - 1].coordinate.end
      ),
      "相邻月份必须首尾相接"
    );
    record(
      "months.positive_interval",
      months.every(item => {
        const start = Date.parse(item.coordinate.start);
        const end = Date.parse(item.coordinate.end);
        return Number.isFinite(start) && Number.isFinite(end) && start < end;
      }),
      "每月区间必须是正长度（start 早于 end）"
    );
    record(
      "months.first_is_lichun",
      months[0]?.coordinate.jie === "立春",
      "首月必须由立春起算"
    );
    record(
      "months.boundary_sources",
      months.every(item =>
        item.coordinate.startSource?.jie
        && item.coordinate.endSource?.jie
        && item.coordinate.startSource?.basis
        && item.coordinate.endSource?.basis
        && item.coordinate.startSource?.timezone
        && item.coordinate.endSource?.timezone
      ),
      "每个边界都必须标注起止节气、来源口径与时区"
    );

    const KNOWN_PARTICIPANTS = new Set([
      "year", "month", "day", "hour", "dayun", "liunian", "liuyue"
    ]);
    // 关系源完整性：空关系数组不能靠 every 恒真通过，
    // 必须由已完成的审计元数据证明「本层确实审计过」。
    const relationAudit = baziMonthly?.relation_audit ?? null;
    const auditLayers = Array.isArray(relationAudit?.layers) ? relationAudit.layers : [];
    const anyLuckUsable = months.some(item =>
      item.bazi.luck?.status === "ok" || item.bazi.luck?.status === "split"
    );
    record(
      "source.relation_audit",
      Boolean(relationAudit)
        && ["natal", "annual", "monthly"].every(layer => auditLayers.includes(layer))
        && (!anyLuckUsable || auditLayers.includes("luck"))
        && ["ok", "partial"].includes(relationAudit?.status),
      relationAudit
        ? `关系审计层：${auditLayers.join(",") || "空"}，状态 ${relationAudit.status}`
        : "缺少 relation_audit，无法证明关系层已审计"
    );
    record(
      "source.birth_pillars",
      Boolean(birthPillars)
        && ["year", "month", "day"].every(name => Boolean(birthPillars?.[name])),
      birthPillars ? "原局三柱齐备" : "缺少原局柱，无法审计四层关系"
    );
    record(
      "months.relation_scope",
      months.every(item => {
        const scope = item.bazi.relationScope;
        if (!scope || !Array.isArray(scope.computed_layers)) return false;
        // 每月的审计范围至少要覆盖原局/流年/流月，空数组不能蒙混过关
        if (!["natal", "annual", "monthly"].every(layer => scope.computed_layers.includes(layer))) {
          return false;
        }
        // omitted_layers 必须与大运状态一致，且大运可用时 computed_layers 必须真的包含 luck
        const omitted = Array.isArray(scope.omitted_layers) ? scope.omitted_layers : [];
        const luckOk = item.bazi.luck?.status === "ok" || item.bazi.luck?.status === "split";
        return luckOk
          ? scope.computed_layers.includes("luck") && !omitted.includes("luck")
          : !scope.computed_layers.includes("luck") && omitted.includes("luck");
      }),
      "每月关系审计范围必须覆盖原局/流年/流月，且口径与大运状态一致"
    );
    record(
      "relations.participants_bound",
      months.every(item => item.bazi.relations.every(relation =>
        Array.isArray(relation.participants)
        && relation.participants.length > 0
        && relation.participants.every(name => KNOWN_PARTICIPANTS.has(name))
        && Array.isArray(relation.bindings)
        && relation.bindings.length === relation.participants.length
        && relation.bindings.every((binding, position) => {
          if (!binding) return false;
          // 逐项对齐：第 i 条 binding 必须描述的正是第 i 个参与者
          if (binding.participant !== relation.participants[position]) return false;
          if (PILLAR_LAYER[binding.participant] !== binding.layer) return false;
          if (binding.channel !== "stem" && binding.channel !== "branch") return false;
          let source = item.sourcePillars?.[binding.participant];
          // 跨运月的大运柱按关系所属分段取
          if (binding.participant === "dayun" && relation.segment != null) {
            source = item.sourcePillars?.dayunSegments?.[String(relation.segment)] ?? null;
          }
          if (!source) return false;
          return binding.value === source[binding.channel];
        })
        && Array.isArray(relation.required_values)
        && relation.required_values.length > 0
      )),
      "关系参与者必须绑定到正确柱位、正确层，且取值与本月输入一致"
    );

    // 目标年份必须**显式存在**且与事实一致；缺失也算失败，不能当通过。
    record(
      "target.year_match",
      declaredYear !== undefined && declaredYear !== null
        && Number(declaredYear) === Number(targetYear),
      `入参 ${targetYear}，八字事实 ${declaredYear ?? "缺失"}`
    );
    record(
      "target.annual_match",
      annualYear !== undefined && annualYear !== null
        && Number(annualYear) === Number(targetYear),
      `入参 ${targetYear}，流年事实 ${annualYear ?? "缺失"}`
    );
    record(
      "target.month_annual_consistent",
      months.every(item => item.bazi.annualYear === null
        || Number(item.bazi.annualYear) === Number(targetYear)),
      "逐月绑定的流年年份必须与目标年份一致"
    );
    // 首月起点必须落在目标年、末月终点必须落在次年：立春边界不能错年
    const firstStart = months[0]?.coordinate.start;
    const lastEnd = months[months.length - 1]?.coordinate.end;
    record(
      "months.boundary_years",
      Boolean(firstStart) && Boolean(lastEnd)
        && String(beijingDateOf(firstStart)).slice(0, 4) === String(targetYear)
        && String(beijingDateOf(lastEnd)).slice(0, 4) === String(Number(targetYear) + 1),
      `首月起点 ${beijingDateOf(firstStart)}，末月终点 ${beijingDateOf(lastEnd)}`
    );

    const packageRoot = { months };
    const allPointers = months.flatMap(item => item.evidence);
    // null 也算无效：路径必须解析到非缺失值，不能指向 null 混过去
    const missing = allPointers.filter(pointer => {
      const value = resolvePointer(packageRoot, pointer);
      return value === undefined || value === null;
    });
    record(
      "evidence.pointers_resolvable",
      missing.length === 0,
      missing.length === 0 ? `共 ${allPointers.length} 条证据路径` : `失效路径：${missing.slice(0, 3).join(", ")}`
    );

    record(
      "ziwei.status_vocabulary",
      months.every(item =>
        ["ok", "unavailable", "unverifiable"].includes(item.ziwei.status)
      ),
      "紫微状态必须落在 ok/unavailable/unverifiable 三态内"
    );
    record(
      "ziwei.never_inferred",
      months.every(item =>
        item.ziwei.status !== "ok" || item.ziwei.coordinateBasis === "iztro-lunar-month"
      ),
      "紫微事实必须来自引擎，不得由流年推断"
    );
    record(
      "ziwei.not_usable_when_unaligned",
      months.every(item =>
        // 切段后：有已验证段（coverage !== none）即可携带主段值，
        // 没有已验证段的月份才要求三个值全空。
        item.ziwei.coverage === "full" || item.ziwei.coverage === "partial"
          ? true
          : item.ziwei.palaceOverlay?.value == null
            && item.ziwei.fourTransformations?.value == null
            && item.ziwei.transitStars?.value == null
      ),
      "没有已验证段时不得携带任何字段值"
    );
    record(
      "ziwei.field_statuses_valid",
      months.every(item => {
        const statuses = [
          item.ziwei.palaceOverlay?.status,
          item.ziwei.fourTransformations?.status,
          item.ziwei.transitStars?.status
        ];
        // 每类字段都必须有明确状态，且只能取三种值
        return statuses.every(status =>
          ["validated", "failed", "unavailable"].includes(status)
        );
      }),
      "叠宫/四化/流曜必须各自带 validated|failed|unavailable 状态"
    );
    record(
      "ziwei.coordinate_flag_present",
      months.every(item => {
        const ziwei = item.ziwei;
        if (typeof ziwei.coordinateAligned !== "boolean") return false;
        // true 必须对应「单段且该段已验证」；段数组可能被装配层裁剪，
        // 因此以 segmentCount 与 coverage 为准，段数组存在时再核 verified。
        if (ziwei.coordinateAligned !== true) return true;
        // true 必须对应「一个已验证的全月段」
        if (ziwei.coverage !== "full") return false;
        if (ziwei.segmentCount !== 1) return false;
        const flagSegments = ziwei.segments || [];
        return flagSegments.length === 1 && flagSegments[0].verified === true;
      }),
      "标为 ok 的紫微月份必须有已验证段；coordinateAligned 为 true 时必须是单段全月"
    );
    record(
      "ziwei.eligibility_enforced",
      months.every(item =>
        item.ziwei.status !== "ok" || (
          item.ziwei.eligibility?.declared === "ok"
          // 切段后不再要求整月 aligned：由 coverage 与主段 verified 共同保证
          && (item.ziwei.coverage === "full" || item.ziwei.coverage === "partial")
          && item.ziwei.eligibility?.sampleMatches === true
          && item.ziwei.eligibility?.sourceUsable === true
        )
      ),
      "标为 ok 的紫微月份必须满足 声明ok / 坐标对齐 / 取样属本月"
    );

    const status = checks.every(check => check.pass) ? "pass" : "fail";

    // 指纹覆盖整包内容（不含指纹本身），否则改边界/关系/四化时指纹不变。
    // 字段名严格按事实包契约：顶层 year，半年汇总 half_years.first_half/second_half。
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      year: targetYear,
      status,
      coordinate: {
        bazi: "solar-term (twelve jie)",
        ziwei: "iztro lunar month, verified by three-point sampling",
        timezone: "UTC+08:00",
        merged: false,
        note: "两套月份坐标口径不同，分别保留，不做统一。"
      },
      months,
      // 指纹是「边界未被改动」的证据，页面需要能展示声明值与复算值
      fingerprints: {
        declared: declaredFingerprint,
        recomputed,
        matches: Boolean(declaredFingerprint) && declaredFingerprint === recomputed
      },
      half_years: {
        first_half: summarize(firstHalf),
        second_half: summarize(secondHalf)
      },
      evidence: { root: "months", pointers: allPointers },
      validation: { status, checks }
    };

    return { ...payload, fingerprint: `tl-${fnv1a(JSON.stringify(payload))}` };
  }

  const ZIWEI_STATUS_TEXT = {
    ok: "可用",
    failed: "校验未通过",
    unverifiable: "坐标不可对应",
    unavailable: "不可用"
  };

  /** 大运状态的中文表述。不猜、不补，缺什么说什么。 */
  function describeLuck(luck) {
    if (!luck) return "大运：未提供";
    if (luck.status === "ok") {
      return `大运 ${luck.ganzhi}${luck.from ? `（${luck.from.slice(0, 10)} 起）` : ""}`;
    }
    if (luck.status === "indeterminate") return "大运：换运点落在不确定区间，未绑定";
    if (luck.status === "before_start") return "大运：尚未起运";
    return `大运：${luck.reason || "不可用"}`;
  }

  /** 单月的展示模型（纯函数，不碰 DOM，便于测试）。 */
  function describeMonth(month) {
    const spanEnd = month.coordinate.endSource?.jie || "下一节";
    const ziwei = month.ziwei;

    let ziweiText;
    if (ziwei.status === "ok") {
      const huaRows = ziwei.fourTransformations?.value || [];
      const stars = ziwei.transitStars?.value || [];
      const overlay = ziwei.palaceOverlay?.value || [];
      const parts = [
        `流月 ${ziwei.ganzhi || "—"}`,
        `农历 ${ziwei.lunarMonth || "—"}`
      ];
      // 跨农历月的月份按月切段：默认展示主段，其余段在这里点明，避免"一个月两个答案"的困惑
      const segments = Array.isArray(ziwei.segments) ? ziwei.segments : [];
      const others = segments.filter(seg => seg && seg.isDominant === false);
      const hua = huaRows.filter(row => row && row.star).map(row => `${row.kind}${row.star}`);
      if (hua.length) parts.push(`四化 ${hua.join(" ")}`);
      parts.push(`流曜 ${stars.length}（${ziwei.transitStars?.status}）`);
      parts.push(`叠宫 ${overlay.length}（${ziwei.palaceOverlay?.status}）`);
      const base = `紫微：可用（${parts.join(" · ")}）`;
      // 其它段只给区间与天数：命理结论仍以主段为准，但用户能看到"本月另有一段"
      const extra = others.length
        ? `；本月另有 ${others.length} 段：` + others
          .map(seg => `${seg.from}→${seg.to}（${seg.days} 天）`)
          .join("、")
        : "";
      ziweiText = base + extra;
    } else {
      ziweiText = `紫微：${ZIWEI_STATUS_TEXT[ziwei.status] || ziwei.status}`
        + (ziwei.reason ? `（${ziwei.reason}）` : "");
    }

    return {
      index: month.index,
      ziweiStatus: ziwei.status,
      title: `第 ${month.index} 月 · ${month.bazi.ganzhi}`,
      span: `${month.coordinate.jie} ${month.coordinate.start} → ${spanEnd} ${month.coordinate.end}`,
      facts: `关系 ${month.bazi.relationCount} 条 · ${describeLuck(month.bazi.luck)}`,
      ziwei: ziweiText,
      // 明细：页面用折叠块展示，避免摘要行过长，但内容必须可核对
      ziweiDetails: ziwei.status === "ok"
        ? {
          fieldStatuses: ziwei.fieldStatuses || null,
          fourTransformations: (ziwei.fourTransformations?.value || []).map(row => ({
            kind: row?.kind ?? null,
            star: row?.star ?? null,
            natalPalace: row?.natalPalace ?? null,
            monthlyPalace: row?.monthlyPalace ?? null
          })),
          transitStars: (ziwei.transitStars?.value || []).map(star => ({
            name: star?.name ?? null,
            natalPalace: star?.natalPalace ?? null,
            periodPalace: star?.periodPalace ?? null
          })),
          palaceOverlay: (ziwei.palaceOverlay?.value || []).map(row => ({
            branch: row?.branch ?? null,
            natalPalace: row?.natalPalace ?? null,
            monthlyPalace: row?.monthlyPalace ?? null
          }))
        }
        : null,
      evidenceCount: month.evidence.length
    };
  }

  /** 校验明细与指纹：页面需要能直接读到这些值，而不只是"是否一致"。 */
  function describeDiagnostics(pkg) {
    return {
      fingerprints: {
        declared: pkg.fingerprints?.declared ?? null,
        recomputed: pkg.fingerprints?.recomputed ?? null,
        matches: Boolean(pkg.fingerprints?.matches),
        package: pkg.fingerprint ?? null
      },
      checks: (pkg.validation?.checks || []).map(item => ({
        id: item.id,
        pass: Boolean(item.pass),
        message: item.message
      }))
    };
  }

  /** 整包的展示摘要。 */
  function describeSummary(pkg, extraNote = null) {
    const validated = pkg.months.filter(month => month.ziwei.status === "ok").length;
    const parts = [
      `年度包校验：${pkg.validation.status === "pass" ? "通过" : "未通过"}`,
      `紫微可用 ${validated}/${pkg.months.length} 月`,
      `边界指纹 ${pkg.fingerprints.matches ? "一致" : "不一致"}`
    ];
    if (extraNote) parts.push(extraNote);
    return parts.join(" · ");
  }

  /** 是否该为该紫微结果计算流月；未知时辰或缺盘面时明确不建、不猜。 */
  function monthlyZiweiPlan(ziweiResult) {
    const hasPalaces = Array.isArray(ziweiResult?.palaces)
      && ziweiResult.palaces.length > 0;
    if (ziweiResult?.status === "ok" && ziweiResult.astrolabe && hasPalaces) {
      return { shouldBuild: true, note: null };
    }
    if (ziweiResult?.status === "unavailable") {
      return {
        shouldBuild: false,
        note: "未知时辰，未建立紫微盘；本年度时间轴的紫微部分整体不可用。"
      };
    }
    if (ziweiResult?.status === "ok" && !hasPalaces) {
      return {
        shouldBuild: false,
        note: "紫微盘缺少宫位数据，无法计算流月；本年度时间轴的紫微部分整体不可用。"
      };
    }
    return {
      shouldBuild: false,
      note: "紫微盘不可用；本年度时间轴的紫微部分整体不可用。"
    };
  }

  globalThis.MingliAnnualTimeline = Object.freeze({
    build,
    buildMonthlyView: pkg => pkg.months.map(describeMonth),
    describeLuck,
    describeMonth,
    describeDiagnostics,
    describeSummary,
    monthSpecsFrom,
    monthlyZiweiPlan,
    resolvePointer,
    ziweiStatusText: ZIWEI_STATUS_TEXT,
    schemaVersion: SCHEMA_VERSION
  });
})();
