"use strict";

(() => {
  const STAR_LANGUAGE = Object.freeze({
    紫微: { focus: "统筹、主导和承担责任", question: "需要拿主意时，你通常怎样汇总信息并让事情继续推进？" },
    天机: { focus: "分析、规划和随情况调整", question: "计划发生变化时，你会先重新分析，还是先试一个可行的小步骤？" },
    太阳: { focus: "表达、支持和公开承担", question: "需要站出来说明或帮助别人时，你怎样兼顾自己与他人的需要？" },
    武曲: { focus: "目标、效率和资源安排", question: "面对有限时间或资源时，你通常用什么标准排定优先级？" },
    天同: { focus: "体验、协调和保留余地", question: "遇到分歧时，你更常先缓和气氛，还是先把问题说清楚？" },
    廉贞: { focus: "边界、规则和复杂取舍", question: "规则与现实冲突时，你通常怎样判断什么可以调整、什么必须坚持？" },
    天府: { focus: "稳定、储备和长期维护", question: "开始一件长期事情前，你会怎样准备资源并维持节奏？" },
    太阴: { focus: "细节、积累和内在安全感", question: "做重要决定时，哪些细节会让你真正感到安心？" },
    贪狼: { focus: "兴趣、人际互动和多种体验", question: "选择很多时，你怎样分辨短暂吸引与真正想长期投入的方向？" },
    巨门: { focus: "提问、讨论和辨别信息", question: "意见不一致时，你怎样确认双方谈的是同一个问题？" },
    天相: { focus: "协作、公平和处理程序", question: "多人合作时，你会怎样分工并确认每个人的责任边界？" },
    天梁: { focus: "照顾、原则和经验传递", question: "别人需要帮助时，你怎样支持对方又不替对方承担全部责任？" },
    七杀: { focus: "决断、开拓和压力下行动", question: "信息不完整却必须行动时，你会怎样控制风险并作出决定？" },
    破军: { focus: "改变、重组和告别旧做法", question: "旧方法不再适用时，你通常先拆掉重来，还是边运行边调整？" }
  });

  const THEME_SPECS = Object.freeze([
    { palace: "命宫", title: "我通常怎样开始一件事", fallbackQuestion: "面对一件新事情时，你通常从哪里开始？" },
    { palace: "官禄宫", title: "工作与责任怎么处理", fallbackQuestion: "面对工作目标时，你通常怎样安排责任与节奏？" },
    { palace: "财帛宫", title: "金钱与资源怎么安排", fallbackQuestion: "需要分配金钱、时间或精力时，你最看重什么？" },
    { palace: "夫妻宫", title: "亲密关系里关注什么", fallbackQuestion: "重要关系出现分歧时，你通常怎样表达需求与边界？" },
    { palace: "福德宫", title: "怎样休息才真正恢复", fallbackQuestion: "忙碌之后，什么样的休息方式最能让你恢复状态？" },
    { palace: "迁移宫", title: "面对新环境如何适应", fallbackQuestion: "进入陌生环境时，你会先观察、先行动，还是先寻找熟悉的人？" }
  ]);

  function starNames(palace) {
    return (palace?.majorStars || []).map(star => star.name).filter(Boolean);
  }

  function joinChinese(items) {
    if (items.length < 2) return items[0] || "";
    return `${items.slice(0, -1).join("、")}和${items.at(-1)}`;
  }

  function makeTheme(chart, spec) {
    const palace = chart.palaces.find(item => item.name === spec.palace);
    if (!palace) return null;
    const names = starNames(palace);
    if (!names.length) {
      return {
        palace: spec.palace,
        title: spec.title,
        evidence: `${spec.palace} · 无十四主星`,
        summary: `这里没有十四主星，不等于“这方面没有内容”。传统排盘需要结合对宫和其他星曜共同阅读，当前基础版不单独下结论。`,
        question: `可以先自我核对：${spec.fallbackQuestion}`
      };
    }

    const languages = names.map(name => STAR_LANGUAGE[name]).filter(Boolean);
    const focuses = [...new Set(languages.map(item => item.focus))];
    const focusText = joinChinese(focuses);
    const firstQuestion = languages[0]?.question || spec.fallbackQuestion;
    return {
      palace: spec.palace,
      title: spec.title,
      evidence: `${spec.palace} · ${names.join("、")}`,
      summary: `这一宫主要观察“${palace.topic}”。盘面的主星可以先翻译成对${focusText || "这一生活主题"}的关注；它描述的是阅读角度，不是对现实经历的定论。`,
      question: `可以先自我核对：${firstQuestion}`
    };
  }

  function interpret(chart) {
    if (!chart || chart.status !== "ok") return null;
    const destiny = chart.palaces.find(item => item.name === "命宫");
    const body = chart.palaces.find(item => item.isBodyPalace);
    const destinyStars = starNames(destiny);
    return {
      heading: "先看六个生活问题",
      introduction: "不需要先学会星曜名称。下面把宫位翻译成日常问题，再告诉你这句话来自盘面的哪里；觉得符合或不符合，都可以作为继续核对的线索。",
      facts: [
        {
          label: "整张盘从哪里读起",
          value: `命宫在${chart.basics.soulPalaceBranch}${destinyStars.length ? ` · ${destinyStars.join("、")}` : ""}`,
          explanation: "命宫是阅读起点，不是性格判决。"
        },
        {
          label: "现实投入常看哪里",
          value: `身宫在${chart.basics.bodyPalaceBranch}${body ? ` · ${body.name}` : ""}`,
          explanation: "身宫用来补充观察日常更常投入的生活领域。"
        },
        {
          label: "运限计算分类",
          value: chart.basics.fiveElementsClass,
          explanation: "五行局用于传统运限起法，不是五行强弱评分。"
        }
      ],
      themes: THEME_SPECS.map(spec => makeTheme(chart, spec)).filter(Boolean),
      boundary: "这是基础白话版：当前只把宫位、十四主星和运限坐标翻译成日常语言，不用单颗星或单个年份预测吉凶或具体事件。四化与叠宫已经作为可核对事实列出，但尚未直接生成命运断语。"
    };
  }

  globalThis.MingliZiweiInterpretation = Object.freeze({ interpret, starLanguage: STAR_LANGUAGE });
})();
