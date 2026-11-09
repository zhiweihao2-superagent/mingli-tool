// 干支关系小工具：十神、地支六合/相冲/相害。today / cycle 两个页面共用。
(function (global) {
  "use strict";

  var ELEMENT = { 甲: "木", 乙: "木", 丙: "火", 丁: "火", 戊: "土", 己: "土", 庚: "金", 辛: "金", 壬: "水", 癸: "水" };
  var YANG = { 甲: true, 丙: true, 戊: true, 庚: true, 壬: true };
  var GENERATES = { 木: "火", 火: "土", 土: "金", 金: "水", 水: "木" };
  var CONTROLS = { 木: "土", 土: "水", 水: "火", 火: "金", 金: "木" };
  var COMBINE = { "子丑": 1, "寅亥": 1, "卯戌": 1, "辰酉": 1, "巳申": 1, "午未": 1 };
  var CLASH = { "子午": 1, "丑未": 1, "寅申": 1, "卯酉": 1, "辰戌": 1, "巳亥": 1 };
  var HARM = { "子未": 1, "丑午": 1, "寅巳": 1, "卯辰": 1, "申亥": 1, "酉戌": 1 };

  function tenGod(dayStem, otherStem) {
    if (!dayStem || !otherStem) return "";
    var a = ELEMENT[dayStem];
    var b = ELEMENT[otherStem];
    if (!a || !b) return "";
    var same = Boolean(YANG[dayStem]) === Boolean(YANG[otherStem]);
    if (b === a) return same ? "比肩" : "劫财";
    if (GENERATES[a] === b) return same ? "食神" : "伤官";
    if (CONTROLS[a] === b) return same ? "偏财" : "正财";
    if (CONTROLS[b] === a) return same ? "偏官" : "正官";
    if (GENERATES[b] === a) return same ? "偏印" : "正印";
    return "";
  }

  function branchRelation(a, b) {
    if (!a || !b) return "";
    var key = a + b;
    var alt = b + a;
    if (COMBINE[key] || COMBINE[alt]) return "六合";
    if (CLASH[key] || CLASH[alt]) return "相冲";
    if (HARM[key] || HARM[alt]) return "相害";
    if (a === b) return "同支";
    return "";
  }

  var GOD_COPY = {
    "比肩": "更像靠自己扛事的一段，合作前把分工写清楚。",
    "劫财": "同辈之间的比较与分账容易冒头，先定规则。",
    "食神": "适合把想法做成作品或流程，输出比争抢有用。",
    "伤官": "表达欲强，容易顶到台面上，说之前先划边界。",
    "偏财": "外部机会多，先分清哪些值得长期跟。",
    "正财": "按部就班的一段，交付做好了回报会跟着来。",
    "偏官": "压力与责任一起上来，先排优先级再答应新事。",
    "正官": "规则与职责更显眼，把职责写清反而是保护。",
    "偏印": "适合学习和方法论，不太适合临场拍板。",
    "正印": "容易得到帮助或资质上的进展，把手续办完。"
  };

  global.MingliCycle = Object.freeze({
    tenGod: tenGod,
    branchRelation: branchRelation,
    elementOf: function (stem) { return ELEMENT[stem] || ""; },
    copyOf: function (god) { return GOD_COPY[god] || ""; }
  });
})(typeof window !== "undefined" ? window : globalThis);
