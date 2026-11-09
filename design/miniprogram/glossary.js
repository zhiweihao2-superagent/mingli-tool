// 术语释义：点一下盘面上的词，弹一层解释。
// 内容优先取随包的古籍/神煞摘录（knowledge/），没有收录的用本项目自己的简明释义。
(function (global) {
  "use strict";

  var knowledgePromise = null;
  var index = null;

  // 知识包没覆盖到的常用词，用一句话说清（不冒充古籍原文）
  var OWN = {
    "比肩": "与日主同五行、同阴阳的十神。多指同辈、伙伴，也指「靠自己」的那一面。",
    "劫财": "与日主同五行、阴阳相反的十神。常对应同辈竞争、分账、也容易替人出头。",
    "食神": "日主所生、阴阳相同者。多与表达、产出、吃穿享受相关，偏温和。",
    "伤官": "日主所生、阴阳相反者。表达欲更强，容易直说，也更容易顶到规则上。",
    "偏财": "日主所克、阴阳相同者。多对应流动的钱、外部机会、临时收益。",
    "正财": "日主所克、阴阳相反者。多对应稳定收入、按劳所得、长期积累。",
    "七杀": "克日主、阴阳相同者（也叫偏官）。多对应压力、责任、需要顶上去的场合。",
    "偏官": "即七杀。克日主、阴阳相同者，多对应压力与责任。",
    "正官": "克日主、阴阳相反者。多对应规则、职位、明文责任。",
    "偏印": "生日主、阴阳相同者（也叫枭神）。多对应非主流的学、偏门方法、灵感。",
    "正印": "生日主、阴阳相反者。多对应学历、资质、长辈与庇护。",
    "藏干": "地支里所藏的天干。一柱的地支可以藏一到三个天干，决定这一支实际发挥什么作用。",
    "纳音": "六十甲子按两两一组配的五行名称（如「路旁土」），是传统的补充标注。",
    "大运": "按出生时刻推出来的十年一段的运势分段，每段一个干支，用来标时间坐标。",
    "流年": "当下这一年的干支。用来和本命盘、大运对照，看这一年在哪个坐标上。",
    "身强": "规则档案对日主强弱给出的候选结论之一：生扶的力量多于消耗的力量。",
    "身弱": "规则档案对日主强弱给出的候选结论之一：消耗的力量多于生扶的力量。",
    "月劫格": "以月令劫财（比肩同类）为主要依据的格局候选，多指靠自己、竞争感强。",
    "调候": "按出生季节寒暖燥湿，看这一盘更需要什么来平衡，属于传统解释规则。",
    "用神": "用来平衡整盘的行或字，这里只给候选，不下唯一结论。",
    "命宫": "紫微斗数十二宫之首，代表本人的性情与整体格局。",
    "身宫": "与命宫并列的另一个焦点宫，多用在中年之后的自我状态。",
    "大限": "紫微斗数里每十年一段的运势区间，每个宫位对应一段年龄。",
    "四化": "禄、权、科、忌四种标记，表示某颗星在这一年被特别引动。",
    "禄": "四化之一，偏向资源、机会、顺遂的一面。",
    "权": "四化之一，偏向掌控、推动、压力的一面。",
    "科": "四化之一，偏向名声、条理、被看见的一面。",
    "忌": "四化之一，偏向执着、阻碍、需要留心的一面。",
    "空宫": "这一宫没有主星，判断时要借对宫的星来看。",
    "庙": "星曜亮度的一档，表示这颗星在这个位置发挥得比较充分。",
    "旺": "星曜亮度的一档，仅次于庙。",
    "得": "星曜亮度的一档，中等偏好。",
    "平": "星曜亮度的一档，中性。",
    "陷": "星曜亮度的一档，表示这颗星在这个位置发挥受限。",
    "福星贵人": "主顺遂、少阻滞的一颗吉星，多指做事容易有人接应。",
    "魁罡": "日柱为庚辰、庚戌、壬辰、戊戌等组合的传统说法，多指性格刚烈、有决断。",
    "流霞": "传统神煞，多提示注意休息与安全，属于民俗说法。",
    "绞煞": "传统神煞，指事情容易来回拉扯、反复。",
    "十恶大败": "传统凶煞名，是四柱组合上的一个不利标志，不作事件断定。",
    "国印贵人": "主名分、印信与职务的一颗吉星。",
    "德秀": "主品德与文采的一颗吉星，多用于说明气质与表达。",
    "童子": "传统神煞，多与体质、性情敏感相关，属于民俗说法。",
    "偏印格": "以月令偏印为主要依据的格局候选，多指偏门方法、灵感型路径。",
    "食神格": "以月令食神为依据的格局候选，多指以产出、手艺、口碑立身。",
    "正官格": "以月令正官为依据的格局候选，多指规则、职位、体制内路径。",
    "七杀格": "以月令七杀（偏官）为依据的格局候选，多指在压力与竞争里成长。",
    "正财格": "以月令正财为依据的格局候选，多指按劳所得、稳定经营。",
    "偏财格": "以月令偏财为依据的格局候选，多指流动的资源与外部机会。",
    "伤官格": "以月令伤官为依据的格局候选，多指表达、技艺、改革型路径。",
    "建禄格": "月令为日主临官（禄）之地的格局候选，多指自力更生。",
    "夫妻宫": "紫微十二宫之一，看亲密关系里的相处方式与期待。",
    "官禄宫": "紫微十二宫之一，看事业、职责与外在角色的呈现方式。",
    "财帛宫": "紫微十二宫之一，看钱的来路、用法与对物质的感受。",
    "迁移宫": "紫微十二宫之一，看外出、变动与和外部世界打交道的方式。",
    "疾厄宫": "紫微十二宫之一，看体质与压力的承受方式，不构成医学判断。",
    "田宅宫": "紫微十二宫之一，看居所、家庭资产与安顿感。",
    "福德宫": "紫微十二宫之一，看精神享受、兴趣与内心的松弛度。",
    "父母宫": "紫微十二宫之一，看与长辈、上级以及文书资质的关系。",
    "兄弟宫": "紫微十二宫之一，看手足、同辈与合作伙伴的相处。",
    "仆役宫": "紫微十二宫之一，看朋友、下属与协作关系的样貌。",
    "子女宫": "紫微十二宫之一，看子女缘分、创作与培养。",
    "紫微": "十四主星之首，多指主导欲、场面感与自我要求高。",
    "天机": "十四主星之一，主思虑、变化与策划。",
    "太阳": "十四主星之一，主外放、公开与付出，偏向被看见。",
    "武曲": "十四主星之一，主执行与财务，重实际、动作直接。",
    "天同": "十四主星之一，主温和、享受与情绪，偏软性。",
    "廉贞": "十四主星之一，主规矩与情感张力并存，爱憎分明。",
    "天府": "十四主星之一，主库藏与稳定，重积累、能守。",
    "太阴": "十四主星之一，主内敛、细致与照顾，偏静态。",
    "贪狼": "十四主星之一，主欲望、才艺与交际，兴趣广。",
    "巨门": "十四主星之一，主言语与辨析，容易就事论理。",
    "天相": "十四主星之一，主辅佐与协调，重体面与秩序。",
    "天梁": "十四主星之一，主原则与庇护，爱操心、讲道理。",
    "七杀": "十四主星之一，主冲劲与决断，敢闯也容易硬碰。",
    "破军": "十四主星之一，主破旧立新，变动与重启。",
    "左辅": "助力型辅星，主有人帮、有人配合。",
    "右弼": "助力型辅星，和左辅同类，主被支持。",
    "文昌": "主文书、条理与学习能力。",
    "文曲": "主表达、才艺与口才。",
    "天魁": "贵人星，偏明面上的提携。",
    "天钺": "贵人星，偏暗处的帮助。",
    "禄存": "主积累与守成，偏稳定的资源。",
    "天马": "主奔波与流动，事情多在移动中发生。",
    "擎羊": "煞星，主直接而来的阻力与冲突。",
    "陀罗": "煞星，主拖延、反复与磨。",
    "火星": "煞星，主急躁与突发。",
    "铃星": "煞星，主闷在心里的急与压力。",
    "地空": "空曜，主落差与意外的落空，也主想象力。",
    "地劫": "空曜，主付出与回报不匹配的一面。",
    "红鸾": "喜庆之星，多与感情、婚嫁的场合相关。",
    "天喜": "喜庆之星，和红鸾同类，主喜事与热闹。",
  };

  function clean(text) {
    return String(text || "")
      .replace(/\*\*/g, "")
      .replace(/^\s*\|.*\|\s*$/gm, "")
      .replace(/^[-|:\s]+$/gm, "")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  function buildIndex(payload) {
    var map = {};
    (payload.documents || []).forEach(function (doc) {
      (doc.chapters || []).forEach(function (chapter) {
        (chapter.subsections || []).forEach(function (sub) {
          var title = String(sub.title || "").trim();
          if (!title) return;
          var body = (sub.items || []).map(function (item) {
            return clean(item.text || "");
          }).filter(Boolean).join("\n");
          if (!body) return;
          if (!map[title]) map[title] = { title: title, text: body, source: doc.title || "" };
        });
      });
    });
    return map;
  }

  function load() {
    if (knowledgePromise) return knowledgePromise;
    knowledgePromise = fetch("knowledge/knowledge-v1.json")
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (payload) {
        index = payload ? buildIndex(payload) : {};
        return index;
      })
      .catch(function () {
        index = {};
        return index;
      });
    return knowledgePromise;
  }

  function lookup(term) {
    var key = String(term || "").trim();
    if (!key) return null;
    if (index && index[key]) {
      var hit = index[key];
      return { title: hit.title, text: hit.text, source: hit.source ? "《" + hit.source + "》摘录" : "古籍摘录" };
    }
    if (OWN[key]) return { title: key, text: OWN[key], source: "本项目释义" };
    // 去掉「候选」这类后缀再查一次
    var short = key.replace(/候选|格$|年$|局$/, "");
    if (short !== key && OWN[short]) return { title: short, text: OWN[short], source: "本项目释义" };
    return null;
  }

  var sheet = null;

  function ensureSheet() {
    if (sheet) return sheet;
    sheet = document.createElement("div");
    sheet.className = "glossary-sheet";
    sheet.hidden = true;
    sheet.innerHTML =
      '<div class="glossary-mask"></div>' +
      '<div class="glossary-card" role="dialog" aria-modal="true">' +
      '<div class="glossary-head"><h3 id="glossary-title">术语</h3><button type="button" class="glossary-close" aria-label="关闭">关闭</button></div>' +
      '<p class="glossary-text" id="glossary-text"></p>' +
      '<p class="glossary-source" id="glossary-source"></p>' +
      "</div>";
    document.body.appendChild(sheet);

    sheet.addEventListener("click", function (event) {
      if (event.target.closest(".glossary-close") || event.target.classList.contains("glossary-mask")) {
        hide();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") hide();
    });
    return sheet;
  }

  function hide() {
    if (sheet) sheet.hidden = true;
  }

  function show(term) {
    var entry = lookup(term);
    ensureSheet();
    var title = document.getElementById("glossary-title");
    var text = document.getElementById("glossary-text");
    var source = document.getElementById("glossary-source");
    if (!entry) {
      title.textContent = String(term);
      text.textContent = "这个词还没有收录解释。可以到「规则与来源」里查它的出处。";
      source.textContent = "";
    } else {
      title.textContent = entry.title;
      var body = entry.text.split("\n")
        .filter(function (line) { return !/^名称[:：]/.test(line.trim()); })
        .slice(0, 8).join("\n");
      text.textContent = body;
      source.textContent = entry.source;
    }
    sheet.hidden = false;
  }

  function bind(root) {
    if (!root) return;
    root.addEventListener("click", function (event) {
      var node = event.target.closest("[data-term]");
      if (!node) return;
      event.preventDefault();
      event.stopPropagation();
      show(node.getAttribute("data-term"));
    });
  }

  function css() {
    if (document.getElementById("glossary-style")) return;
    var style = document.createElement("style");
    style.id = "glossary-style";
    style.textContent = [
      ".glossary-sheet{position:fixed;inset:0;z-index:60;display:flex;align-items:flex-end}",
      ".glossary-sheet[hidden]{display:none}",
      ".glossary-mask{position:absolute;inset:0;background:rgba(35,32,27,.42)}",
      ".glossary-card{position:relative;width:100%;max-height:70vh;overflow:auto;background:var(--surface,#FBF8F2);",
      "border-radius:16px 16px 0 0;padding:20px 20px calc(28px + env(safe-area-inset-bottom));",
      "box-shadow:0 -8px 32px rgba(0,0,0,.18)}",
      ".glossary-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}",
      ".glossary-head h3{margin:0;font-family:var(--font-serif,'Songti SC',serif);font-size:20px;letter-spacing:.06em}",
      ".glossary-close{min-height:44px;min-width:44px;font-size:13px;color:var(--muted,#6B6157)}",
      ".glossary-text{margin:10px 0 0;line-height:1.8;white-space:pre-wrap;font-size:14px;color:var(--text,#23201B)}",
      ".glossary-source{margin:10px 0 0;font-size:12px;color:var(--muted,#6B6157)}",
      "[data-term]{cursor:pointer;text-decoration:underline dotted rgba(107,97,87,.5);text-underline-offset:3px}"
    ].join("");
    document.head.appendChild(style);
  }

  css();
  load();

  global.MingliGlossary = Object.freeze({ show: show, hide: hide, bind: bind, lookup: lookup });
})(typeof window !== "undefined" ? window : globalThis);
