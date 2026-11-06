/**
 * 组合生成器 —— 补 star_main14_palace.md 里那 36 格「—（源未及）」
 *
 * 为什么要有这个模块：
 *   钦天门 §12 明写「禁止某星=某事件单一符号映射，必须星曜组合+宫位+四化结构
 *   三要素完整句式」。也就是说正统断法是**现场组合**，逐宫断语表只是便利索引。
 *   索引空着不该等于死路——回到同一套体系的零件重新组合即可。
 *
 * 零件来源（全部钦天门自己的文件，逐字抽取，不造词）：
 *   星性     references/star_theology.md        → knowledge/ziwei/compose-parts.json#stars
 *   宫位义   references/palace_fly_all12.md     → knowledge/ziwei/compose-parts.json#palaces
 *   四化结构 由调用方传入（生年/大限/流年三层）
 *   判据     SKILL.md §2 十六字：禄坐主得、忌坐主烦恼（不凶除非见煞）
 *
 * 输出的每一条都带 `composed: true` 与出处，报告里必须显式标注
 * 「组合生成，非原表断语」，不得冒充作者原文。
 */
(function () {
  "use strict";

  var SCHEMA = "mingli.knowledge-compose/v1";

  // 星性只取标题定语的前两段，避免整段塞进句子；原文仍在 compose-parts.json 里
  var NATURE_MAX_SEGMENTS = 2;

  // 四化条款：逐层逐象的固定说法，依据 SKILL §2「禄坐主得 / 忌坐主烦恼」。
  // 只用确定性措辞，不含断言词（一定/必然/绝对…）。
  var HUA_CLAUSE = {
    "生年": {
      "禄": "生年禄在此，属先天机会所在，须引动才发",
      "权": "生年权在此，属先天主控倾向，易在此处坚持",
      "科": "生年科在此，属先天清爽之处，遇事偏能收敛",
      "忌": "生年忌在此，属先天在意之事，可做但不宜被冲",
    },
    "大限": {
      "禄": "大限禄在此，这十年在这一块上有可得之机",
      "权": "大限权在此，这十年在这一块上出力较多",
      "科": "大限科在此，这十年在这一块上偏能理顺",
      "忌": "大限忌在此，这十年容易在这一块反复用力",
    },
    "流年": {
      "禄": "流年禄在此，今年在这一块上见到机会",
      "权": "流年权在此，今年在这一块上容易较劲",
      "科": "流年科在此，今年在这一块上偏向收敛",
      "忌": "流年忌在此，今年容易在这一块被牵住",
    },
  };

  var LAYER_ORDER = ["生年", "大限", "流年"];
  var KIND_ORDER = ["禄", "权", "科", "忌"];

  function flattenHua(hua) {
    /** 接受 [{layer, kind}] 或 {生年:{禄:[...]}} 两种形状，统一成有序数组。 */
    var rows = [];
    if (Array.isArray(hua)) {
      hua.forEach(function (item) {
        if (!item || typeof item !== "object") return;
        var layer = item.layer;
        var kind = item.kind;
        if (LAYER_ORDER.indexOf(layer) < 0 || KIND_ORDER.indexOf(kind) < 0) return;
        rows.push({ layer: layer, kind: kind, star: item.star || null });
      });
    }
    rows.sort(function (a, b) {
      var dl = LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer);
      if (dl !== 0) return dl;
      return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    });
    // 同一层同一象只留一条，避免重复堆词
    var seen = {};
    return rows.filter(function (row) {
      var k = row.layer + row.kind;
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  function shortNature(tagline) {
    if (typeof tagline !== "string") return null;
    var segments = tagline
      .split(/[，,]/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
    if (segments.length === 0) return null;
    var picked = segments.slice(0, NATURE_MAX_SEGMENTS).join("，");
    // 星性定语里若带「然…」转折，组合句里会喧宾夺主，截掉
    picked = picked.replace(/^然/, "");
    return picked || null;
  }

  function buildHuaClause(rows) {
    var parts = [];
    rows.forEach(function (row) {
      var table = HUA_CLAUSE[row.layer];
      var clause = table && table[row.kind];
      if (clause) parts.push(clause);
    });
    return parts.length ? parts.join("；") : null;
  }

  /**
   * @param {object} parts      knowledge/ziwei/compose-parts.json
   * @param {object} spec
   * @param {string} spec.star  主星名
   * @param {string} spec.palace 宫位名
   * @param {Array}  spec.hua   该宫四化（三层）
   * @returns {object}
   */
  function compose(parts, spec) {
    var starName = spec && spec.star;
    var palaceName = spec && spec.palace;
    if (typeof starName !== "string" || !starName) {
      return { status: "unavailable", composed: true, reason: "缺少星名，无法组合" };
    }
    if (typeof palaceName !== "string" || !palaceName) {
      return { status: "unavailable", composed: true, reason: "缺少宫位，无法组合" };
    }
    if (!parts || typeof parts !== "object") {
      return { status: "unavailable", composed: true, reason: "缺少原料（compose-parts）" };
    }

    var star = parts.stars && parts.stars[starName];
    if (!star) {
      return {
        status: "unavailable", composed: true,
        reason: "star_theology.md 未载「" + starName + "」的星性",
      };
    }
    var palace = parts.palaces && parts.palaces[palaceName];
    if (!palace || palace.status !== "ok") {
      return {
        status: "unavailable", composed: true,
        reason: "palace_fly_all12.md 未载「" + palaceName + "」的宫位义"
          + (palace && palace.reason ? "（" + palace.reason + "）" : ""),
      };
    }

    var nature = shortNature(star.nature);
    if (!nature) {
      return {
        status: "unavailable", composed: true,
        reason: "「" + starName + "」的星性只有标题、无可组合的定语",
      };
    }

    var huaRows = flattenHua(spec.hua);
    var huaClause = buildHuaClause(huaRows);
    var domain = palace.domain;

    // 三要素：星曜（星性）+ 宫位（领域）+ 四化（结构）
    var pieces = [starName + nature, palaceName + "主" + domain];
    if (huaClause) pieces.push(huaClause);
    var reading = pieces.join("，");

    var provenance = [];
    if (star.source) provenance.push({ kind: "starNature", file: star.source.file, heading: star.source.heading });
    if (palace.source) provenance.push({ kind: "palaceMeaning", file: palace.source.file, heading: palace.source.heading });

    var limitations = ["组合生成，非原表断语"];
    if (palace.note) limitations.push(palace.note);
    if (huaRows.length === 0) limitations.push("本盘该宫无三层四化，句子只由星性与宫位义组成");

    return {
      status: "ok",
      composed: true,
      schema: SCHEMA,
      star: starName,
      palace: palaceName,
      reading: reading,
      // 供报告正文使用的首句（不改变语义，只截断）
      nature: nature,
      domain: domain,
      huaClauses: huaRows.map(function (row) { return row.layer + row.kind; }),
      huaClause: huaClause,
      provenance: provenance,
      // 下游 knowledgeRefs 用：形如 compose:star_theology.md#天同
      refs: provenance.map(function (item) {
        return "compose:" + item.file.replace(/^references\//, "") + "#" + (item.kind === "starNature" ? starName : palaceName);
      }),
      limitations: limitations,
    };
  }

  /** 批量组合：返回可用条目与不可用原因，供阶梯 4 回退使用。 */
  function composeMany(parts, specList) {
    var ok = [];
    var failed = [];
    (Array.isArray(specList) ? specList : []).forEach(function (spec) {
      var result = compose(parts, spec);
      if (result.status === "ok") ok.push(result);
      else failed.push(result);
    });
    return { status: ok.length ? "ok" : "unavailable", entries: ok, failed: failed };
  }

  globalThis.MingliKnowledgeCompose = Object.freeze({
    SCHEMA: SCHEMA,
    HUA_CLAUSE: HUA_CLAUSE,
    compose: compose,
    composeMany: composeMany,
    shortNature: shortNature,
  });
})();
