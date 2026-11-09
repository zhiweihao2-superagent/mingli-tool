/**
 * 紫微知识摘录（浏览器侧）
 *
 * 目的：让网页上的紫微 AI 解读也能「引经据典」——模型看到的不是裸事实，
 * 而是本盘实际用到的「星 × 宫」断语与星性原文；输出必须逐字引回这些锚点，
 * 服务端与前端各自校验一次，编造出处直接打回。
 *
 * 与八字不同的地方：紫微知识包没有「章节」概念，是按 星 → 宫 组织的查表数据，
 * 所以锚点取 ruleId 同一格式 `ziwei.knowledge.<星>.<宫>`，星性用 `ziwei.nature.<星>`。
 * 只为「本盘用得上的格子」生成摘录，不把 132 格全塞给模型。
 */
(function (root) {
  "use strict";

  var SCHEMA = "mingli.ziwei-knowledge-digest/v1";
  var SOURCE_SCHEMA = "ziwei-knowledge/v1";
  var DEFAULT_MAX_CHARS = 9000;
  var DEFAULT_EXCERPT_CHARS = 420;
  var SOURCE_MISSING = ["—（源未及）", "-（源未及）", "—(源未及)", "-(源未及)", ""];

  function isMissing(text) {
    if (typeof text !== "string") return true;
    return SOURCE_MISSING.indexOf(text.trim()) >= 0;
  }

  function clip(text, limit) {
    var body = String(text).trim();
    if (body.length <= limit) return { text: body, truncated: false };
    return { text: body.slice(0, limit - 1) + "…", truncated: true };
  }

  function citationOf(source, star, palace) {
    var name = (source && source.name) || "紫微斗数知识包";
    var version = (source && source.version) || "";
    var head = version ? name + " v" + version : name;
    return palace ? head + "·" + star + "·" + palace : head + "·" + star;
  }

  /** 本盘实际出现的「星 × 宫」：只取有主星的宫，避免空宫凑数。 */
  function collectTargets(chart) {
    var targets = [];
    var seenStar = {};
    var palaces = (chart && chart.palaces) || [];
    palaces.forEach(function (palace) {
      var stars = palace.majorStars || [];
      stars.forEach(function (star) {
        var starName = typeof star === "string" ? star : star && star.name;
        if (!starName) return;
        targets.push({ kind: "palace-reading", star: starName, palace: palace.name });
        if (!seenStar[starName]) {
          seenStar[starName] = true;
          // 一颗星的完整画像：星性 → 要点 → 格局原文。
          // 断语只讲「这颗星在这个宫」，判断「为什么」要靠这三层。
          targets.push({ kind: "star-nature", star: starName, palace: null });
          targets.push({ kind: "essence", star: starName, palace: null });
          targets.push({ kind: "combinations", star: starName, palace: null });
        }
      });
    });
    return targets;
  }

  function textOf(knowledge, target) {
    var star = knowledge.stars && knowledge.stars[target.star];
    if (!star) return null;
    if (target.kind === "star-nature") {
      return isMissing(star.star_nature) ? null : star.star_nature;
    }
    if (target.kind === "essence") {
      var essence = Array.isArray(star.essence) ? star.essence.filter(function (x) { return !isMissing(x); }) : [];
      if (essence.length === 0) return null;
      return { text: essence.slice(0, 3).join(" "), via: "essence" };
    }
    if (target.kind === "combinations") {
      var combos = Array.isArray(star.combinations) ? star.combinations.filter(function (x) { return !isMissing(x); }) : [];
      if (combos.length === 0) return null;
      return { text: combos.slice(0, 3).join(" "), via: "combinations" };
    }
    var readings = star.palace_readings || {};
    var text = readings[target.palace];
    if (isMissing(text)) {
      // 主表未及，退一步用 palace_notes（同宫的补充注意点），仍标注来源
      var note = (star.palace_notes || {})[target.palace];
      if (isMissing(note)) return null;
      return { text: note, via: "palace_notes" };
    }
    return { text: text, via: "palace_readings" };
  }

  function anchorOf(target) {
    if (target.kind === "star-nature") return "ziwei.nature." + target.star;
    if (target.kind === "essence") return "ziwei.essence." + target.star;
    if (target.kind === "combinations") return "ziwei.combinations." + target.star;
    return "ziwei.knowledge." + target.star + "." + target.palace;
  }

  function build(knowledge, chart, options) {
    var opts = options || {};
    var maxChars = typeof opts.maxChars === "number" && opts.maxChars > 0 ? opts.maxChars : DEFAULT_MAX_CHARS;
    var excerptChars = typeof opts.excerptChars === "number" && opts.excerptChars > 0
      ? opts.excerptChars : DEFAULT_EXCERPT_CHARS;

    if (!knowledge || knowledge.schema_version !== SOURCE_SCHEMA) {
      return {
        schema: SCHEMA, status: "unavailable", entries: [], anchors: [],
        reason: "知识包缺失或版本不符（期望 " + SOURCE_SCHEMA + "）",
        limitations: [], stats: { entryCount: 0, chars: 0, truncated: 0, missing: 0 },
      };
    }

    var targets = collectTargets(chart);
    if (targets.length === 0) {
      return {
        schema: SCHEMA, status: "unavailable", entries: [], anchors: [],
        reason: "这份盘没有可摘录的主星，无法生成知识摘录",
        limitations: [], stats: { entryCount: 0, chars: 0, truncated: 0, missing: 0 },
      };
    }

    var entries = [];
    var anchors = [];
    var chars = 0;
    var truncated = 0;
    var missing = [];
    var dropped = 0;

    targets.forEach(function (target) {
      var anchor = anchorOf(target);
      if (anchors.indexOf(anchor) >= 0) return;
      anchors.push(anchor);

      var found = textOf(knowledge, target);
      if (!found) {
        missing.push(anchor);
        return;
      }
      // textOf 对「星性」返回裸字符串，对「宫位断语」返回 {text, via}：这里统一成一种形状。
      var rawText = typeof found === "string" ? found : found.text;
      var via = typeof found === "string" ? null : (found.via || null);
      var body = clip(rawText, excerptChars);
      // 预算不够就丢正文，但锚点留着——模型仍可引用，只是看不到全文
      if (chars + body.text.length > maxChars) {
        dropped += 1;
        return;
      }
      chars += body.text.length;
      if (body.truncated) truncated += 1;
      entries.push({
        anchor: anchor,
        kind: target.kind,
        star: target.star,
        palace: target.palace,
        title: target.palace ? target.star + "·" + target.palace : target.star + "（星性）",
        via: via,
        text: body.text,
        truncated: body.truncated,
        citation: citationOf(knowledge.source, target.star, target.palace),
      });
    });

    var limitations = [
      "知识摘录只含本盘实际用到的 " + entries.length + " 条，不是知识包全文；未列入的格子不得引用。",
      ((knowledge.source && knowledge.source.license) || "") + "；只作查表引用，未改写原文。",
    ];
    if (dropped > 0) limitations.push(dropped + " 条因预算未发正文，锚点仍有效但模型看不到全文。");
    if (missing.length > 0) limitations.push(missing.length + " 格知识包未收录（源未及），不得据此编造断语。");

    return {
      schema: SCHEMA,
      status: dropped > 0 || missing.length > 0 ? "partial" : "ok",
      source: knowledge.source || null,
      entries: entries,
      anchors: anchors,
      missing: missing,
      limitations: limitations,
      stats: {
        entryCount: entries.length,
        anchorCount: anchors.length,
        chars: chars,
        truncated: truncated,
        missing: missing.length,
        dropped: dropped,
        excerptChars: excerptChars,
        maxChars: maxChars,
      },
    };
  }

  /** 把模型引用的锚点还原成可读出处；解析不到就如实说解析不到，不美化。 */
  function resolve(digest, anchor) {
    var list = (digest && digest.entries) || [];
    var hit = list.filter(function (item) { return item.anchor === anchor; })[0] || null;
    if (!hit) return { status: "unavailable", anchor: anchor, reason: "该锚点不在本次发出的摘录里" };
    return {
      status: "ok",
      anchor: anchor,
      title: hit.title,
      citation: hit.citation,
      text: hit.text,
      truncated: hit.truncated,
    };
  }

  var api = {
    SCHEMA: SCHEMA,
    SOURCE_SCHEMA: SOURCE_SCHEMA,
    DEFAULT_MAX_CHARS: DEFAULT_MAX_CHARS,
    collectTargets: collectTargets,
    build: build,
    resolve: resolve,
  };

  root.MingliZiweiKnowledgeDigest = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
