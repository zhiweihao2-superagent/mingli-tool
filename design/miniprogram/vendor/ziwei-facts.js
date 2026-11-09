"use strict";

(() => {
  const SCHEMA_VERSION = "ziwei-facts/v4";
  const HUA_KINDS = Object.freeze(["禄", "权", "科", "忌"]);
  const HUA_KEYS = Object.freeze({ 禄: "lu", 权: "quan", 科: "ke", 忌: "ji" });
  const FOUR_HUA = Object.freeze({
    甲: { 禄: "廉贞", 权: "破军", 科: "武曲", 忌: "太阳" },
    乙: { 禄: "天机", 权: "天梁", 科: "紫微", 忌: "太阴" },
    丙: { 禄: "天同", 权: "天机", 科: "文昌", 忌: "廉贞" },
    丁: { 禄: "太阴", 权: "天同", 科: "天机", 忌: "巨门" },
    戊: { 禄: "贪狼", 权: "太阴", 科: "右弼", 忌: "天机" },
    己: { 禄: "武曲", 权: "贪狼", 科: "天梁", 忌: "文曲" },
    庚: { 禄: "太阳", 权: "武曲", 科: "太阴", 忌: "天同" },
    辛: { 禄: "巨门", 权: "太阳", 科: "文曲", 忌: "文昌" },
    壬: { 禄: "天梁", 权: "紫微", 科: "左辅", 忌: "武曲" },
    癸: { 禄: "破军", 权: "巨门", 科: "太阴", 忌: "贪狼" }
  });
  const OPPOSITES = Object.freeze({
    命宫: "迁移宫", 迁移宫: "命宫", 兄弟宫: "仆役宫", 仆役宫: "兄弟宫",
    夫妻宫: "官禄宫", 官禄宫: "夫妻宫", 子女宫: "田宅宫", 田宅宫: "子女宫",
    财帛宫: "福德宫", 福德宫: "财帛宫", 疾厄宫: "父母宫", 父母宫: "疾厄宫"
  });
  const TRINE_GROUPS = Object.freeze([
    ["申", "子", "辰"], ["亥", "卯", "未"], ["寅", "午", "戌"], ["巳", "酉", "丑"]
  ]);
  const STAR_GROUPS = Object.freeze(["majorStars", "minorStars", "auxiliaryStars"]);
  const STEMS = Object.freeze(["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]);
  const BRANCHES = Object.freeze(["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]);
  // 劫煞按「三合局绝地」逐支列出：申子辰见巳、寅午戌见亥、巳酉丑见寅、亥卯未见申。
  // 不能用「年支 + 常数」代替——那只在局中支（子午卯酉）恰好成立，其余八支会错位。
  const JIESHA_BY_BRANCH = Object.freeze({
    子: "巳", 丑: "寅", 寅: "亥", 卯: "申", 辰: "巳", 巳: "寅",
    午: "亥", 未: "申", 申: "巳", 酉: "寅", 戌: "亥", 亥: "申"
  });
  // 岁前十二神：由年支顺行。龙德第八位、天德第十位、大耗第七位。
  const SUIQIAN_ORDER = Object.freeze(["岁建", "晦气", "丧门", "贯索", "官符", "小耗", "大耗", "龙德", "白虎", "天德", "吊客", "病符"]);
  // 小限起宫：文墨 GlobalConsts._AX_XIAOXIAN_ARR = [0,11,8,5,2,11,8,5,2,11,8,5,2]（下标 1=子），
  // 即申子辰年见戌、巳酉丑年见未、寅午戌年见辰、亥卯未年见丑；方向男顺女逆。
  const XIAOXIAN_START = Object.freeze({
    子: "戌", 丑: "未", 寅: "辰", 卯: "丑", 辰: "戌", 巳: "未",
    午: "辰", 未: "丑", 申: "戌", 酉: "未", 戌: "辰", 亥: "丑"
  });
  const BRIGHTNESS_TEXT = Object.freeze({ 1: "庙", 2: "旺", 3: "得", 4: "利", 5: "平", 6: "不", 7: "陷" });
    // 亮度四套：源文墨天机 2.0.15 的 _AX_SB_QS / _AX_SB_XD1 / _AX_SB_XD2 / _AX_SB_ZZ。
  // 每颗星 12 位数字，子→亥；1 庙 2 旺 3 得 4 利 5 平 6 不 7 陷，0 表示该派不给这颗星定亮度。
  // 默认取「现代修订一」（xd1）：那是文墨的出厂口径；切换门派只改 brightnessSchool，不动排盘。
  const BRIGHTNESS_PROFILES = Object.freeze({
    qs: Object.freeze({
      label: "斗数全书派",
      wmtTable: "_AX_SB_QS",
      stars: Object.freeze({
        紫微: "512232112232", 天机: "173245173245", 太阳: "762122233567", 武曲: "213415213415",
        天同: "264551762551", 廉贞: "541547541547", 天府: "111313213213", 太阴: "112777664221",
        贪狼: "215417215417", 巨门: "261172261172", 天相: "111733131733", 天梁: "121113127317",
        七杀: "211215211215", 破军: "123725123725", 文昌: "317431743174", 文曲: "315231723172",
        左辅: "211715215716", 右弼: "112715216715", 天魁: "220100100002", 天钺: "002002021100",
        禄存: "101101101101", 天马: "002005002005", 火星: "731473147314", 铃星: "731473147314",
        擎羊: "710710710710", 陀罗: "017017017017", 地空: "577571151177", 地劫: "775576151557",
        天福: "502502501101", 天官: "005222110552", 天刑: "571157577117", 八座: "711521251151",
        三台: "515715212125", 天才: "251271251271", 天月: "000000000000", 天巫: "000000000000",
        天空: "757511172275", 天姚: "752175527117", 天哭: "515156751655", 天喜: "271271172172",
        天虚: "712172571275", 天贵: "125225127125", 天寿: "512715522512", 天厨: "000000000000",
        天德: "115512215615", 月德: "000000000000", 台辅: "000000000000", 孤辰: "005007005007",
        咸池: "700500700500", 封诰: "000000000000", 红鸾: "172112271271", 恩光: "515115125716",
        破碎: "070007000500", 阴煞: "000000000000", 华盖: "070010070050", 解神: "151112156215",
        寡宿: "050070060070", 凤阁: "151271576112", 蜚廉: "000000000000", 龙池: "255117615172",
        力士: "000000000000", 大耗: "257657257657", 小耗: "000000000000", 天使: "775575555772",
        天伤: "755755775552", 伏兵: "000000000000", 旬中: "000000000000", 官符: "000000000000",
        空亡: "000000000000", 青龙: "000000000000", 奏书: "000000000000", 飞廉: "000000000000",
        病符: "000000000000", 将军: "000000000000", 博士: "000000000000", 喜神: "000000000000",
        截空: "767571111100", 旬空: "757571171175", 年解: "131112134213", 劫煞: "000000000000",
        龙德: "000000000000", 副截: "767571111100", 副旬: "757571171175",
      })
    }),
    xd1: Object.freeze({
      label: "现代修订一（文墨默认）",
      wmtTable: "_AX_SB_XD1",
      stars: Object.freeze({
        紫微: "511232112232", 天机: "173245173245", 太阳: "762122134577", 武曲: "213415213415",
        天同: "264151762551", 廉贞: "541547541547", 天府: "111323213223", 太阴: "116777754221",
        贪狼: "215317215417", 巨门: "261155251152", 天相: "111753331733", 天梁: "121217127317",
        七杀: "211235211215", 破军: "123725123725", 文昌: "317231743174", 文曲: "315231723172",
        左辅: "211715215716", 右弼: "112715216715", 天魁: "220100100002", 天钺: "002002021100",
        禄存: "101101101101", 天马: "002005002005", 火星: "731473147314", 铃星: "731473147314",
        擎羊: "214714714214", 陀罗: "417417417417", 地空: "577571151177", 地劫: "775576151557",
        天福: "502502501101", 天官: "005222110552", 天刑: "571157577117", 八座: "711521251151",
        三台: "515715212125", 天才: "251271251271", 天月: "000000000000", 天巫: "000000000000",
        天空: "757511172275", 天姚: "752175527117", 天哭: "515156751655", 天喜: "271271172172",
        天虚: "712172571275", 天贵: "125225127125", 天寿: "512715522512", 天厨: "000000000000",
        天德: "115512215615", 月德: "000000000000", 台辅: "000000000000", 孤辰: "005007005007",
        咸池: "700500700500", 封诰: "000000000000", 红鸾: "172112271271", 恩光: "515115125716",
        破碎: "070007000500", 阴煞: "000000000000", 华盖: "070010070050", 解神: "151112156215",
        寡宿: "050070060070", 凤阁: "151271576112", 蜚廉: "000000000000", 龙池: "255117615172",
        力士: "000000000000", 大耗: "257657257657", 小耗: "000000000000", 天使: "775575555772",
        天伤: "755755775552", 伏兵: "000000000000", 旬中: "000000000000", 官符: "000000000000",
        空亡: "000000000000", 青龙: "000000000000", 奏书: "000000000000", 飞廉: "000000000000",
        病符: "000000000000", 将军: "000000000000", 博士: "000000000000", 喜神: "000000000000",
        截空: "767571111100", 旬空: "757571171175", 年解: "131112134213", 劫煞: "000000000000",
        龙德: "000000000000", 副截: "767571111100", 副旬: "757571171175",
      })
    }),
    xd2: Object.freeze({
      label: "现代修订二",
      wmtTable: "_AX_SB_XD2",
      stars: Object.freeze({
        紫微: "411242112352", 天机: "152223152223", 太阳: "552122123355", 武曲: "213513213213",
        天同: "253121552331", 廉贞: "321425311325", 天府: "211312212312", 太阴: "115555552211",
        贪狼: "213215213215", 巨门: "251251251251", 天相: "111523231553", 天梁: "121125125325",
        七杀: "221513221313", 破军: "115223115523", 文昌: "215321432153", 文曲: "125321322153",
        左辅: "212112212212", 右弼: "212112212212", 天魁: "121111121111", 天钺: "121111121111",
        禄存: "201201201201", 天马: "002003002003", 火星: "531253125312", 铃星: "531253125312",
        擎羊: "510510510510", 陀罗: "015015015015", 地空: "355351131155", 地劫: "553354131332",
        天福: "302302301101", 天官: "003222110332", 天刑: "351135355115", 八座: "511321231131",
        三台: "313513212123", 天才: "231251231251", 天月: "000000000000", 天巫: "000000000000",
        天空: "535311152253", 天姚: "532153325115", 天哭: "313134531433", 天喜: "251251152152",
        天虚: "512152351253", 天贵: "123223125123", 天寿: "312513322312", 天厨: "000000000000",
        天德: "113312213413", 月德: "000000000000", 台辅: "000000000000", 孤辰: "003005003005",
        咸池: "500300500300", 封诰: "000000000000", 红鸾: "152112251251", 恩光: "313113123514",
        破碎: "050005000300", 阴煞: "000000000000", 华盖: "050010050030", 解神: "131112134213",
        寡宿: "030050040050", 凤阁: "131251354112", 蜚廉: "000000000000", 龙池: "233115413152",
        力士: "000000000000", 大耗: "235435235435", 小耗: "000000000000", 天使: "553353333552",
        天伤: "533533553332", 伏兵: "000000000000", 旬中: "000000000000", 官符: "000000000000",
        空亡: "000000000000", 青龙: "000000000000", 奏书: "000000000000", 飞廉: "000000000000",
        病符: "000000000000", 将军: "000000000000", 博士: "000000000000", 喜神: "000000000000",
        截空: "545351111100", 旬空: "535351151153", 年解: "131112134213", 劫煞: "000000000000",
        龙德: "000000000000", 副截: "545351111100", 副旬: "535351151153",
      })
    }),
    zz: Object.freeze({
      label: "中州派",
      wmtTable: "_AX_SB_ZZ",
      stars: Object.freeze({
        紫微: "311252112342", 天机: "152213153213", 太阳: "552122134455", 武曲: "214513213213",
        天同: "254131552331", 廉贞: "321425311325", 天府: "111313213512", 太阴: "114545533221",
        贪狼: "213415213315", 巨门: "221133251122", 天相: "111523241543", 天梁: "121125125425",
        七杀: "211523221413", 破军: "125224115523", 文昌: "215321532152", 文曲: "113211523152",
        左辅: "211513213514", 右弼: "112513214513", 天魁: "220100100002", 天钺: "002002021100",
        禄存: "201201201201", 天马: "002003002003", 火星: "321342145513", 铃星: "551122122511",
        擎羊: "510510310510", 陀罗: "015015015015", 地空: "355351131155", 地劫: "553354131332",
        天福: "302302301101", 天官: "003222110332", 天刑: "351135355115", 八座: "511321231131",
        三台: "313513212123", 天才: "231251231251", 天月: "000000000000", 天巫: "000000000000",
        天空: "535311152253", 天姚: "532153325115", 天哭: "313134531433", 天喜: "251251152152",
        天虚: "512152351253", 天贵: "123223125123", 天寿: "312513322312", 天厨: "000000000000",
        天德: "113312213413", 月德: "000000000000", 台辅: "000000000000", 孤辰: "003005003005",
        咸池: "500300500300", 封诰: "000000000000", 红鸾: "152112251251", 恩光: "313113123514",
        破碎: "050005000300", 阴煞: "000000000000", 华盖: "050010050030", 解神: "131112134213",
        寡宿: "030050040050", 凤阁: "131251354112", 蜚廉: "000000000000", 龙池: "233115413152",
        力士: "000000000000", 大耗: "235435235435", 小耗: "000000000000", 天使: "553353333552",
        天伤: "533533553332", 伏兵: "000000000000", 旬中: "000000000000", 官符: "000000000000",
        空亡: "000000000000", 青龙: "000000000000", 奏书: "000000000000", 飞廉: "000000000000",
        病符: "000000000000", 将军: "000000000000", 博士: "000000000000", 喜神: "000000000000",
        截空: "545351111100", 旬空: "535351151153", 年解: "131112134213", 劫煞: "000000000000",
        龙德: "000000000000", 副截: "545351111100", 副旬: "535351151153",
      })
    }),
  });
  const BRIGHTNESS_DEFAULT_PROFILE = "qs";
  const BRIGHTNESS_PROFILE_ALIASES = Object.freeze({
    qs: "qs", "全书": "qs", "斗数全书": "qs", "斗数全书派": "qs", QS: "qs",
    xd1: "xd1", "现代一": "xd1", "现代修订一": "xd1", XD1: "xd1",
    xd2: "xd2", "现代二": "xd2", "现代修订二": "xd2", XD2: "xd2",
    zz: "zz", "中州": "zz", "中州派": "zz", ZZ: "zz"
  });
  // 引擎与文墨对同一颗星的写法偶有差异，这里只放已经核过的别名。
  const BRIGHTNESS_STAR_ALIASES = Object.freeze({ 官府: "官符" });
  function resolveBrightnessProfile(name) {
    const raw = String(name ?? "").trim();
    if (!raw) return null;
    const alias = BRIGHTNESS_PROFILE_ALIASES[raw];
    if (alias) return alias;
    const key = raw.toLowerCase();
    return BRIGHTNESS_PROFILES[key] ? key : null;
  }
  function brightnessOf(profileId, starName, branchIndex) {
    const profile = BRIGHTNESS_PROFILES[profileId];
    if (!profile) return { known: false, label: null };
    const name = profile.stars[starName] ? starName : BRIGHTNESS_STAR_ALIASES[starName];
    const row = profile.stars[name];
    if (!row) return { known: false, label: null };
    return { known: true, label: BRIGHTNESS_TEXT[Number(row[branchIndex])] || null };
  }

  function findStar(palaces, name) {
    for (const palace of palaces) {
      for (const group of STAR_GROUPS) {
        const index = palace[group].findIndex(star => star.name === name);
        if (index >= 0) return { palace, group, index, star: palace[group][index] };
      }
    }
    return null;
  }

  function moveStarToBranch(palaces, name, branch, corrections, code = "WMT_XIN_KUI_YUE", reason = "辛年天魁天钺按文墨金标准校正") {
    const found = findStar(palaces, name);
    const target = palaces.find(palace => palace.earthlyBranch === branch);
    if (!found || !target || found.palace === target) return;
    found.palace[found.group].splice(found.index, 1);
    target[found.group].push(found.star);
    corrections.push({
      code,
      star: name,
      fromPalace: found.palace.name,
      toPalace: target.name,
      reason
    });
  }

  function addAuxiliaryStar(palaces, branchIndex, name, corrections, code, reason) {
    if (findStar(palaces, name)) return;
    const target = palaces.find(palace => BRANCHES.indexOf(palace.earthlyBranch) === branchIndex);
    if (!target) return;
    target.auxiliaryStars.push({ name, type: "adjective", scope: "origin", brightness: null, transformation: null });
    corrections.push({ code, star: name, fromPalace: null, toPalace: target.name, reason });
  }

  // 把一颗星「唯一化」地放到目标宫：清掉源盘里所有同名项，保留一颗（优先沿用原对象），
  // 再放进目标宫。用于文墨口径下必须恰有一枚、且位置由年支决定的神煞（劫煞、龙德）。
  // 返回目标宫对象；目标宫不存在时返回 null，由调用方判失败。
  function placeUniqueStar(palaces, name, branchIndex, corrections, code, reason) {
    const target = palaces.find(palace => BRANCHES.indexOf(palace.earthlyBranch) === branchIndex);
    if (!target) return null;
    const found = [];
    palaces.forEach(palace => {
      STAR_GROUPS.forEach(group => {
        for (let i = palace[group].length - 1; i >= 0; i -= 1) {
          // 命盘级神煞只有一枚：不能因为 scope 不同就当成两颗（annual/decadal 的同名星
          // 在本管线里就是同一颗星的不同标注，留着会出现两枚劫煞）。
          if (palace[group][i].name === name) {
            found.push({ palace, group, star: palace[group][i] });
            palace[group].splice(i, 1);
          }
        }
      });
    });
    const first = found[0] || null;
    const group = first ? first.group : "auxiliaryStars";
    const star = first
      ? first.star
      : { name, type: "adjective", scope: "origin", brightness: null, transformation: null };
    target[group].push(star);
    corrections.push({
      code,
      star: name,
      fromPalace: first ? first.palace.name : null,
      toPalace: target.name,
      removedDuplicates: Math.max(0, found.length - 1),
      reason
    });
    return target;
  }

  // 只按选定门派给「该派有定义」的星曜赋亮度；0 或未收录保持 null，不猜。
  function applyDefaultBrightness(palaces, brightnessSchool) {
    const profile = resolveBrightnessProfile(brightnessSchool) || BRIGHTNESS_DEFAULT_PROFILE;
    palaces.forEach(palace => {
      const branchIndex = BRANCHES.indexOf(palace.earthlyBranch);
      STAR_GROUPS.forEach(group => palace[group].forEach(star => {
        const found = brightnessOf(profile, star.name, branchIndex);
        if (found.known) star.brightness = found.label;
      }));
    });
    return profile;
  }

  // 只做劫煞/龙德两枚星的唯一化放置，不碰亮度、改名、其他神煞。
  // 单独导出是为了能验证「这一步不改动其他星曜的内容与顺序」（r740 major）。
  function ensureUniqueStars(yearBranch, palaces) {
    const result = { corrections: [], jieShaBranch: null, longDeBranch: null };
    const yearBranchIndex = BRANCHES.indexOf(yearBranch);
    // 与 applyKnownCorrections 同一契约：年支非法就是错误，不能静默返回空结果，
    // 否则调用方会拿到「没有劫煞/龙德」的盘却不知道是漏算（Codex r741 major）。
    if (yearBranchIndex < 0) {
      throw Object.assign(new Error(`ZIWEI_YEAR_BRANCH_INVALID: ${yearBranch || "(empty)"}`), {
        code: "ZIWEI_YEAR_BRANCH_INVALID"
      });
    }
    const jieShaBranch = JIESHA_BY_BRANCH[yearBranch];
    const longDeBranch = BRANCHES[(yearBranchIndex + SUIQIAN_ORDER.indexOf("龙德")) % 12];
    const jieShaTarget = palaces.find(palace => palace.earthlyBranch === jieShaBranch);
    const longDeTarget = palaces.find(palace => palace.earthlyBranch === longDeBranch);
    if (!jieShaTarget || !longDeTarget) {
      throw Object.assign(new Error(`ZIWEI_PALACE_TARGET_MISSING: 劫煞→${jieShaBranch || "(none)"}、龙德→${longDeBranch || "(none)"}`), {
        code: "ZIWEI_PALACE_TARGET_MISSING"
      });
    }
    placeUniqueStar(palaces, "劫煞", BRANCHES.indexOf(jieShaBranch), result.corrections, "WMT_JIESHA_ADDED",
      `劫煞取年支三合局绝地（${yearBranch}年见${jieShaBranch}）：申子辰见巳、寅午戌见亥、巳酉丑见寅、亥卯未见申`);
    placeUniqueStar(palaces, "龙德", BRANCHES.indexOf(longDeBranch), result.corrections, "WMT_LONGDE_ADDED",
      "龙德为岁前十二神第八位，由年支顺行起算（年支 +7）");
    result.jieShaBranch = jieShaBranch;
    result.longDeBranch = longDeBranch;
    return result;
  }

  function applyKnownCorrections(yearStem, yearBranch, palaces, brightnessSchool) {
    const corrections = [];
    // 年支校验必须在任何修改之前完成：否则非法年支时前面的改名/移位已经落盘，
    // 抛错后命盘既不完整也不可用（Codex r739 major）。
    const yearBranchIndex = BRANCHES.indexOf(yearBranch);
    if (yearBranchIndex < 0) {
      throw Object.assign(new Error(`ZIWEI_YEAR_BRANCH_INVALID: ${yearBranch || "(empty)"}`), {
        code: "ZIWEI_YEAR_BRANCH_INVALID"
      });
    }
    // 劫煞/龙德的目标宫也必须在任何修改之前确认：两枚星由年支唯一决定，
    // 目标宫缺失时应当整体失败，而不是先补大耗、改天魁再抛错（Codex r739 major）。
    const jieShaBranch = JIESHA_BY_BRANCH[yearBranch];
    const longDeBranch = BRANCHES[(yearBranchIndex + SUIQIAN_ORDER.indexOf("龙德")) % 12];
    const jieShaTarget = palaces.find(palace => palace.earthlyBranch === jieShaBranch);
    const longDeTarget = palaces.find(palace => palace.earthlyBranch === longDeBranch);
    if (!jieShaTarget || !longDeTarget) {
      throw Object.assign(new Error(`ZIWEI_PALACE_TARGET_MISSING: 劫煞→${jieShaBranch || "(none)"}、龙德→${longDeBranch || "(none)"}`), {
        code: "ZIWEI_PALACE_TARGET_MISSING"
      });
    }
    if (yearStem === "辛") {
      moveStarToBranch(palaces, "天魁", "寅", corrections);
      moveStarToBranch(palaces, "天钺", "午", corrections);
    }
    const yearStemIndex = STEMS.indexOf(yearStem);
    const jie = findStar(palaces, "截路");
    const fu = findStar(palaces, "空亡");
    if (jie) {
      jie.star.name = "截空";
      corrections.push({ code: "WMT_JIEKONG_RENAMED", star: "截空", fromPalace: jie.palace.name, toPalace: jie.palace.name, reason: "截路统一为默认口径名称截空" });
    }
    if (fu) {
      fu.star.name = "副截";
      corrections.push({ code: "WMT_JIEKONG_RENAMED", star: "副截", fromPalace: fu.palace.name, toPalace: fu.palace.name, reason: "空亡统一为默认双星口径名称副截" });
    }
    if (yearStemIndex % 2 === 1) {
      const renamedJie = findStar(palaces, "截空");
      const renamedFu = findStar(palaces, "副截");
      // 对调是对合操作：不加标记的话重复调用会把两星换回去，同一份输入出两个结果。
      // 标记用不可枚举属性，既不影响输出 JSON，也保证幂等（Codex r739 major）。
      const alreadySwapped = Boolean(renamedJie && renamedJie.star.__jekongSwapped && renamedFu && renamedFu.star.__jekongSwapped);
      if (renamedJie && renamedFu && !alreadySwapped && renamedJie.palace !== renamedFu.palace) {
        const jieBranch = renamedJie.palace.earthlyBranch;
        const fuBranch = renamedFu.palace.earthlyBranch;
        moveStarToBranch(palaces, "截空", fuBranch, corrections, "WMT_JIEKONG_YIN_STEM", "阴干年截空与副截按默认双星口径对调");
        moveStarToBranch(palaces, "副截", jieBranch, corrections, "WMT_JIEKONG_YIN_STEM", "阴干年截空与副截按默认双星口径对调");
        for (const star of [renamedJie.star, renamedFu.star]) {
          Object.defineProperty(star, "__jekongSwapped", { value: true, enumerable: false, configurable: true });
        }
      }
    }
    const xun = findStar(palaces, "旬空");
    if (xun) {
      const xunIndex = BRANCHES.indexOf(xun.palace.earthlyBranch);
      const companionIndex = xunIndex % 2 === 0 ? (xunIndex + 1) % 12 : (xunIndex + 11) % 12;
      addAuxiliaryStar(palaces, companionIndex, "副旬", corrections, "WMT_FUXUN_ADDED", "旬空按默认口径补成对副旬");
    }
    const suiPo = (yearBranchIndex + 6) % 12;
    const dahaoIndex = yearBranchIndex % 2 === 0 ? (suiPo + 1) % 12 : (suiPo + 11) % 12;
    addAuxiliaryStar(palaces, dahaoIndex, "大耗", corrections, "WMT_DAHAO_ADDED", "年支大耗按阳支岁破加一、阴支岁破减一安置");
    // 劫煞与龙德必须「恰有一枚、位置由年支唯一决定」：源盘若已有错位或重复的同名星，
    // 只 add 会留下错位项与重复项（Codex r739 #1/#2），因此统一走唯一化放置。
    // 目标宫已在函数入口校验过，这里复用同一段唯一化逻辑（不重复实现）。
    const unique = ensureUniqueStars(yearBranch, palaces);
    corrections.push(...unique.corrections);
    // 龙德有两套：文墨「岁前星」那一排由命宫起算（其常量表 [0,8,9,10,11,12,1,2,3,4,5,6,7]），
    // 与本命盘福德宫那枚「龙德」不是同一颗；后者的起法尚未从代码里确认，故不在此处补，
    // 未决记录写在 docs/wmt-chart-crosscheck.md，不塞进 corrections（避免每盘都带一条空位诊断）。
    applyDefaultBrightness(palaces, brightnessSchool);
    return corrections;
  }

  function buildFourTransformations(yearStem, palaces) {
    const table = FOUR_HUA[yearStem] || {};
    return HUA_KINDS.map(kind => {
      const starName = table[kind] || null;
      const found = starName ? findStar(palaces, starName) : null;
      if (found) found.star.transformation = kind;
      return {
        evidenceId: `origin.four_hua.${HUA_KEYS[kind]}`,
        kind,
        star: starName,
        palace: found?.palace.name || null,
        palaceBranch: found?.palace.earthlyBranch || null,
        starType: found?.star.type || null,
        source: "year-stem-table"
      };
    });
  }

  function buildPalaceFlying(palaces) {
    return palaces.flatMap(sourcePalace => {
      const table = FOUR_HUA[sourcePalace.heavenlyStem] || {};
      return HUA_KINDS.map(kind => {
        const starName = table[kind] || null;
        const found = starName ? findStar(palaces, starName) : null;
        const isSelfTarget = Boolean(found && found.palace.name === sourcePalace.name);
        return {
          evidenceId: `origin.palace_flying.${sourcePalace.name}.${HUA_KEYS[kind]}`,
          kind,
          star: starName,
          sourcePalace: sourcePalace.name,
          sourceStem: sourcePalace.heavenlyStem,
          sourceBranch: sourcePalace.earthlyBranch,
          targetPalace: found?.palace.name || null,
          targetBranch: found?.palace.earthlyBranch || null,
          isSelfTarget,
          selfTransformDirection: isSelfTarget ? "outward" : null,
          interpretationAllowed: true,
          source: "palace-stem-table"
        };
      });
    });
  }

  function buildSelfTransformations(palaceFlying) {
    return palaceFlying.flatMap(item => {
      if (item.isSelfTarget) {
        return [{
          evidenceId: `origin.self_transform.${item.sourcePalace}.${HUA_KEYS[item.kind]}.outward`,
          palace: item.sourcePalace,
          sourcePalace: item.sourcePalace,
          kind: item.kind,
          star: item.star,
          direction: "outward",
          symbol: "↓",
          interpretationAllowed: true,
          source: "palace-stem-position-rule-v1"
        }];
      }
      if (OPPOSITES[item.sourcePalace] === item.targetPalace) {
        return [{
          evidenceId: `origin.self_transform.${item.targetPalace}.${HUA_KEYS[item.kind]}.inward`,
          palace: item.targetPalace,
          sourcePalace: item.sourcePalace,
          kind: item.kind,
          star: item.star,
          direction: "inward",
          symbol: "↑",
          interpretationAllowed: true,
          source: "palace-stem-position-rule-v1"
        }];
      }
      return [];
    });
  }

  function buildJiChains(palaces, palaceFlying) {
    const jiBySource = new Map(
      palaceFlying.filter(item => item.kind === "忌").map(item => [item.sourcePalace, item])
    );
    return palaces.map(start => {
      const visited = new Set();
      const steps = [];
      let currentPalace = start.name;
      let termination = "max-depth";
      let loopPalace = null;

      for (let depth = 0; depth < palaces.length; depth += 1) {
        if (visited.has(currentPalace)) {
          termination = "loop";
          loopPalace = currentPalace;
          break;
        }
        visited.add(currentPalace);
        const binding = jiBySource.get(currentPalace);
        if (!binding?.targetPalace) {
          termination = "missing";
          break;
        }
        steps.push({
          fromPalace: binding.sourcePalace,
          fromStem: binding.sourceStem,
          star: binding.star,
          toPalace: binding.targetPalace
        });
        currentPalace = binding.targetPalace;
        if (visited.has(currentPalace)) {
          termination = "loop";
          loopPalace = currentPalace;
          break;
        }
      }

      return {
        evidenceId: `origin.ji_chain.${start.name}`,
        startPalace: start.name,
        steps,
        termination,
        loopPalace
      };
    });
  }

  function validatePalaceFlying(palaces, palaceFlying, jiChains, selfTransformations) {
    const checks = [
      {
        id: "palace_flying_48_bindings_complete",
        pass: palaceFlying.length === 48 && palaceFlying.every(item => item.star && item.sourcePalace && item.targetPalace),
        message: "十二宫各自的禄权科忌共四十八条落点完整"
      },
      {
        id: "twelve_ji_chains_traceable",
        pass: jiChains.length === 12 && jiChains.every(chain => chain.steps.length > 0 && chain.termination !== "missing"),
        message: "十二宫化忌链均可从起点追踪至闭环"
      },
      {
        id: "self_transform_direction_resolved",
        pass: selfTransformations.every(item => ["inward", "outward"].includes(item.direction) && ["↑", "↓"].includes(item.symbol)),
        message: "自化均按同宫离心、对宫向心规则绑定方向"
      }
    ];
    return {
      status: checks.every(check => check.pass) ? "pass" : "fail",
      checks,
      hardFailures: checks.filter(check => !check.pass).map(check => check.id)
    };
  }

  function normalizePalaceName(name) {
    if (!name) return null;
    return name.endsWith("宫") ? name : `${name}宫`;
  }

  function layerPalaceName(item, palace) {
    return normalizePalaceName(item?.palaceNames?.[palace.index]);
  }

  function buildPeriodTransformations(scope, item, palaces, decadalItem = null) {
    return HUA_KINDS.map((kind, index) => {
      const starName = item?.mutagen?.[index] || null;
      const found = starName ? findStar(palaces, starName) : null;
      return {
        evidenceId: `${scope}.four_hua.${HUA_KEYS[kind]}`,
        kind,
        star: starName,
        natalPalace: found?.palace.name || null,
        natalPalaceBranch: found?.palace.earthlyBranch || null,
        decadalPalace: found && decadalItem ? layerPalaceName(decadalItem, found.palace) : null,
        periodPalace: found ? layerPalaceName(item, found.palace) : null,
        source: "iztro-period-mutagen"
      };
    });
  }

  function buildOverlay(item, palaces, decadalItem = null) {
    return palaces.map(palace => ({
      branch: palace.earthlyBranch,
      natalPalace: palace.name,
      decadalPalace: decadalItem ? layerPalaceName(decadalItem, palace) : null,
      periodPalace: layerPalaceName(item, palace)
    }));
  }

  function buildLayerFlying(scope, item, palaces, decadalItem = null) {
    return palaces.flatMap(sourcePalace => {
      const sourceLayerPalace = layerPalaceName(item, sourcePalace);
      const table = FOUR_HUA[sourcePalace.heavenlyStem] || {};
      return HUA_KINDS.map(kind => {
        const starName = table[kind] || null;
        const found = starName ? findStar(palaces, starName) : null;
        return {
          evidenceId: `${scope}.palace_flying.${sourceLayerPalace}.${HUA_KEYS[kind]}`,
          kind,
          star: starName,
          sourceNatalPalace: sourcePalace.name,
          sourcePeriodPalace: sourceLayerPalace,
          sourceStem: sourcePalace.heavenlyStem,
          targetNatalPalace: found?.palace.name || null,
          targetDecadalPalace: found && decadalItem ? layerPalaceName(decadalItem, found.palace) : null,
          targetPeriodPalace: found ? layerPalaceName(item, found.palace) : null,
          source: "layer-palace-stem-table"
        };
      });
    });
  }

  function buildMultiLayerOverlay(palaces, layers) {
    return palaces.map(palace => ({
      branch: palace.earthlyBranch,
      natalPalace: palace.name,
      decadalPalace: layerPalaceName(layers.decadal, palace),
      annualPalace: layerPalaceName(layers.annual, palace),
      monthlyPalace: layerPalaceName(layers.monthly, palace),
      dailyPalace: layerPalaceName(layers.daily, palace),
      hourlyPalace: layerPalaceName(layers.hourly, palace)
    }));
  }

  function buildFineTimingItem(scope, item, palaces, layers) {
    const fourTransformations = HUA_KINDS.map((kind, index) => {
      const starName = item?.mutagen?.[index] || null;
      const found = starName ? findStar(palaces, starName) : null;
      return {
        evidenceId: `${scope}.four_hua.${HUA_KEYS[kind]}`,
        kind,
        star: starName,
        natalPalace: found?.palace.name || null,
        decadalPalace: found ? layerPalaceName(layers.decadal, found.palace) : null,
        annualPalace: found ? layerPalaceName(layers.annual, found.palace) : null,
        monthlyPalace: found ? layerPalaceName(layers.monthly, found.palace) : null,
        dailyPalace: found ? layerPalaceName(layers.daily, found.palace) : null,
        hourlyPalace: found ? layerPalaceName(layers.hourly, found.palace) : null,
        source: "iztro-horoscope-mutagen"
      };
    });
    const stemOk = STEM_SET.has(item?.heavenlyStem);
    const branchOk = BRANCH_SET.has(item?.earthlyBranch);
    return {
      name: item?.name || null,
      // 干支必须两字都合法；否则拼出 "undefinedundefined" 会被当成真值
      ganzhi: stemOk && branchOk ? `${item.heavenlyStem}${item.earthlyBranch}` : null,
      ganzhiValid: stemOk && branchOk,
      palaceOverlay: buildMultiLayerOverlay(palaces, layers),
      fourTransformations,
      transitStars: buildTransitStars(item, palaces),
      // 记录原始 stars 字段是否存在与结构槽位数量：
      // 引擎没给 stars 时展开结果会是空数组，空数组 every 恒真会被误判为"已校验"。
      starsProvided: Array.isArray(item?.stars),
      starsSlotCount: Array.isArray(item?.stars) ? item.stars.length : 0,
      starSlotsValid: Array.isArray(item?.stars) && item.stars.every(slot => Array.isArray(slot))
    };
  }

  function buildTransitStars(item, palaces) {
    return (item?.stars || []).flatMap((stars, index) => {
      const palace = palaces.find(candidate => candidate.index === index);
      return (stars || []).map(star => ({
        name: star.name,
        type: star.type,
        scope: star.scope,
        natalPalace: palace?.name || null,
        periodPalace: palace ? layerPalaceName(item, palace) : null
      }));
    });
  }

  function buildDecadalItem(item, palaces) {
    return {
      index: item.index,
      name: item.name,
      natalAnchorPalace: normalizePalaceName(item.palaceName),
      ageRange: [...item.ageRange],
      yearRange: [...item.yearRange],
      ganzhi: `${item.heavenlyStem}${item.earthlyBranch}`,
      palaceOverlay: buildOverlay(item, palaces),
      fourTransformations: buildPeriodTransformations("decadal", item, palaces),
      palaceFlying: buildLayerFlying("decadal", item, palaces),
      transitStars: buildTransitStars(item, palaces)
    };
  }

  function buildAnnualItem(item, palaces, decadalItem) {
    return {
      index: item.index,
      name: item.name,
      year: item.year,
      nominalAge: item.age,
      ganzhi: `${item.heavenlyStem}${item.earthlyBranch}`,
      palaceOverlay: buildOverlay(item, palaces, decadalItem),
      fourTransformations: buildPeriodTransformations("annual", item, palaces, decadalItem),
      palaceFlying: buildLayerFlying("annual", item, palaces, decadalItem),
      transitStars: buildTransitStars(item, palaces)
    };
  }

  function validatePeriod(item, expectedScope) {
    if (!item) {
      return { status: "unavailable", checks: [], hardFailures: [`${expectedScope}_not_found`] };
    }
    const checks = [
      {
        id: `${expectedScope}_twelve_palaces_unique`,
        pass: item.palaceOverlay.length === 12 && new Set(item.palaceOverlay.map(row => row.periodPalace)).size === 12,
        message: `${expectedScope === "decadal" ? "大限" : "流年"}十二宫叠宫完整且唯一`
      },
      {
        id: `${expectedScope}_four_hua_complete`,
        pass: item.fourTransformations.length === 4 && item.fourTransformations.every(row => row.star && row.natalPalace && row.periodPalace),
        message: `${expectedScope === "decadal" ? "大限" : "流年"}四化均已绑定本命宫与运限宫`
      },
      {
        id: `${expectedScope}_palace_flying_complete`,
        pass: item.palaceFlying.length === 48 && item.palaceFlying.every(row => row.star && row.sourcePeriodPalace && row.targetPeriodPalace),
        message: `${expectedScope === "decadal" ? "大限" : "流年"}十二宫飞化四十八条落点完整`
      }
    ];
    return {
      status: checks.every(check => check.pass) ? "pass" : "fail",
      checks,
      hardFailures: checks.filter(check => !check.pass).map(check => check.id)
    };
  }

  function buildChildhoodLimits(rawDecadals, palaces, lunarYear) {
    const firstStartAge = Number(rawDecadals[0]?.ageRange?.[0]);
    const soulPalace = palaces.find(palace => palace.name === "命宫");
    const offsets = { 1: 0, 2: -4, 3: -5, 4: -2, 5: 2 };
    if (!Number.isFinite(firstStartAge) || firstStartAge <= 1 || !soulPalace || !Number.isFinite(lunarYear)) return [];
    return Array.from({ length: firstStartAge - 1 }, (_, index) => {
      const nominalAge = index + 1;
      const targetIndex = ((soulPalace.index + (offsets[nominalAge] ?? 0)) % 12 + 12) % 12;
      const anchor = palaces.find(palace => palace.index === targetIndex);
      return {
        evidenceId: `childhood.age.${nominalAge}`,
        nominalAge,
        year: lunarYear + nominalAge - 1,
        natalAnchorPalace: anchor?.name || null,
        natalAnchorBranch: anchor?.earthlyBranch || null,
        source: "Renhuai123-childhood-offset-v1"
      };
    });
  }

  function buildPeriods(astrolabe, palaces, asOfYear, lunarYear) {
    const rawDecadals = astrolabe?.decadalList?.() || [];
    const activeRawDecadal = rawDecadals.find(item => item.yearRange?.[0] <= asOfYear && asOfYear <= item.yearRange?.[1]) || null;
    const activeDecadal = activeRawDecadal ? buildDecadalItem(activeRawDecadal, palaces) : null;
    const rawAnnual = activeRawDecadal
      ? (astrolabe.yearlyList(rawDecadals.indexOf(activeRawDecadal)) || []).find(item => item.year === asOfYear) || null
      : null;
    const annual = rawAnnual ? buildAnnualItem(rawAnnual, palaces, activeRawDecadal) : null;
    return {
      asOfYear,
      childhood: buildChildhoodLimits(rawDecadals, palaces, lunarYear),
      decadals: rawDecadals.map(item => buildDecadalItem(item, palaces)),
      current: {
        decadal: activeDecadal,
        annual
      },
      validation: {
        decadal: validatePeriod(activeDecadal, "decadal"),
        annual: validatePeriod(annual, "annual")
      }
    };
  }

  // ── §16 #15：当前大限逐流年事实 ─────────────────────────────────
  // 与 fineTiming 的分工：fineTiming 只给"此刻所在的月/日/时"，
  // 这里给出整个大限覆盖的每一年，供应期逐级判定使用。
  // 只记录可追溯到「大限四化」与「流年四化」两层的落点与重合，
  // 不下任何断语，也不判定吉凶。

  function oppositeOfPalaceName(name) {
    return name ? OPPOSITES[name] || null : null;
  }

  /** 生年四化落点：从星曜上的 transformation 字段反查，不另外推算年干。 */
  function buildNatalHuaMap(palaces) {
    const map = { 禄: null, 权: null, 科: null, 忌: null };
    for (const palace of palaces) {
      for (const group of STAR_GROUPS) {
        for (const star of palace[group] || []) {
          const kind = star?.transformation;
          if (!kind || !HUA_KINDS.includes(kind)) continue;
          if (map[kind] !== null) continue;
          map[kind] = { star: star.name, palace: palace.name, branch: palace.earthlyBranch };
        }
      }
    }
    return map;
  }

  /**
   * 流年四化落点与大限四化落点的重合关系（引动的可追溯最小集）。
   * 同时记录与生年四化落点的同宫/对冲，供应期逐层判定时引用。
   */
  function buildAnnualActivation(annual, decadal, palaces) {
    const decadalSoul = decadal?.natalAnchorPalace || null;
    const decadalSoulOpposite = oppositeOfPalaceName(decadalSoul);
    const decadalHua = decadal?.fourTransformations || [];
    const natalHua = buildNatalHuaMap(palaces);
    const rows = [];
    for (const annualHua of annual.fourTransformations) {
      const evidenceId = `annual.activation.${HUA_KEYS[annualHua.kind]}`;
      if (!annualHua.natalPalace) {
        rows.push({
          evidenceId,
          kind: annualHua.kind,
          star: annualHua.star,
          natalPalace: null,
          decadalPalace: null,
          annualPalace: null,
          onDecadalSoul: false,
          onDecadalSoulOpposite: false,
          stackedOnDecadalHua: [],
          stacked: false,
          overlapsNatal: [],
          status: "unavailable",
          reason: "该化星未在本命盘定位到宫位"
        });
        continue;
      }
      const samePalaceDecadalHua = decadalHua
        .filter(row => row.natalPalace === annualHua.natalPalace)
        .map(row => ({ kind: row.kind, star: row.star }));
      const opposite = oppositeOfPalaceName(annualHua.natalPalace);
      const overlapsNatal = HUA_KINDS
        .filter(kind => natalHua[kind] !== null)
        .map(kind => {
          const target = natalHua[kind];
          if (target.palace === annualHua.natalPalace) {
            return { natalKind: kind, star: target.star, palace: target.palace, relation: "同宫" };
          }
          if (opposite !== null && target.palace === opposite) {
            return { natalKind: kind, star: target.star, palace: target.palace, relation: "对冲" };
          }
          return null;
        })
        .filter(Boolean);
      rows.push({
        evidenceId,
        kind: annualHua.kind,
        star: annualHua.star,
        natalPalace: annualHua.natalPalace,
        decadalPalace: annualHua.decadalPalace,
        annualPalace: annualHua.periodPalace,
        onDecadalSoul: decadalSoul !== null && annualHua.natalPalace === decadalSoul,
        onDecadalSoulOpposite: decadalSoulOpposite !== null
          && annualHua.natalPalace === decadalSoulOpposite,
        stackedOnDecadalHua: samePalaceDecadalHua,
        stacked: samePalaceDecadalHua.length > 0,
        overlapsNatal,
        status: "ok"
      });
    }
    return {
      decadalSoulPalace: decadalSoul,
      decadalSoulOppositePalace: decadalSoulOpposite,
      natalHua,
      rows,
      stackedRows: rows.filter(row => row.stacked),
      onDecadalSoulRows: rows.filter(row => row.onDecadalSoul || row.onDecadalSoulOpposite),
      natalOverlapRows: rows.filter(row => (row.overlapsNatal || []).length > 0)
    };
  }

  /**
   * 大限干支与流年干支的关系。
   * 只做两种有确定定义的判定，不做吉凶推断：
   *   岁运并临 = 干支全同；天克地冲 = 天干相克且地支相冲。
   * 天干相克按五行（甲乙木克戊己土…），序差为 4 或 6。
   */
  function buildDecadalAnnualGanzhiRelation(decadalGanzhi, annualGanzhi) {
    const decStem = decadalGanzhi?.[0] || null;
    const decBranch = decadalGanzhi?.[1] || null;
    const annStem = annualGanzhi?.[0] || null;
    const annBranch = annualGanzhi?.[1] || null;
    const stemIndex = value => STEMS.indexOf(value);
    const branchIndex = value => BRANCHES.indexOf(value);
    if (stemIndex(decStem) < 0 || stemIndex(annStem) < 0
      || branchIndex(decBranch) < 0 || branchIndex(annBranch) < 0) {
      return { status: "unavailable", relation: [], reason: "干支不是合法组合" };
    }
    const relation = [];
    if (decStem === annStem && decBranch === annBranch) {
      relation.push({
        kind: "岁运并临",
        detail: `大限 ${decadalGanzhi} 与流年 ${annualGanzhi} 干支全同`
      });
    }
    const stemDelta = (stemIndex(annStem) - stemIndex(decStem) + 10) % 10;
    const stemClash = stemDelta === 4 || stemDelta === 6;
    const branchClash = (branchIndex(annBranch) - branchIndex(decBranch) + 12) % 12 === 6;
    if (stemClash && branchClash) {
      relation.push({
        kind: "天克地冲",
        detail: `大限 ${decadalGanzhi} 与流年 ${annualGanzhi} 天干相克且地支相冲`
      });
    }
    return {
      status: "ok",
      sameStem: decStem === annStem,
      sameBranch: decBranch === annBranch,
      stemClash,
      branchClash,
      relation
    };
  }

  /** 大限起止与流年边界的对账：条目数、连续性、首末年、虚岁递增。 */
  function buildAnnualBoundaryAudit(decadal, years) {
    const yearRange = Array.isArray(decadal?.yearRange) ? decadal.yearRange : [];
    const ageRange = Array.isArray(decadal?.ageRange) ? decadal.ageRange : [];
    const expectedFirst = Number.isFinite(yearRange[0]) ? yearRange[0] : null;
    const expectedLast = Number.isFinite(yearRange[1]) ? yearRange[1] : null;
    const expectedCount = expectedFirst !== null && expectedLast !== null
      ? expectedLast - expectedFirst + 1
      : null;
    const actualYears = years.map(item => item.year);
    const checks = [
      {
        id: "annual_count_matches_year_range",
        pass: expectedCount !== null && years.length === expectedCount,
        message: `流年条目数 ${years.length} 应等于大限年跨度 ${expectedCount === null ? "未知" : expectedCount}`
      },
      {
        id: "annual_years_contiguous",
        pass: actualYears.length > 0
          && actualYears.every((year, index) => index === 0 || year === actualYears[index - 1] + 1),
        message: "流年逐年连续、无缺年、无重复"
      },
      {
        id: "annual_first_last_match_year_range",
        pass: actualYears.length > 0
          && actualYears[0] === expectedFirst
          && actualYears[actualYears.length - 1] === expectedLast,
        message: `首年 ${actualYears[0]} / 末年 ${actualYears[actualYears.length - 1]} 应与大限 ${expectedFirst}–${expectedLast} 一致`
      },
      {
        id: "annual_nominal_age_matches_age_range",
        pass: Number.isFinite(ageRange[0])
          && years.every((item, index) => item.nominalAge === ageRange[0] + index),
        message: "流年虚岁应自大限起运虚岁逐年递增"
      }
    ];
    return {
      status: checks.every(check => check.pass) ? "pass" : "fail",
      checks,
      hardFailures: checks.filter(check => !check.pass).map(check => check.id)
    };
  }

  function buildDecadalAnnualTimeline(astrolabe, palaces, asOfYear) {
    const rawDecadals = astrolabe?.decadalList?.() || [];
    const activeIndex = rawDecadals.findIndex(item => item?.yearRange?.[0] <= asOfYear
      && asOfYear <= item?.yearRange?.[1]);
    if (activeIndex < 0) {
      return {
        status: "unavailable",
        reason: "asOfYear 不落在任何大限区间内",
        asOfYear,
        decadal: null,
        years: [],
        boundaryAudit: null
      };
    }
    const rawDecadal = rawDecadals[activeIndex];
    const decadal = buildDecadalItem(rawDecadal, palaces);
    const rawYears = astrolabe.yearlyList(activeIndex) || [];
    const years = rawYears.map(raw => {
      const annual = buildAnnualItem(raw, palaces, rawDecadal);
      const validation = validatePeriod(annual, "annual");
      return {
        year: annual.year,
        nominalAge: annual.nominalAge,
        ganzhi: annual.ganzhi,
        status: validation.status,
        hardFailures: validation.hardFailures,
        // 字段名与 fourLayerDieGong.rows 对齐：流年宫位一律叫 annualPalace。
        // 不用 buildOverlay 的 periodPalace 原名：同一份事实包里两套叫法会让下游读空。
        palaceOverlay: annual.palaceOverlay.map(row => ({
          branch: row.branch,
          natalPalace: row.natalPalace,
          decadalPalace: row.decadalPalace,
          annualPalace: row.periodPalace
        })),
        fourTransformations: annual.fourTransformations,
        palaceFlying: annual.palaceFlying,
        transitStars: annual.transitStars,
        activation: buildAnnualActivation(annual, decadal, palaces),
        decadalAnnualRelation: buildDecadalAnnualGanzhiRelation(decadal.ganzhi, annual.ganzhi)
      };
    });
    const boundaryAudit = buildAnnualBoundaryAudit(decadal, years);
    const allYearsPass = years.length > 0 && years.every(item => item.status === "pass");
    return {
      status: allYearsPass && boundaryAudit.status === "pass" ? "pass" : "fail",
      asOfYear,
      decadal: {
        // index 是该大限命宫所在的宫位序号；listIndex 才是 decadalList() 与
        // yearlyList() 的入参位置。两者不同，混用会静默取到别的大限。
        index: decadal.index,
        listIndex: activeIndex,
        ganzhi: decadal.ganzhi,
        ageRange: [...decadal.ageRange],
        yearRange: [...decadal.yearRange],
        natalAnchorPalace: decadal.natalAnchorPalace,
        fourTransformations: decadal.fourTransformations
      },
      years,
      boundaryAudit
    };
  }

  function validateFineTiming(item, scope) {
    const checks = [
      {
        id: `${scope}_twelve_palaces_unique`,
        pass: item.palaceOverlay.length === 12
          && new Set(item.palaceOverlay.map(row => row[`${scope}Palace`])).size === 12
          && item.palaceOverlay.every(row =>
            typeof row[`${scope}Palace`] === "string" && row[`${scope}Palace`].length > 0
          ),
        message: `${scope}十二宫叠宫完整、唯一且均为有效宫名`
      },
      {
        id: `${scope}_four_hua_complete`,
        pass: item.fourTransformations.length === 4 && item.fourTransformations.every(row => row.star && row.natalPalace && row[`${scope}Palace`]),
        message: `${scope}四化均已绑定本命宫与本层宫位`
      },
      {
        id: `${scope}_ganzhi_valid`,
        pass: item.ganzhiValid === true && item.ganzhi !== null,
        message: `${scope}干支为合法两字组合`
      },
      {
        // 流曜也必须校验，否则未经核对就作为有效事实输出。
        // 先要求引擎真的给了 stars 字段，且每个宫位槽都是数组；
        // 缺失时不能因为"空数组 every 恒真"而放行。
        id: `${scope}_transit_stars_valid`,
        pass: item.starsProvided === true
          && item.starsSlotCount === 12
          && item.starSlotsValid === true
          && Array.isArray(item.transitStars)
          && item.transitStars.every(star =>
            star
            && typeof star.name === "string" && star.name.length > 0
            && typeof star.natalPalace === "string" && star.natalPalace.length > 0
            // periodPalace 为 null 说明没映射到流月宫位，不能算有效流曜
            && typeof star.periodPalace === "string" && star.periodPalace.length > 0
          ),
        message: `${scope}流曜字段存在、结构完整且均绑定有效宫位`
      }
    ];
    return { status: checks.every(check => check.pass) ? "pass" : "fail", checks, hardFailures: checks.filter(check => !check.pass).map(check => check.id) };
  }

  function buildFineTiming(astrolabe, palaces, asOfDate, asOfTimeIndex) {
    const horoscope = astrolabe?.horoscope?.(asOfDate, asOfTimeIndex) || null;
    if (!horoscope) return { asOfDate, asOfTimeIndex, status: "unavailable", current: null, validation: {} };
    const layers = {
      decadal: horoscope.decadal,
      annual: horoscope.yearly,
      monthly: horoscope.monthly,
      daily: horoscope.daily,
      hourly: horoscope.hourly
    };
    const current = {
      // 只有引擎真的给了该层数据才构造，否则留 null：
      // 否则会造出一个空占位对象，三处采样签名相同，被误判为"同一农历月"
      monthly: layers.monthly ? buildFineTimingItem("monthly", layers.monthly, palaces, layers) : null,
      daily: layers.daily ? buildFineTimingItem("daily", layers.daily, palaces, layers) : null,
      hourly: layers.hourly ? buildFineTimingItem("hourly", layers.hourly, palaces, layers) : null
    };
    const validation = {
      monthly: current.monthly
        ? validateFineTiming(current.monthly, "monthly")
        : { status: "unavailable", checks: [], hardFailures: [] },
      daily: current.daily
        ? validateFineTiming(current.daily, "daily")
        : { status: "unavailable", checks: [], hardFailures: [] },
      hourly: current.hourly
        ? validateFineTiming(current.hourly, "hourly")
        : { status: "unavailable", checks: [], hardFailures: [] }
    };
    return {
      asOfDate,
      asOfTimeIndex,
      lunarDate: horoscope.lunarDate,
      solarDate: horoscope.solarDate,
      status: Object.values(validation).every(group => group.status === "pass") ? "pass" : "fail",
      current,
      validation
    };
  }

  function buildRelations(palaces) {
    return palaces.map(palace => {
      const group = TRINE_GROUPS.find(branches => branches.includes(palace.earthlyBranch)) || [];
      const trines = group
        .filter(branch => branch !== palace.earthlyBranch)
        .map(branch => palaces.find(item => item.earthlyBranch === branch)?.name)
        .filter(Boolean);
      return {
        evidenceId: `origin.relation.${palace.name}`,
        palace: palace.name,
        branch: palace.earthlyBranch,
        oppositePalace: OPPOSITES[palace.name] || null,
        trinePalaces: trines
      };
    });
  }

  // 小限方向：1 岁宫的下一个宫承载 2 岁 → 顺行；上一个宫承载 2 岁 → 逆行。
  function minorLimitDirection(palaces) {
    const first = palaces.find(palace => palace.minorLimitAges.includes(1));
    const second = palaces.find(palace => palace.minorLimitAges.includes(2));
    if (!first || !second) return null;
    const delta = (BRANCHES.indexOf(second.earthlyBranch) - BRANCHES.indexOf(first.earthlyBranch) + 12) % 12;
    return delta === 1 ? "forward" : delta === 11 ? "backward" : null;
  }

  function buildNatalStructure(palaces, dualFourPillars, yearBranch) {
    const starGroups = Object.fromEntries(STAR_GROUPS.map(group => [
      group,
      palaces.reduce((sum, palace) => sum + palace[group].length, 0)
    ]));
    return {
      starCounts: starGroups,
      emptyPalaces: palaces.filter(palace => palace.isEmpty).map(palace => ({
        palace: palace.name,
        branch: palace.earthlyBranch,
        borrowedFromPalace: palace.borrowedFromPalace,
        borrowedMajorStars: palace.borrowedMajorStars
      })),
      minorLimits: palaces.map(palace => ({
        palace: palace.name,
        branch: palace.earthlyBranch,
        nominalAges: [...palace.minorLimitAges]
      })),
      minorLimitPolicy: {
        startBranch: XIAOXIAN_START[yearBranch] || null,
        direction: minorLimitDirection(palaces),
        table: "_AX_XIAOXIAN_ARR",
        basis: "申子辰年见戌、巳酉丑年见未、寅午戌年见辰、亥卯未年见丑；男顺女逆"
      },
      originalPalaces: palaces
        .filter(palace => palace.isOriginalPalace)
        .map(palace => ({ palace: palace.name, branch: palace.earthlyBranch, stem: palace.heavenlyStem })),
      dualFourPillars
    };
  }

  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function validate({ palaces, fourTransformations, normalizedInput, relations, natalStructure, brightnessProfile, yearStem }) {
    const majorStarNames = palaces.flatMap(palace => palace.majorStars.map(star => star.name));
    const luCun = findStar(palaces, "禄存")?.palace;
    const qingYang = findStar(palaces, "擎羊")?.palace;
    const tuoLuo = findStar(palaces, "陀罗")?.palace;
    const adjacent = (left, right) => left && right
      ? [1, 11].includes((left.index - right.index + 12) % 12)
      : false;
    const checks = [
      {
        id: "identity_gender_preserved",
        pass: ["male", "female"].includes(normalizedInput.sexForCalculation),
        message: "排盘性别已冻结在标准输入中"
      },
      {
        id: "twelve_palaces_unique",
        pass: palaces.length === 12 && new Set(palaces.map(palace => palace.name)).size === 12 && new Set(palaces.map(palace => palace.earthlyBranch)).size === 12,
        message: "十二宫宫名与地支一一对应"
      },
      {
        id: "one_body_palace",
        pass: palaces.filter(palace => palace.isBodyPalace).length === 1,
        message: "身宫位置唯一"
      },
      {
        id: "four_hua_complete",
        pass: fourTransformations.length === 4 && fourTransformations.every(item => item.star && item.palace),
        message: "生年禄权科忌均已绑定星曜与宫位"
      },
      {
        id: "fourteen_major_stars_complete",
        pass: majorStarNames.length === 14 && new Set(majorStarNames).size === 14,
        message: "十四主星齐备且没有重复"
      },
      {
        id: "lucun_qingyang_tuoluo_adjacent",
        pass: adjacent(luCun, qingYang) && adjacent(luCun, tuoLuo) && qingYang.index !== tuoLuo.index,
        message: "禄存与擎羊、陀罗分别相邻"
      },
      {
        id: "opposites_symmetric",
        pass: relations.length === 12 && relations.every(item => OPPOSITES[item.oppositePalace] === item.palace),
        message: "十二宫对宫关系双向一致"
      },
      {
        id: "empty_palace_borrowing_bound",
        pass: natalStructure.emptyPalaces.every(item => item.borrowedFromPalace && Array.isArray(item.borrowedMajorStars)),
        message: "空宫均已绑定对宫及可借主星"
      },
      {
        id: "minor_limits_bound",
        pass: natalStructure.minorLimits.length === 12 && natalStructure.minorLimits.every(item => Array.isArray(item.nominalAges)),
        message: "十二宫小限年龄均已结构化保存"
      },
      {
        id: "dual_four_pillars_complete",
        pass: [natalStructure.dualFourPillars?.solarTermPillars, natalStructure.dualFourPillars?.lunarCalendarPillars]
          .every(group => Array.isArray(group) && group.length === 4 && group.every(item => /^.{2}$/u.test(item))),
        message: "节气四柱与农历口径四柱均完整"
      },
      {
        id: "default_school_stars_complete",
        pass: ["截空", "副截", "旬空", "副旬", "大耗"].every(name => Boolean(findStar(palaces, name))),
        message: "默认口径的截空副截、旬空副旬与年支大耗齐备"
      },
      {
        id: "default_brightness_applied",
        pass: palaces.every(palace => STAR_GROUPS.every(group => palace[group].every(star => {
          const profile = brightnessProfile || BRIGHTNESS_DEFAULT_PROFILE;
          const found = brightnessOf(profile, star.name, BRANCHES.indexOf(palace.earthlyBranch));
          if (!found.known) return true;
          return star.brightness === found.label;
        }))),
        message: `已收录星曜按「${BRIGHTNESS_PROFILES[brightnessProfile || BRIGHTNESS_DEFAULT_PROFILE].label}」亮度表统一赋值`
      },
      {
        id: "original_palace_year_stem",
        pass: natalStructure.originalPalaces.length === 1
          && Boolean(yearStem)
          && natalStructure.originalPalaces[0].stem === yearStem,
        message: `来因宫（宫干与生年干相同）恰有一处${natalStructure.originalPalaces[0] ? `：${natalStructure.originalPalaces[0].palace}（${natalStructure.originalPalaces[0].stem}${natalStructure.originalPalaces[0].branch}）` : ""}`
      },
      {
        id: "small_limit_policy_bound",
        pass: Boolean(natalStructure.minorLimitPolicy.startBranch)
          && ["forward", "backward"].includes(natalStructure.minorLimitPolicy.direction)
          && natalStructure.minorLimits.every(item => item.nominalAges.length === 10),
        message: `小限起${natalStructure.minorLimitPolicy.startBranch || "?"}、${natalStructure.minorLimitPolicy.direction === "backward" ? "逆行" : "顺行"}，十二宫各 10 个年龄`
      }
    ];
    return {
      status: checks.every(check => check.pass) ? "pass" : "fail",
      checks,
      hardFailures: checks.filter(check => !check.pass).map(check => check.id)
    };
  }

  function build({ chart, astrolabe, palaces, normalizedInput, ruleProfile, brightnessSchool, asOfYear, asOfDate, asOfTimeIndex, dualFourPillars }) {
    const yearGanzhi = String(chart.chineseDate || "").trim().split(/\s+/u)[0] || "";
    const yearStem = yearGanzhi.charAt(0);
    const yearBranch = yearGanzhi.charAt(1);
    // 门派可以直接传，也可以从 ruleProfile 带下来；识别不了就回落默认，不静默乱用。
    const brightnessProfile = resolveBrightnessProfile(brightnessSchool ?? ruleProfile?.brightnessSchool)
      || BRIGHTNESS_DEFAULT_PROFILE;
    const corrections = applyKnownCorrections(yearStem, yearBranch, palaces, brightnessProfile);
    const fourTransformations = buildFourTransformations(yearStem, palaces);
    const relations = buildRelations(palaces);
    const natalStructure = buildNatalStructure(palaces, dualFourPillars, yearBranch);
    const validation = validate({ palaces, fourTransformations, normalizedInput, relations, natalStructure, brightnessProfile, yearStem });
    const palaceFlying = buildPalaceFlying(palaces);
    const transformationSources = fourTransformations.map(item => ({
      evidenceId: `origin.incoming_sources.${HUA_KEYS[item.kind]}`,
      kind: item.kind,
      star: item.star,
      targetPalace: item.palace,
      incomingPalaces: palaceFlying
        .filter(binding => binding.kind === item.kind && binding.star === item.star)
        .map(binding => ({ palace: binding.sourcePalace, stem: binding.sourceStem, branch: binding.sourceBranch })),
      source: "palace-stem-table"
    }));
    const jiChains = buildJiChains(palaces, palaceFlying);
    const selfTransformations = buildSelfTransformations(palaceFlying);
    const flyingValidation = validatePalaceFlying(palaces, palaceFlying, jiChains, selfTransformations);
    const periods = buildPeriods(astrolabe, palaces, asOfYear, Number(chart.rawDates?.lunarDate?.lunarYear));
    const fineTiming = buildFineTiming(astrolabe, palaces, asOfDate, asOfTimeIndex);
    const dynamicMayInterpret = periods.validation.decadal.status === "pass" && periods.validation.annual.status === "pass";
    const flyingMayInterpret = flyingValidation.status === "pass";
    const fineTimingMayInterpret = fineTiming.status === "pass";
    const fingerprintSource = JSON.stringify({
      input: normalizedInput,
      rule: ruleProfile,
      natalStructure,
      palaces: palaces.map(palace => ({
        name: palace.name,
        branch: palace.earthlyBranch,
        stars: STAR_GROUPS.flatMap(group => palace[group].map(star => [star.name, star.transformation]))
      })),
      fourTransformations,
      transformationSources,
      palaceFlying,
      jiChains,
      selfTransformations,
      period: {
        asOfYear,
        childhood: periods.childhood,
        decadal: periods.current.decadal?.fourTransformations || null,
        annual: periods.current.annual?.fourTransformations || null
      },
      fineTiming: {
        asOfDate,
        asOfTimeIndex,
        monthly: fineTiming.current?.monthly?.fourTransformations || null,
        daily: fineTiming.current?.daily?.fourTransformations || null,
        hourly: fineTiming.current?.hourly?.fourTransformations || null
      }
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      fingerprint: `zw4-${fnv1a(fingerprintSource)}`,
      readiness: {
        level: dynamicMayInterpret && flyingMayInterpret && fineTimingMayInterpret ? "natal-and-current-five-layer-timing" : "natal-foundation",
        aiMayInterpret: validation.status === "pass",
        dynamicMayInterpret,
        flyingMayInterpret,
        fineTimingMayInterpret,
        supportedScopes: [
          "basic-natal-education", "default-school-star-placement", "default-school-brightness", "dual-four-pillars", "empty-palace-borrowing", "minor-limits", "childhood-limits", "incoming-transformation-sources", "natal-palace-flying", "natal-ji-chains", "self-transform-direction",
          "decadal-overlay", "decadal-four-hua", "decadal-palace-flying",
          "annual-overlay", "annual-four-hua", "annual-palace-flying",
          "monthly-overlay", "monthly-four-hua", "daily-overlay", "daily-four-hua",
          "hourly-overlay", "hourly-four-hua"
        ],
        unsupportedScopes: ["interpretive-rule-conclusions"]
      },
      yearStem,
      fourTransformations,
      transformationSources,
      palaceFlying,
      jiChains,
      selfTransformations,
      palaceRelations: relations,
      natalStructure,
      corrections,
      brightness: {
        profile: brightnessProfile,
        label: BRIGHTNESS_PROFILES[brightnessProfile].label,
        wmtTable: BRIGHTNESS_PROFILES[brightnessProfile].wmtTable,
        alternates: Object.keys(BRIGHTNESS_PROFILES).filter(key => key !== brightnessProfile)
      },
      validation,
      flyingValidation,
      periods,
      fineTiming
    };
  }

  /**
   * 目标年份 12 个流月的紫微事实。
   *
   * 坐标口径差异是这里最要紧的事：紫微流月由 iztro 按**农历月**给出，
   * 八字流月按**节气月**划分，两者边界不重合。只取中点采样无法证明
   * 该农历月覆盖整个节气月，所以这里做三端采样：
   *   - 节气月首日、末日、中点，各取一次 horoscope
   *   - 三处的**流月盘结构签名**一致 → 说明同一农历月覆盖本月，status 才可能为 ok
   *   - 不一致 → 该节气月横跨两个农历月，紫微流月无法代表整月，
   *     status 置为 "unverifiable"，字段一律清空，并给出原因
   *
   * 注意不能直接比 lunarDate：它含具体日（如「正月初五」），
   * 三个不同日期的字符串必然不相等，会把所有月份都判成不对齐。
   * 因此用 name + ganzhi + 流月层宫位 组成的结构签名来代表"是不是同一个月"。
   *
   * 关于「为什么取日历日就够」：iztro 的农历映射是**按日**的
   * （一个公历日对应唯一农历日），农历月只在初一的 00:00 切换。
   * 一个农历月约 29.5 天，而节气月不超过约 31 天，
   * 因此区间内最多发生一次切换；只要比对区间首日与末日两端的签名，
   * 就能判断这个切换是否落在区间内，无需逐日采样。
   */
  const STEM_SET = new Set(["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]);
  const BRANCH_SET = new Set(["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]);

  function lunarMonthSignature(fine) {
    const monthly = fine?.current?.monthly;
    if (!monthly || !monthly.ganzhi) return null;
    // 必须带上**农历年月（含闰月标志）**：普通二月与闰二月的干支、宫位可能完全一致，
    // 只比 name/ganzhi/宫位会把「跨到闰二月」误判为同一个月。
    const label = lunarMonthLabel(fine?.lunarDate);
    if (!label) return null;
    const overlay = monthly.palaceOverlay || [];
    if (overlay.length === 0) return null;
    return [
      label,
      monthly.name || "",
      monthly.ganzhi,
      overlay.map(row => row.monthlyPalace || "").join(",")
    ].join("|");
  }

  /** 从完整农历日期里粗取"月"部分，仅用于展示与人工核对。 */
  function lunarMonthLabel(lunarDate) {
    if (typeof lunarDate !== "string") return null;
    // 取到第一个「月」为止：包含农历年、月序与闰月字样，例如「二〇二六年闰二月」。
    // 这样普通二月与闰二月不会被当成同一个月。
    const matched = lunarDate.match(/^(.*?月)/);
    return matched ? matched[1] : null;
  }

  /** 字段级包装：每类紫微字段各自带状态、来源与原因，便于上层逐项判断。 */
  function fieldEnvelope(status, value, reason = null, source = null) {
    return {
      status,
      value: status === "validated" ? (value ?? null) : null,
      reason: status === "validated" ? null : reason,
      source
    };
  }

  function monthlyCheck(validation, suffix) {
    return (validation?.checks || []).find(check => check.id === `monthly_${suffix}`);
  }

  // 把 [startDate, endDate] 按**农历月切换日**切成至多两段。
  // 一个农历月 ≥29.5 天，节气月 ≤31 天，所以区间内最多切换一次。
  // 二分定位切换日：每次只多花 log2(31)≈5 次排盘，且只在本月确实跨月时才做。
  function addDays(isoDate, offset) {
    const parts = String(isoDate).split("-").map(Number);
    if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
    const cursor = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    cursor.setUTCDate(cursor.getUTCDate() + offset);
    const pad = n => String(n).padStart(2, "0");
    return `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`;
  }

  // 校验"真实存在"的 ISO 日期：解析后按同样字段回拼必须一致
  function isRealDate(isoDate) {
    if (typeof isoDate !== "string") return false;   // 数组/对象一律不合法
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
    if (!match) return false;
    const [, y, m, d] = match;
    const cursor = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    const pad = n => String(n).padStart(2, "0");
    return cursor.getUTCFullYear() === Number(y)
      && pad(cursor.getUTCMonth() + 1) === m
      && pad(cursor.getUTCDate()) === d;
  }

  function daysBetween(from, to) {
    const parse = iso => {
      const parts = String(iso).split("-").map(Number);
      return Date.UTC(parts[0], parts[1] - 1, parts[2]);
    };
    return Math.round((parse(to) - parse(from)) / 86400000) + 1;
  }

  // 把 [startDate, endDate] 按农历月切换日切成至多两段。
  //
  // 失败契约（T1）：下面任一情况都返回**覆盖原区间的单段**、signature=null、verified=false，
  // 不宣称具体切换日，也不把该段用于输出已验证字段：
  //   - 首/末签名缺失
  //   - 二分过程中采到既非首日也非末日的第三种签名，或采样签名缺失
  //   - 无法构造相邻边界（切换落在首日 / 边界不是末日签名）
  // 只有「首末不同且所有二分采样都是首日或末日签名」时，才给出两段 verified:true。
  function lunarSegments(spec, sample) {
    const startDate = spec.startDate;
    const endDate = spec.endDate;
    if (!startDate || !endDate) return [];
    // 日期必须真实存在且有序：2026-02-30 会被 Date.UTC 归一化成 03-02，
    // 不校验就会产出"verified:true 但边界日期不存在"的段。
    if (!isRealDate(startDate) || !isRealDate(endDate)) return [];
    if (daysBetween(startDate, endDate) < 1) return [];

    const sigAt = date => lunarMonthSignature(sample(date));
    const days = daysBetween(startDate, endDate);
    const whole = verified => [{
      from: startDate,
      to: endDate,
      days,
      signature: null,
      midpoint: spec.midpoint || startDate,
      verified,
    }];

    const sigStart = sigAt(startDate);
    const sigEnd = sigAt(endDate);
    if (!sigStart || !sigEnd) return whole(false);
    if (sigStart === sigEnd) {
      return [{
        from: startDate,
        to: endDate,
        days,
        signature: sigStart,
        midpoint: spec.midpoint || startDate,
        verified: true,
      }];
    }

    // 二分：找最后一天仍属起始农历月。任何异常签名都整段降级。
    let low = 0;
    let high = days - 1;
    let lastSame = -1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const day = addDays(startDate, mid);
      const sig = day ? sigAt(day) : null;
      if (!sig || (sig !== sigStart && sig !== sigEnd)) return whole(false);
      if (sig === sigStart) {
        lastSame = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (lastSame < 0) return whole(false);

    const boundaryIndex = lastSame + 1;
    const secondStart = addDays(startDate, boundaryIndex);
    const firstTo = addDays(startDate, lastSame);
    if (!secondStart || !firstTo) return whole(false);
    if (sigAt(secondStart) !== sigEnd) return whole(false);

    return [
      {
        from: startDate,
        to: firstTo,
        days: daysBetween(startDate, firstTo),
        signature: sigStart,
        midpoint: firstTo,
        verified: true,
      },
      {
        from: secondStart,
        to: endDate,
        days: daysBetween(secondStart, endDate),
        signature: sigEnd,
        midpoint: addDays(secondStart, Math.floor((daysBetween(secondStart, endDate) - 1) / 2)),
        verified: true,
      },
    ];
  }

  // 段结构校验：生成侧与装配侧共用同一份实现（T1）。
  // expected = {startDate, endDate}；source = {segments, segmentCount, coverage}
  // 由段状态推导 coverage（生成侧与校验侧共用同一规则）
  function coverageOf(segments) {
    const list = Array.isArray(segments) ? segments : [];
    if (list.length === 0) return "none";
    // 段元素可能是 null/非对象：这里只负责推导，非法输入按 none 处理，
    // 真正的拒绝交给 assessSegments（不能在校验前抛异常）
    if (list.some(seg => !seg || typeof seg !== "object")) return "none";
    if (!list.some(seg => seg.verified === true)) return "none";
    return list.length === 1 && list[0].verified === true ? "full" : "partial";
  }

  function assessSegments(source, expected, options = {}) {
    const fail = reason => ({
      ok: false, reason, segments: [], mainIndex: null, coverage: "none",
    });
    if (!expected || !isRealDate(expected.startDate) || !isRealDate(expected.endDate)) {
      return fail("缺少或非法的月份边界（expected.startDate/endDate）");
    }
    if (expected.startDate > expected.endDate) return fail("月份边界起点晚于终点");
    const segments = Array.isArray(source?.segments) ? source.segments : null;
    if (!segments || segments.length === 0) return fail("段数组为空");
    if (segments.some(seg => !seg || typeof seg !== "object")) return fail("段元素不是对象");
    if (segments.length > 2) return fail("段数超过两段");
    // raw 模式由校验器自行取段数；非 raw 模式才要求上游声明与之一致
    if (!options.raw && source.segmentCount !== segments.length) {
      return fail("segmentCount 与段数不符");
    }

    let previousTo = null;
    for (const seg of segments) {
      if (!isRealDate(seg?.from) || !isRealDate(seg?.to)) return fail("段内日期非法");
      if (seg.from > seg.to) return fail("段起点晚于终点");
      if (typeof seg.days !== "number" || !Number.isInteger(seg.days) || seg.days < 1) {
        return fail("段天数非法");
      }
      if (typeof seg.verified !== "boolean") return fail("段 verified 必须是布尔");
      if (daysBetween(seg.from, seg.to) !== seg.days) return fail("段天数与区间不符");
      // 取样点必须在段内，否则会把别月的结果投影到本月
      // raw 模式（生成侧）每段都必须有真实且落在段内的取样点，不推导
      if (options.raw) {
        if (!isRealDate(seg.midpoint)) return fail("段取样点缺失或非法");
        if (seg.midpoint < seg.from || seg.midpoint > seg.to) return fail("段取样点越界");
      } else if (seg.midpoint != null) {
        if (!isRealDate(seg.midpoint)) return fail("段取样点非法");
        if (seg.midpoint < seg.from || seg.midpoint > seg.to) return fail("段取样点越界");
      }
      if (previousTo !== null && seg.from !== addDays(previousTo, 1)) return fail("相邻段不相接");
      previousTo = seg.to;
    }
    if (segments[0].from !== expected.startDate) {
      return fail("首段起点与月份边界不符");
    }
    if (segments[segments.length - 1].to !== expected.endDate) {
      return fail("末段终点与月份边界不符");
    }

    const longest = segments.reduce((a, b) => (b.days > a.days ? b : a));
    let mainSegment = longest;
    if (!options.raw) {
      // 装配侧要求上游**显式**标主段，且必须与"天数最多"一致
      if (segments.some(seg => typeof seg.isDominant !== "boolean")) {
        return fail("段的 isDominant 必须是布尔");
      }
      const dominant = segments.filter(seg => seg.isDominant === true);
      if (dominant.length !== 1) return fail("主段必须唯一");
      if (dominant[0] !== longest) return fail("主段必须是天数最多的那段");
      mainSegment = dominant[0];
    }

    const anyVerified = segments.some(seg => seg.verified === true);
    const coverage = !anyVerified
      ? "none"
      : (segments.length === 1 && segments[0].verified === true ? "full" : "partial");
    // raw 模式（生成侧）由本函数推导 coverage，不要求调用方提供可信值；
    // 非 raw 模式（装配侧）必须与推导结果一致，否则视为上游谎报
    if (!options.raw && source.coverage !== coverage) return fail("coverage 与段状态不符");

    return {
      ok: true,
      reason: null,
      segments,
      mainIndex: segments.indexOf(mainSegment),
      coverage,
    };
  }

  function buildMonthlyTiming(astrolabe, palaces, monthSpecs, asOfTimeIndex = 0, hooks = null) {
    const specs = Array.isArray(monthSpecs) ? monthSpecs : [];
    // hooks 供测试注入：{ sample(date), segmenter(spec, sample) }
    const sampleImpl = hooks?.sample
      || (date => (date ? buildFineTiming(astrolabe, palaces, date, asOfTimeIndex) : null));
    const segmenter = hooks?.segmenter || lunarSegments;
    const months = specs.map((spec, monthPosition) => {
      // spec 本身可能是 null/非对象：直接给一个不可用月份，不抛异常
      if (!spec || typeof spec !== "object") {
        return {
          index: monthPosition + 1,
          status: "unverifiable",
          reason: "缺少该月的取样规格",
          ganzhi: null,
          name: null,
          coordinateAligned: false,
          segmentCount: 0,
          coverage: "none",
          segments: [],
          validation: { status: "unavailable", checks: [], hardFailures: [] },
          validationStatus: "unavailable",
          fieldStatuses: { palaceOverlay: "unavailable", fourTransformations: "unavailable", transitStars: "unavailable" },
          palaceOverlay: fieldEnvelope("unavailable", null, "缺少该月的取样规格", null),
          fourTransformations: fieldEnvelope("unavailable", null, "缺少该月的取样规格", null),
          transitStars: fieldEnvelope("unavailable", null, "缺少该月的取样规格", null),
          evidenceId: `monthly.months[${monthPosition}].ziwei`,
        };
      }
      const sample = date => sampleImpl(date);
      // 按农历月切段：一个节气月跨两个农历月时切成两段，各段用自己的农历月事实。
      // 这样八字侧保持节气月不变，紫微侧不再因为"跨月"而整月不可用。
      let rawSegments = null;
      try {
        rawSegments = segmenter(spec, sample);
      } catch (error) {
        rawSegments = null;
      }
      // 不预读 length/coverage：非数组直接交给失败路径；raw 模式由校验器自行推导
      // 校验本身也可能因恶意 getter 抛错：整体放进 try/catch，
      // 转成稳定的结构失败原因，不影响其他月份
      let assessment;
      try {
        assessment = Array.isArray(rawSegments)
          ? assessSegments(
            { segments: rawSegments, coverage: null },
            { startDate: spec.startDate, endDate: spec.endDate },
            { raw: true },
          )
          : { ok: false, reason: "segmenter 未返回数组", segments: [], mainIndex: null, coverage: "none" };
      } catch (error) {
        assessment = {
          ok: false,
          reason: `段结构访问异常：${error && error.message ? error.message : "未知错误"}`,
          segments: [],
          mainIndex: null,
          coverage: "none",
        };
      }
      const segments = assessment.ok ? assessment.segments : [];
      const dominant = assessment.ok ? segments[assessment.mainIndex] : null;

      // 结构不可信时不再采样：避免对非法输入触发额外异常或副作用
      const atStart = assessment.ok ? sample(spec.startDate) : null;
      const atEnd = assessment.ok ? sample(spec.endDate) : null;
      // 顶层字段取**占天数最多的那段**（界面默认展开它，其余段折叠）
      const atMid = assessment.ok ? sample(dominant ? dominant.midpoint : spec.midpoint) : null;

      const sigStart = lunarMonthSignature(atStart);
      const sigEnd = lunarMonthSignature(atEnd);
      const sigMid = lunarMonthSignature(atMid);
      // 「整月对齐」仍是三端签名一致；段数只描述切分结果。
      // 签名取不到（夹具/异常盘）时按未对齐处理，不假装覆盖整月。
      // 对齐 = 单段且已验证，且**首/中/末三处重采样签名都等于该段签名**。
      // 只看段 verified 不够：首采样失败但重采样成功时会谎报对齐。
      const segmentSig = segments.length === 1 ? segments[0].signature : null;
      const aligned = segments.length === 1
        && segments[0].verified === true
        && Boolean(segmentSig)
        && sigStart === segmentSig
        && sigMid === segmentSig
        && sigEnd === segmentSig;

      const lunarStart = atStart?.lunarDate || null;
      const lunarEnd = atEnd?.lunarDate || null;
      const lunarMid = atMid?.lunarDate || null;

      const monthly = atMid?.current?.monthly || null;
      const validation = atMid?.validation?.monthly || {
        status: "unavailable",
        checks: [],
        hardFailures: []
      };
      const validationStatus = validation?.status || "unavailable";

      let status;
      let reason = null;
      if (!assessment.ok) {
        status = "unverifiable";
        reason = `段结构不可信：${assessment.reason}`;
      } else if (!monthly) {
        status = "unavailable";
        reason = "引擎未返回该月流月";
      } else {
        // 月份坐标有效即 ok；单类字段是否可用由各自 envelope 决定，
        // 不让一个字段失败连坐整月（否则叠宫通过、流曜失败会把四化也清掉）。
        status = "ok";
      }

      // T2：顶层字段是**主段**的投影。主段不存在或未验证 → 顶层三字段一律 unavailable。
      let dominantDetail = null;
      const dominantSegment = segments.find(seg => seg.isDominant) || null;
      // T2：主段必须 verified === true；否则顶层三字段一律 unavailable，
      // 不能因为整月 status 是 ok 就把它们标成 validated。
      const topGate = status === "ok"
        && Boolean(dominant)
        && dominant.verified === true;
      const usable = status === "ok";
      const unavailableReason = reason || "该月流月整体不可用";
      const topReason = !dominant
        ? "没有可用的分段"
        : (dominant.verified !== true
          ? "主段农历月归属未验证，顶层字段不作为已验证事实"
          : unavailableReason);
      // 坐标不可对应或引擎没给数据 → 整月字段都不可信，全置 unavailable。
      // 坐标可对应时，每类字段只看自己的检查项，不被其他字段的失败连坐。
      const fieldGate = topGate;
      const fieldStatus = check => {
        if (!fieldGate) return "unavailable";
        return check && check.pass === true ? "validated" : "failed";
      };
      const palaceStatus = fieldStatus(monthlyCheck(validation, "twelve_palaces_unique"));
      const huaStatus = fieldStatus(monthlyCheck(validation, "four_hua_complete"));
      // 引擎没给 stars 字段时是"缺失"，应标 unavailable 而不是 failed
      const starCheck = monthlyCheck(validation, "transit_stars_valid");
      const starStatus = !fieldGate
        ? "unavailable"
        : (monthly?.starsProvided === false ? "unavailable" : (starCheck?.pass ? "validated" : "failed"));

      return {
        index: spec.index,
        baziGanzhi: spec.ganzhi || null,
        asOfDate: spec.midpoint || null,
        sampleDates: {
          start: spec.startDate || null,
          midpoint: spec.midpoint || null,
          end: spec.endDate || null
        },
        solarDate: atMid?.solarDate || null,
        lunarDate: lunarMid,
        lunarMonth: lunarMonthLabel(lunarMid),
        lunarAtStart: lunarStart,
        lunarAtEnd: lunarEnd,
        lunarMonthSignature: sigMid,
        coordinateAligned: aligned,
        segmentCount: segments.length,
        // coverage 只看"有没有已验证段覆盖"：full = 单段且已验证；
        // partial = 段区间有效但不止一段；none = 没有已验证段或区间无效。
        coverage: (() => {
          if (segments.length === 0) return "none";
          // 只要有一段已验证就有可用事实 → partial；
          // 单段且已验证才代表整月 → full；全都没验证 → none
          if (!segments.some(seg => seg.verified === true)) return "none";
          return segments.length === 1 && segments[0].verified === true ? "full" : "partial";
        })(),
        segments: segments.map((seg, i) => {
          // 每段用**自己的取样点**排盘：段级字段不能借用主段的，
          // 否则"这段的四化"会被写成另一段的。
          // 主段直接复用顶层那份采样，避免"同一日期采两次"导致结果不一致
          const fine = (dominant && seg.from === dominant.from)
            ? atMid
            : (seg.midpoint ? sample(seg.midpoint) : null);
          const segMonthly = fine?.current?.monthly || null;
          const segValidation = fine?.validation?.monthly || {
            status: "unavailable",
            checks: [],
            hardFailures: []
          };
          // 未验证（首/末签名缺失）或没有流月数据时，字段一律不可信
          const segGate = Boolean(segMonthly) && seg.verified !== false;
          const segStatus = check => {
            if (!segGate) return "unavailable";
            return check && check.pass === true ? "validated" : "failed";
          };
          const segUnavailable = segGate
            ? null
            : (seg.verified === false
              ? "首末取样的农历月无法确认，该段不作为已验证事实"
              : "引擎未返回该段流月");
          const segPalace = segStatus(monthlyCheck(segValidation, "twelve_palaces_unique"));
          const segHua = segStatus(monthlyCheck(segValidation, "four_hua_complete"));
          const segStar = !segGate
            ? "unavailable"
            : (segMonthly?.starsProvided === false
              ? "unavailable"
              : (monthlyCheck(segValidation, "transit_stars_valid")?.pass ? "validated" : "failed"));
          // T3：指针用**最终数组位置**，不能用 spec.index - 1——稀疏/乱序输入会指错
          const monthIndex = monthPosition;
          const pointerBase = `/months/${monthIndex}/ziwei/segments/${i}`;
          const detail = {
            index: i + 1,
            from: seg.from,
            to: seg.to,
            days: seg.days,
            lunarMonthSignature: seg.signature,
            isDominant: dominant ? seg.from === dominant.from : i === 0,
            verified: seg.verified !== false,
            asOfDate: seg.midpoint || null,
            lunarDate: fine?.lunarDate || null,
            lunarMonth: lunarMonthLabel(fine?.lunarDate),
            ganzhi: segGate ? (segMonthly.ganzhi || null) : null,
            name: segGate ? (segMonthly.name || null) : null,
            validationStatus: segValidation?.status || "unavailable",
            fieldStatuses: { palaceOverlay: segPalace, fourTransformations: segHua, transitStars: segStar },
            palaceOverlay: fieldEnvelope(segPalace, segMonthly?.palaceOverlay,
              segPalace === "validated" ? null
                : (segPalace === "failed" ? "叠宫校验未通过" : segUnavailable),
              "iztro-horoscope-monthly"),
            // source 必须与顶层一致，否则同一日期算出的两个 envelope 不深度相等
            fourTransformations: fieldEnvelope(segHua, segMonthly?.fourTransformations,
              segHua === "validated" ? null
                : (segHua === "failed" ? "四化校验未通过" : segUnavailable),
              "iztro-horoscope-mutagen"),
            transitStars: fieldEnvelope(segStar, segMonthly?.transitStars,
              segStar === "validated" ? null
                : (segStar === "failed"
                  ? "流曜校验未通过"
                  : (segMonthly?.starsProvided === false
                    ? "引擎未提供该段流曜数据"
                    : segUnavailable)),
              "iztro-horoscope-monthly"),
            evidenceId: `monthly.months[${monthIndex}].ziwei.segments[${i}]`,
            // 段级证据路径：AI 要能定位到"这一段"的具体字段，而不是整月的
            fieldPointers: {
              palaceOverlay: `${pointerBase}/palaceOverlay`,
              fourTransformations: `${pointerBase}/fourTransformations`,
              transitStars: `${pointerBase}/transitStars`,
            },
            jsonPointer: pointerBase,
          };
          if (detail.isDominant) dominantDetail = detail;
          return detail;
        }),
        coordinateBasis: "iztro-lunar-month",
        coordinateNote: !segments.every(seg => seg.verified === true)
          ? "首末或中途取样无法确认农历月边界，本段暂不作为已验证事实。"
          : (aligned
            ? "该节气月完整落在一个农历月内，紫微流月可代表整月。"
            : "该节气月横跨两个农历月，已按月切成 "
              + segments.length
              + " 段；顶层字段取天数最多的那段，各段分别给出自己的紫微流月。"),
        status,
        reason,
        validation,
        validationStatus,
        // 主段未验证时不得输出具体干支与名称
        ganzhi: usable && topGate ? monthly.ganzhi : null,
        name: usable && topGate ? monthly.name : null,
        // 字段级包装：status ∈ validated / failed / unavailable
        palaceOverlay: fieldEnvelope(
          palaceStatus,
          monthly?.palaceOverlay,
          palaceStatus === "validated" ? null
            : (palaceStatus === "failed" ? "叠宫校验未通过" : topReason),
          assessment.ok ? "iztro-horoscope-monthly" : null
        ),
        fourTransformations: fieldEnvelope(
          huaStatus,
          monthly?.fourTransformations,
          huaStatus === "validated" ? null
            : (huaStatus === "failed" ? "四化校验未通过" : topReason),
          assessment.ok ? "iztro-horoscope-mutagen" : null
        ),
        transitStars: fieldEnvelope(
          starStatus,
          monthly?.transitStars,
          starStatus === "validated" ? null
            : (starStatus === "failed" ? "流曜校验未通过" : topReason),
          assessment.ok ? "iztro-horoscope-monthly" : null
        ),
        fieldStatuses: {
          palaceOverlay: palaceStatus,
          fourTransformations: huaStatus,
          transitStars: starStatus
        },
        evidenceId: `monthly.months[${monthPosition}].ziwei`
      };
    });

    const okMonths = months.filter(item => item.status === "ok");
    const unavailable = months.filter(item => item.status === "unavailable");
    const unverifiable = months.filter(item => item.status === "unverifiable");
    // 字段级失败统计：月份坐标可用、但某一类字段校验没过
    const fieldFailed = months.filter(item =>
      item.status === "ok"
      && Object.values(item.fieldStatuses || {}).some(value => value === "failed")
    );

    return {
      status: specs.length === 0
        ? "unavailable"
        : (okMonths.length === months.length ? "pass" : "partial"),
      monthCount: months.length,
      validatedMonths: okMonths.length,
      unavailableMonths: unavailable.length,
      fieldFailedMonths: fieldFailed.length,
      unverifiableMonths: unverifiable.length,
      coordinateNote: "紫微流月与八字流月口径不同；只有农历月完全覆盖该节气月时才纳入有效事实。",
      months
    };
  }

  globalThis.MingliZiweiFacts = Object.freeze({
    build,
    buildDecadalAnnualTimeline,
    buildMonthlyTiming,
    // 供测试直接注入 sample 验证分段契约（不依赖真实盘面）
    lunarSegments,
    assessSegments,
    schemaVersion: SCHEMA_VERSION,
    fourHuaTable: FOUR_HUA,
    opposites: OPPOSITES,
    // 测试钩子：安星校正需要能对着「人造盘面」验证错位/重复的处理，
    // 真实盘无法构造这些缺陷，因此把内部函数暴露给单元测试（不属于对外契约）。
    // 亮度四套：供对账脚本与测试按门派逐星核对（属于只读查询，不改盘面）。
    brightnessProfiles: BRIGHTNESS_PROFILES,
    brightnessDefaultProfile: BRIGHTNESS_DEFAULT_PROFILE,
    brightnessText: BRIGHTNESS_TEXT,
    resolveBrightnessProfile,
    brightnessOf,
    internals: Object.freeze({
      ensureUniqueStars,
      applyKnownCorrections,
      applyDefaultBrightness,
      placeUniqueStar,
      findStar,
      branches: BRANCHES
    })
  });
})();
