"use strict";

(() => {
  const dayMasterReadings = {
    甲: ["木", "甲是日柱上方的天干，传统五行归为木。它是本工具比较其他干支关系的参照，不是性格结论。"],
    乙: ["木", "乙是日柱上方的天干，传统五行归为木。它是本工具比较其他干支关系的参照，不是性格结论。"],
    丙: ["火", "丙是日柱上方的天干，传统五行归为火。它是本工具比较其他干支关系的参照，不是性格结论。"],
    丁: ["火", "丁是日柱上方的天干，传统五行归为火。它是本工具比较其他干支关系的参照，不是性格结论。"],
    戊: ["土", "戊是日柱上方的天干，传统五行归为土。它是本工具比较其他干支关系的参照，不是性格结论。"],
    己: ["土", "己是日柱上方的天干，传统五行归为土。它是本工具比较其他干支关系的参照，不是性格结论。"],
    庚: ["金", "庚是日柱上方的天干，传统五行归为金。它是本工具比较其他干支关系的参照，不是性格结论。"],
    辛: ["金", "辛是日柱上方的天干，传统五行归为金。它是本工具比较其他干支关系的参照，不是性格结论。"],
    壬: ["水", "壬是日柱上方的天干，传统五行归为水。它是本工具比较其他干支关系的参照，不是性格结论。"],
    癸: ["水", "癸是日柱上方的天干，传统五行归为水。它是本工具比较其他干支关系的参照，不是性格结论。"]
  };

  const tenGodReadings = {
    比肩: "同辈、同事间的合作与分工。可以检查哪些事自己做更合适，哪些要先谈清分工；不代表一定有人帮你或和你竞争。",
    劫财: "共同投入和资源分配。合作前先说清责任、成本和边界；不等于破财。",
    食神: "技能表达、分享和持续做出成果。可以观察是否把会做的事稳定做出来；不代表一定出名或赚钱。",
    伤官: "提出新想法、表达不同意见和改变做法。重点是怎样说清想法、怎样处理规则沟通；不代表叛逆或惹麻烦。",
    正财: "计划执行、稳定安排和资源管理。可用预算、计划与持续完成来理解；不代表收入多少或财富保证。",
    偏财: "灵活协作、调动资源和评估机会。投入前先算清风险；不代表意外之财。",
    正官: "规则、职责、承诺和信任。可观察怎样承担责任、遵守约定；不代表职位或考试结果。",
    偏官: "也称七杀，常用来观察压力任务、挑战和边界。重点是评估风险、拆解难题；不代表凶祸。",
    正印: "学习、整理经验和吸收支持。重点是把学到的知识转成行动；不代表一定有人庇护。",
    偏印: "自主学习、特别兴趣和非惯常思路。重点是筛选信息、验证想法；不代表孤僻或古怪。"
  };

  const tenGodTopics = {
    比肩: "同辈合作与分工",
    劫财: "共同投入与资源分配",
    食神: "技能表达与持续产出",
    伤官: "创意表达与规则沟通",
    正财: "计划执行与资源管理",
    偏财: "机会评估与灵活协作",
    正官: "规则责任与建立信任",
    偏官: "压力应对与风险拆解",
    正印: "学习积累与经验支持",
    偏印: "自主学习与信息筛选"
  };

  const stems = "甲乙丙丁戊己庚辛壬癸";
  const elements = ["木", "木", "火", "火", "土", "土", "金", "金", "水", "水"];
  const samePolarity = ["比肩", "食神", "偏财", "偏官", "偏印"];
  const differentPolarity = ["劫财", "伤官", "正财", "正官", "正印"];

  const pillars = [
    ["year", "年柱", "传统观察：家庭背景与较早环境"],
    ["month", "月柱", "传统观察：成长环境与工作方式"],
    ["day", "日柱", "传统观察：自我状态与亲密关系"],
    ["hour", "时柱", "传统观察：后续规划与长期关注"]
  ];

  function stemRelation(dayStem, otherStem) {
    const dayIndex = stems.indexOf(dayStem);
    const otherIndex = stems.indexOf(otherStem);
    if (dayIndex < 0 || otherIndex < 0) return null;
    const relation = (Math.floor(otherIndex / 2) - Math.floor(dayIndex / 2) + 5) % 5;
    const labels = dayIndex % 2 === otherIndex % 2 ? samePolarity : differentPolarity;
    return { tenGod: labels[relation], element: elements[otherIndex] };
  }

  function explainCycle(ganzhi, dayStem, periodName) {
    const relation = stemRelation(dayStem, ganzhi?.[0]);
    if (!relation) return `${periodName}干支为${ganzhi || "未知"}，目前缺少日主或可识别的天干，无法给出对应关系说明；不会猜测。`;
    const meaning = tenGodReadings[relation.tenGod];
    return `${periodName}对应干支${ganzhi}。以日主${dayStem}（${dayMasterReadings[dayStem][0]}）为参照，天干${ganzhi[0]}（${relation.element}）的传统关系标签是“${relation.tenGod}”：${meaning}`;
  }

  function describe(calculation) {
    const dayStem = calculation?.derived?.day_master;
    const dayReading = dayMasterReadings[dayStem];
    if (!dayReading) return null;

    return {
      dayMaster: {
        stem: dayStem,
        element: dayReading[0],
        reading: `${dayReading[1]}“十神”是按其他天干和${dayStem}之间的五行关系得到的分类标签，不是十个神，也不是对你本人的评价。`
      },
      pillars: pillars.map(([key, title, domain]) => {
        const pillar = calculation.pillars?.[key];
        if (!pillar) {
          return {
            key, title, domain, unknown: true,
            headline: "这部分资料不足，暂不解读。",
            reading: "本次没有提供可用的出生时刻，因此这一柱保持未知；不会用其他信息猜补。"
          };
        }

        const tenGod = pillar.ten_god;
        const tenGodReading = tenGodReadings[tenGod];
        const isDay = key === "day";
        const hiddenStems = (pillar.hidden_stems || []).map(item => ({
          stem: item.stem,
          element: item.element,
          tenGod: item.ten_god,
          meaning: tenGodReadings[item.ten_god] || "这是日主与该藏干之间的传统关系标签。"
        }));
        const headline = isDay
          ? `日干${dayStem}（${dayReading[0]}）是关系参照点` 
          : tenGodReading
            ? `关系主题：${tenGodTopics[tenGod] || tenGodReading}（标签：${tenGod}）`
            : "以日主为参照，观察这一柱的干支组合。";
        const reading = isDay
          ? `日柱上方的${dayStem}就是这张盘的参照点（传统称“日主”），所以不再给自己标一个十神。日支${pillar.branch}是日柱下方的地支；传统会把它作为观察自身状态与亲密关系的一个角度，但本工具不据此断定婚恋结果。`
          : tenGodReading
            ? `这张盘的${title}是${pillar.ganzhi}，天干${pillar.stem}相对日主${dayStem}的传统标签是“${tenGod}”。${domain}是传统上借${title}观察的范围。白话参考：${tenGodReading}这只是一个观察角度，不是对你现实经历的定论。`
            : `这张盘的${title}是${pillar.ganzhi}，但目前没有可识别的天干十神标签。${domain}是传统上借${title}观察的范围；本工具不补写性格或吉凶结论。`;

        return {
          key, title, domain, ganzhi: pillar.ganzhi, tenGod,
          tenGodReading: tenGodReading || (isDay ? "日干为日主本身，不另标十神。" : "当前盘面没有可识别的十神说明。"),
          headline, reading, hiddenStems, unknown: false
        };
      }),
      note: "以下内容是依据干支与十神标签整理的传统文化入门说明，不是科学测评，也不能据此确定性格、婚恋、财富或未来。"
    };
  }

  globalThis.MingliInterpretation = Object.freeze({ describe, explainCycle, stemRelation });
})();
