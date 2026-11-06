/**
 * 紫微知识查表：把「某星在某宫」的断语按盘面实际位置挂上去。
 *
 * 知识来源：钦天门紫微斗数 SKILL v7.7（`knowledge/ziwei/knowledge-v7.7.json`）
 * 许可：工程层 Apache-2.0；知识文本 CC BY-NC-SA 4.0
 *
 * 这里只做**查表与定位**，不改写知识内容。命中时原样给出断语文本，
 * 并附 `ruleId` / `source` / 星曜与宫位指针，便于下游追溯与二次校验。
 */
(function (root) {
  "use strict";

  var KNOWLEDGE_SCHEMA = "ziwei-knowledge/v1";

  function normalizePalace(name) {
    // 源文件用「交友宫」，本项目八字侧用「仆役宫」
    return name === "交友宫" ? "仆役宫" : name;
  }

  function createIndex(knowledge) {
    if (!knowledge || knowledge.schema_version !== KNOWLEDGE_SCHEMA) {
      throw new Error("knowledge 结构与预期不符");
    }
    return {
      meta: knowledge.source,
      stars: knowledge.stars || {},
      palaces: knowledge.palaces || [],
    };
  }

  function lookupStar(index, starName) {
    return index.stars[starName] || null;
  }

  // 源文件对被剔除或未覆盖的宫位标「—（源未及）」。那不是断语，
  // 必须当作"未收录"而不是一条有效的命中断语。
  var SOURCE_MISSING_MARKERS = ["—（源未及）", "-（源未及）", "—(源未及)"];

  function isSourceMissing(text) {
    if (!text) return true;
    var trimmed = String(text).trim();
    return SOURCE_MISSING_MARKERS.indexOf(trimmed) >= 0;
  }

  function lookupPalaceReading(index, starName, palaceName) {
    var star = lookupStar(index, starName);
    if (!star) return null;
    var palace = normalizePalace(palaceName);
    var reading = star.palace_readings && star.palace_readings[palace];
    if (!reading || isSourceMissing(reading)) return null;
    return {
      ruleId: "ziwei.knowledge." + starName + "." + palace,
      star: starName,
      palace: palace,
      reading: reading,
      note: (star.palace_notes && star.palace_notes[palace]) || null,
      source: index.meta,
    };
  }

  /**
   * 按盘面实际位置挂断语。
   * @param {object} index   createIndex 的结果
   * @param {Array}  palaces 排盘结果里的十二宫（含 majorStars/minorStars）
   * @returns {Array} 每颗主星一条 {star, palace, reading, pointers...}
   */
  function attachReadings(index, palaces) {
    var out = [];
    (palaces || []).forEach(function (palace, palaceIndex) {
      var palaceName = palace.name;
      var stars = palace.majorStars || [];
      stars.forEach(function (star, starIndex) {
        var hit = lookupPalaceReading(index, star.name, palaceName);
        out.push({
          star: star.name,
          brightness: star.brightness || null,
          palace: normalizePalace(palaceName),
          palaceIndex: palaceIndex,
          starIndex: starIndex,
          starPointer: "/palaces/" + palaceIndex + "/majorStars/" + starIndex,
          status: hit ? "validated" : "unavailable",
          ruleId: hit ? hit.ruleId : null,
          reading: hit ? hit.reading : null,
          note: hit ? hit.note : null,
          reason: hit ? null : "知识库未收录该星在该宫的断语",
          source: index.meta,
        });
      });
    });
    return out;
  }

  /** 星曜本义与组合要点（不依赖宫位）。 */
  function starProfile(index, starName) {
    var star = lookupStar(index, starName);
    if (!star) return null;
    return {
      star: starName,
      starNature: star.star_nature || "",
      essence: star.essence || [],
      combinations: star.combinations || [],
      source: index.meta,
    };
  }

  var api = {
    KNOWLEDGE_SCHEMA: KNOWLEDGE_SCHEMA,
    createIndex: createIndex,
    lookupStar: lookupStar,
    lookupPalaceReading: lookupPalaceReading,
    attachReadings: attachReadings,
    starProfile: starProfile,
    normalizePalace: normalizePalace,
    isSourceMissing: isSourceMissing
  };

  root.MingliZiweiKnowledge = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
