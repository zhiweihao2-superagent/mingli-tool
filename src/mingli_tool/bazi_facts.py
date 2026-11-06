"""Deterministic, interpretation-free facts derived from a BaZi chart."""

from __future__ import annotations
from . import declarative_rules
from .auxiliary_chart import (
    build_auxiliary_chart,
    build_shensha,
    build_stem_root_audit,
)
from .cycle_interactions import build_cycle_interactions
from .xiaoyun import build_xiaoyun_years

import json
from itertools import combinations, product
from typing import Any

from scripts import pai_pan as engine
from .bazi_rules import build as build_derived_rules


SCHEMA_VERSION = "bazi-facts/v3"
PILLAR_ORDER = ("year", "month", "day", "hour")
STEM_ELEMENT = dict(zip(engine.GAN, engine.GAN_WUXING, strict=True))
BRANCH_ELEMENT = {
    "子": "水", "丑": "土", "寅": "木", "卯": "木", "辰": "土", "巳": "火",
    "午": "火", "未": "土", "申": "金", "酉": "金", "戌": "土", "亥": "水",
}

STEM_COMBINES = {
    frozenset(pair): result
    for pair, result in (("甲己", "土"), ("乙庚", "金"), ("丙辛", "水"), ("丁壬", "木"), ("戊癸", "火"))
}
STEM_CLASHES = {frozenset(pair) for pair in ("甲庚", "乙辛", "丙壬", "丁癸")}
BRANCH_COMBINES = {
    frozenset(pair): result
    for pair, result in (("子丑", "土"), ("寅亥", "木"), ("卯戌", "火"), ("辰酉", "金"), ("巳申", "水"), ("午未", "土"))
}
BRANCH_CLASHES = {frozenset(pair) for pair in ("子午", "丑未", "寅申", "卯酉", "辰戌", "巳亥")}
BRANCH_HARMS = {frozenset(pair) for pair in ("子未", "丑午", "寅巳", "卯辰", "申亥", "酉戌")}
BRANCH_BREAKS = {frozenset(pair) for pair in ("子酉", "丑辰", "寅亥", "卯午", "巳申", "未戌")}
THREE_HARMONIES = {
    frozenset("申子辰"): "水", frozenset("亥卯未"): "木",
    frozenset("寅午戌"): "火", frozenset("巳酉丑"): "金",
}
THREE_MEETINGS = {
    frozenset("亥子丑"): "水", frozenset("寅卯辰"): "木",
    frozenset("巳午未"): "火", frozenset("申酉戌"): "金",
}
THREE_PUNISHMENTS = (
    frozenset("寅巳申"),
    frozenset("丑戌未"),
)
# 十二支的旺支：半合/半会必须带其中之一，否则是"拱"（缺旺支的两支）
# 参与柱 → 所属层。本命四柱是 natal；流年/大运的参与者带前缀（annual-2026 / luck-1）。
_NATAL_NAMES = frozenset({"year", "month", "day", "hour"})
_LAYER_PREFIX = (
    ("annual-", "annual"),
    ("monthly-", "monthly"),
    ("luck-", "luck"),
    ("liunian", "annual"),
    ("liuyue", "monthly"),
    ("dayun", "luck"),
)


def _layer_of(name: str) -> str:
    """参与者名 → 所属层。未知名称直接报错，不能默认成 natal。"""
    if name in _NATAL_NAMES:
        return "natal"
    for prefix, layer in _LAYER_PREFIX:
        if str(name).startswith(prefix):
            return layer
    raise ValueError(f"未知的参与柱名称：{name!r}")

VOID_BRANCHES = frozenset("子卯午酉")

# 藏干表：与 scripts/pai_pan.py 的 CANGGAN 保持一致（tests 里有断言比对）
HIDDEN_STEMS: dict[str, tuple[str, ...]] = {
    "子": ("癸",),
    "丑": ("己", "癸", "辛"),
    "寅": ("甲", "丙", "戊"),
    "卯": ("乙",),
    "辰": ("戊", "乙", "癸"),
    "巳": ("丙", "庚", "戊"),
    "午": ("丁", "己"),
    "未": ("己", "丁", "乙"),
    "申": ("庚", "壬", "戊"),
    "酉": ("辛",),
    "戌": ("戊", "辛", "丁"),
    "亥": ("壬", "甲"),
}

# 暗合（项目口径）：只认传统上通行的四组，不采用"藏干自由相合"。
# 自由规则会命中 30/66 组地支对，几乎失去区分度；白名单直接钉死常见四组。
# 注释说明这是本项目的取舍，不编造古籍出处。
BRANCH_HIDDEN_COMBINES = frozenset({
    frozenset("子巳"),
    frozenset("丑寅"),
    frozenset("卯申"),
    frozenset("午亥"),
})

PAIR_PUNISHMENT = frozenset("子卯")
SELF_PUNISHMENT = frozenset("辰午酉亥")


def _fnv1a(text: str) -> str:
    value = 0x811C9DC5
    for byte in text.encode("utf-8"):
        value ^= byte
        value = (value * 0x01000193) & 0xFFFFFFFF
    return f"{value:08x}"


def _binding(kind: str, left: dict[str, Any], right: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "evidence_id": f"natal.relation.{kind}.{left['name']}.{right['name']}",
        "kind": kind,
        "participants": [left["name"], right["name"]],
        "values": [left["value"], right["value"]],
        **extra,
    }


# 每个地支应有的藏干数量（子1 丑3 寅3 卯1 辰3 巳3 午2 未3 申3 酉1 戌3 亥2）
HIDDEN_STEM_COUNTS = {
    "子": 1, "丑": 3, "寅": 3, "卯": 1, "辰": 3, "巳": 3,
    "午": 2, "未": 3, "申": 3, "酉": 1, "戌": 3, "亥": 2,
}
# 只比数量不够：寅若把戊换成丙，数量仍是 3，但寅丑会漏掉戊癸、重复丙辛。
EXPECTED_HIDDEN_STEMS = {
    "子": ("癸",), "丑": ("己", "癸", "辛"), "寅": ("甲", "丙", "戊"),
    "卯": ("乙",), "辰": ("戊", "乙", "癸"), "巳": ("丙", "庚", "戊"),
    "午": ("丁", "己"), "未": ("己", "丁", "乙"), "申": ("庚", "壬", "戊"),
    "酉": ("辛",), "戌": ("戊", "辛", "丁"), "亥": ("壬", "甲"),
}


def _hidden_stems(branch: str) -> tuple[str, ...]:
    """从引擎的 CANGGAN 表取藏干。

    除了"表项为空"，还要校验**条目不完整**：寅少了丙或戊仍然非空，
    但会让寅丑暗合漏掉丙辛/戊癸——那是静默错算，必须报错。
    """
    table = getattr(engine, "CANGGAN", None)
    if not isinstance(table, dict):
        raise ValueError("引擎缺少 CANGGAN 藏干表，暗合无法计算")
    entry = table.get(branch)
    if not entry:
        raise ValueError(f"未知地支：{branch!r}")
    stems = tuple(stem for stem, _element in entry)
    expected = EXPECTED_HIDDEN_STEMS.get(branch)
    if expected is not None and tuple(stems) != expected:
        raise ValueError(
            f"{branch} 的藏干与登记值不符：期望 {expected}，实际 {stems}"
        )
    return stems


def _hidden_combinations(left_branch: str, right_branch: str) -> list[dict[str, str]]:
    """两支藏干之间有方向的五合枚举。

    只证明"藏干组合匹配"：命中范围很宽（不同支就有 18 组），
    本身不足以构成严格暗合，因此单列此入口供调用方/测试直接使用。
    """
    pairs = [
        {
            "left_stem": left_hidden,
            "right_stem": right_hidden,
            "result_element": STEM_COMBINES[frozenset((left_hidden, right_hidden))],
        }
        for left_hidden in _hidden_stems(left_branch)
        for right_hidden in _hidden_stems(right_branch)
        if frozenset((left_hidden, right_hidden)) in STEM_COMBINES
    ]
    pairs.sort(key=lambda item: (
        engine.GAN.index(item["left_stem"]), engine.GAN.index(item["right_stem"]),
    ))
    return pairs


def _pair_relations(pillars: dict[str, Any]) -> list[dict[str, Any]]:
    ordered_names = [name for name in PILLAR_ORDER if pillars.get(name)]
    ordered_names.extend(sorted(name for name, value in pillars.items() if name not in PILLAR_ORDER and value))
    available = [(name, pillars[name]) for name in ordered_names]
    # 地支与藏干都要先校验：藏干表缺项会让暗合静默消失，
    # 只在地支非法时报错还不够。
    for name, pillar in available:
        branch = pillar.get("branch")
        if branch not in engine.ZHI:
            raise ValueError(f"{name} 柱的地支非法：{branch!r}")
        _hidden_stems(branch)  # 缺项直接抛 ValueError
    facts: list[dict[str, Any]] = []
    for (left_name, left), (right_name, right) in combinations(available, 2):
        stems = frozenset((left["stem"], right["stem"]))
        branches = frozenset((left["branch"], right["branch"]))
        left_stem = {"name": left_name, "value": left["stem"]}
        right_stem = {"name": right_name, "value": right["stem"]}
        left_branch = {"name": left_name, "value": left["branch"]}
        right_branch = {"name": right_name, "value": right["branch"]}
        if stems in STEM_COMBINES:
            facts.append(_binding("stem-combine", left_stem, right_stem, result_element=STEM_COMBINES[stems]))
        if stems in STEM_CLASHES:
            facts.append(_binding("stem-clash", left_stem, right_stem))
        if branches in BRANCH_COMBINES:
            facts.append(_binding("branch-six-combine", left_branch, right_branch, result_element=BRANCH_COMBINES[branches]))
        if branches in BRANCH_CLASHES:
            facts.append(_binding("branch-six-clash", left_branch, right_branch))
        if branches in BRANCH_HARMS:
            facts.append(_binding("branch-harm", left_branch, right_branch))
        if branches in BRANCH_BREAKS:
            facts.append(_binding("branch-break", left_branch, right_branch))
        if branches == PAIR_PUNISHMENT:
            facts.append(_binding("branch-punishment", left_branch, right_branch, subtype="mutual"))
        if left["branch"] == right["branch"] and left["branch"] in SELF_PUNISHMENT:
            facts.append(_binding("branch-punishment", left_branch, right_branch, subtype="self"))

        # 半合/拱合：三合局的两支；带旺支（子卯午酉）为半合，否则为拱合。
        # 必须显式要求 len==2：frozenset 会把「子子」折叠成 {子}，
        # 而 {子} 是 {申子辰} 的真子集，不加这层就会把同支误判成半合。
        is_distinct_pair = len(branches) == 2
        for group, element in THREE_HARMONIES.items():
            if is_distinct_pair and branches < group:
                kind = ("branch-half-harmony" if branches & VOID_BRANCHES
                        else "branch-arch-harmony")
                facts.append(_binding(kind, left_branch, right_branch,
                                      result_element=element,
                                      group_element=element))

        # 半会/拱会：三会局的两支，判据同上
        for group, element in THREE_MEETINGS.items():
            if is_distinct_pair and branches < group:
                kind = ("branch-half-meeting" if branches & VOID_BRANCHES
                        else "branch-arch-meeting")
                facts.append(_binding(kind, left_branch, right_branch,
                                      result_element=element,
                                      group_element=element))

        # 暗合：项目口径的白名单四组（子巳、丑寅、卯申、午亥）。
        # - 藏干笛卡尔积只用来**枚举已入白名单支对**的五合证据，不用来决定谁算暗合；
        #   否则会命中 30/66 组，几乎失去区分度。
        # - 与六合独立判断：当前白名单与六合表无交集，所以实际不会同时输出，
        #   但规则上不互相排除（这是设计，不是遗漏）。
        # - 同支不算暗合（is_distinct_pair）。
        # 上述取舍是对 r683「自由笛卡尔积」意见的**有意偏离**，已记录在案。
        hidden_pairs = _hidden_combinations(left["branch"], right["branch"])
        # 本项目把 branch-hidden-combine 定义为**严格暗合**：子巳、丑寅、卯申、午亥
        # 四组异支。藏干五合笛卡尔积只能证明"藏干组合匹配"，命中范围很宽（不同支
        # 就有 18 组），本身不足以纳入严格暗合；所有机械匹配另以
        # branch-hidden-stem-combine-candidate 输出，由下游结合口径判断。
        # 候选 ≠ 暗合，也不代表合化成立。两者都与六合独立，可同时输出。
        if hidden_pairs:
            # 候选覆盖**全部**藏干五合匹配；严格暗合只是其中的白名单子集，
            # 两者并存而不是互斥：午亥既要给严格暗合，也要给候选。
            if is_distinct_pair and branches in BRANCH_HIDDEN_COMBINES:
                facts.append(_binding("branch-hidden-combine", left_branch, right_branch,
                                      hidden_stem_pairs=hidden_pairs))
            facts.append(_binding(
                "branch-hidden-stem-combine-candidate", left_branch, right_branch,
                hidden_stem_pairs=hidden_pairs,
                note="藏干五合枚举候选，不等于严格暗合或合化成立",
            ))

    branch_positions: dict[str, list[str]] = {}
    for name, pillar in available:
        branch_positions.setdefault(pillar["branch"], []).append(name)
    present = set(branch_positions)
    for group, element in (*THREE_HARMONIES.items(), *THREE_MEETINGS.items()):
        if group <= present:
            kind = "branch-three-harmony" if group in THREE_HARMONIES else "branch-three-meeting"
            values = sorted(group, key=lambda branch: engine.ZHI.index(branch))
            # 按**柱位组合**枚举，而不是把同值的柱合并成一条。
            # 例：年柱申 + 流年申 + 子 + 辰 应得到两组独立的申子辰，
            # 其中一组被冲克不该连坐另一组；合并成一条就无法分别追溯。
            for combo in product(*(branch_positions[value] for value in values)):
                facts.append({
                    "evidence_id": f"natal.relation.{kind}." + ".".join(combo),
                    "kind": kind,
                    "participants": list(combo),
                    "values": values,
                    "result_element": element,
                })
    stem_positions: dict[str, list[str]] = {}
    for name, pillar in available:
        stem_positions.setdefault(pillar["stem"], []).append(name)
    for stem, positions in stem_positions.items():
        if len(positions) >= 3:
            for trio in combinations(positions, 3):
                facts.append({
                    "evidence_id": "natal.relation.stem-three-combine." + ".".join(trio),
                    "kind": "stem-three-combine",
                    "participants": list(trio),
                    "values": [stem, stem, stem],
                    "result_element": STEM_ELEMENT[stem],
                })

    # 统一补 layers / bindings：没有绑定就无法核对"写着 year、实际绑的是 day"这类错配。
    stem_first_kinds = frozenset({
        "stem-combine", "stem-clash", "stem-three-combine",
    })
    pillar_by_name = dict(available)
    for fact in facts:
        channel = "stem" if fact["kind"] in stem_first_kinds else "branch"
        fact["layers"] = [_layer_of(name) for name in fact["participants"]]
        fact["bindings"] = [
            {
                "participant": name,
                "layer": _layer_of(name),
                "channel": channel,
                "value": pillar_by_name[name][channel],
            }
            for name in fact["participants"]
        ]

    for group in THREE_PUNISHMENTS:
        if group <= present:
            values = sorted(group, key=lambda branch: engine.ZHI.index(branch))
            # 与三合/三会同样按**柱位组合**枚举：同值多柱不能合并成一条，
            # 否则只涉及其中一组的冲突会连坐另一组。
            for combo in product(*(branch_positions[value] for value in values)):
                facts.append({
                    "evidence_id": "natal.relation.branch-punishment." + ".".join(combo),
                    "kind": "branch-punishment",
                    "subtype": "three-branch",
                    "participants": list(combo),
                    "values": values,
                })
    # 三支刑等后追加的关系也要补绑定：统一在返回前兜一次，缺谁补谁
    for fact in facts:
        if "bindings" in fact:
            continue
        channel = "stem" if fact["kind"] in stem_first_kinds else "branch"
        fact["layers"] = [_layer_of(name) for name in fact["participants"]]
        fact["bindings"] = [
            {
                "participant": name,
                "layer": _layer_of(name),
                "channel": channel,
                "value": pillar_by_name[name][channel],
            }
            for name in fact["participants"]
        ]
    return facts


def _annotate_transformation_reviews(
    pillars: dict[str, Any], relations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Audit combination-transformation conditions without rewriting natal elements.

    Transformation standards differ between schools.  This profile therefore
    records the observable supporting and blocking conditions and returns a
    candidate status instead of silently treating every combination as changed.
    """
    month_element = BRANCH_ELEMENT[pillars["month"]["branch"]]
    visible_elements = [STEM_ELEMENT[pillar["stem"]] for pillar in pillars.values() if pillar]
    hidden_elements = [
        hidden["element"]
        for pillar in pillars.values() if pillar
        for hidden in (pillar.get("hidden_stems") or [])
    ]
    eligible = {"stem-combine", "branch-six-combine", "branch-three-harmony", "branch-three-meeting"}
    clash_for = {
        "stem-combine": {"stem-clash"},
        "branch-six-combine": {"branch-six-clash"},
        "branch-three-harmony": {"branch-six-clash"},
        "branch-three-meeting": {"branch-six-clash"},
    }
    reviewed = []
    for relation in relations:
        item = dict(relation)
        if relation.get("kind") not in eligible or not relation.get("result_element"):
            reviewed.append(item)
            continue
        participants = set(relation.get("participants", []))
        conflicting = [
            other["evidence_id"] for other in relations
            if other is not relation
            and other.get("kind") in clash_for[relation["kind"]]
            and participants.intersection(other.get("participants", []))
        ]
        result_element = relation["result_element"]
        season_support = month_element == result_element
        visible_support = visible_elements.count(result_element)
        hidden_support = hidden_elements.count(result_element)
        supporting_conditions = ["组合结构完整"]
        if season_support:
            supporting_conditions.append("月令本气支持化神五行")
        if visible_support:
            supporting_conditions.append(f"化神五行透干 {visible_support} 处")
        if hidden_support:
            supporting_conditions.append(f"化神五行藏支 {hidden_support} 处")
        blocking_conditions = [f"参与柱另见冲动关系：{evidence_id}" for evidence_id in conflicting]
        if blocking_conditions:
            status = "blocked-candidate"
        elif season_support and (visible_support or hidden_support):
            status = "supported-candidate"
        else:
            status = "pending-candidate"
        item["transformation_review"] = {
            "profile": "combination-condition-audit-v1",
            "status": status,
            "target_element": result_element,
            "season_support": season_support,
            "visible_support_count": visible_support,
            "hidden_support_count": hidden_support,
            "supporting_conditions": supporting_conditions,
            "blocking_conditions": blocking_conditions,
            "rewrites_original_elements": False,
            "policy": "只审计成化候选的可见条件；即使条件较齐，也不自动改写原局五行。",
        }
        reviewed.append(item)
    return reviewed


def _element_inventory(pillars: dict[str, Any]) -> dict[str, Any]:
    visible = {element: 0 for element in "木火土金水"}
    branch_primary = {element: 0 for element in "木火土金水"}
    hidden = {element: 0 for element in "木火土金水"}
    hidden_weighted = {element: 0.0 for element in "木火土金水"}
    day_master = pillars["day"]["stem"]
    day_element = STEM_ELEMENT[day_master]
    exact_roots: list[dict[str, str]] = []
    element_roots: list[dict[str, str]] = []
    for name in PILLAR_ORDER:
        pillar = pillars.get(name)
        if not pillar:
            continue
        visible[STEM_ELEMENT[pillar["stem"]]] += 1
        branch_primary[BRANCH_ELEMENT[pillar["branch"]]] += 1
        for hidden_stem in pillar["hidden_stems"] or []:
            element = hidden_stem["element"]
            hidden[element] += 1
            hidden_weighted[element] += float(hidden_stem.get("nominal_weight", 0))
            evidence = {"pillar": name, "branch": pillar["branch"], "hidden_stem": hidden_stem["stem"]}
            if hidden_stem["stem"] == day_master:
                exact_roots.append(evidence)
            if element == day_element:
                element_roots.append(evidence)
    month_branch = pillars["month"]["branch"]
    return {
        "day_master": {"stem": day_master, "element": day_element},
        "month_command": {"branch": month_branch, "primary_element": BRANCH_ELEMENT[month_branch]},
        "counts": {
            "visible_stems": visible,
            "branch_primary_elements": branch_primary,
            "hidden_stems": hidden,
            "hidden_stems_nominal_weight": hidden_weighted,
        },
        "roots": {"same_stem": exact_roots, "same_element": element_roots},
        "life_stages": {
            name: {
                "pillar_stem_at_branch": pillar["stem_life_stage"],
                "day_master_at_branch": pillar["day_master_life_stage"],
            }
            for name, pillar in pillars.items() if pillar
        },
        "scoring_applied": False,
    }


def _transit_relations(scope: str, ganzhi: str, pillars: dict[str, Any]) -> dict[str, Any]:
    stem, branch = ganzhi[0], ganzhi[1]
    day_stem = pillars["day"]["stem"]
    transit = {"stem": stem, "branch": branch, "ganzhi": ganzhi, "ten_god": engine.shishen_of(engine.GAN.index(day_stem), engine.GAN.index(stem))}
    bindings = []
    temporary = dict(pillars)
    temporary[scope] = {"stem": stem, "branch": branch, "hidden_stems": []}
    for fact in _pair_relations({name: value for name, value in temporary.items() if name in PILLAR_ORDER or name == scope}):
        if scope in fact["participants"]:
            bindings.append(fact)
    return {**transit, "relations_to_natal": bindings}


_MISSING = object()


def _resolve_pointer(root: Any, pointer: str) -> Any:
    """RFC 6901 解引用；解析不到返回 _MISSING（区分"缺失"与"值为 None"）。"""
    if pointer == "":
        return root
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        return _MISSING
    node = root
    for token in pointer[1:].split("/"):
        key = token.replace("~1", "/").replace("~0", "~")
        if isinstance(node, list):
            if not key.isdigit() or int(key) >= len(node):
                return _MISSING
            node = node[int(key)]
        elif isinstance(node, dict):
            if key not in node:
                return _MISSING
            node = node[key]
        else:
            return _MISSING
    return node


def _birth_datetime(
    normalized_input: dict[str, Any] | None, calculation: dict[str, Any] | None = None
) -> Any:
    """取出生时刻；优先用**校正后的公历日期**，精度不足时返回 None（不猜）。

    原始 profile.date 可能是农历，或经真太阳时校正后跨年跨日，
    直接用会让小运的分年与截断边界错位。
    """
    import calendar
    from datetime import datetime

    profile = (normalized_input or {}).get("profile") or {}
    date_text = str(((calculation or {}).get("calendar_display") or {}).get("solar") or "")
    # calendar_display.solar 可能已含时刻（"1990-05-15 12:30"），
    # 再拼一次 time.value 会变成 "… 12:30 12:30" 而解析失败
    date_text = date_text.split(" ")[0].strip()
    if not date_text:
        date_text = str(profile.get("date") or "")
    time_block = profile.get("time") or {}
    precision = time_block.get("precision")

    def _build(hour: int, minute: int):
        try:
            return datetime.strptime(
                f"{date_text} {hour:02d}:{minute:02d}", "%Y-%m-%d %H:%M"
            )
        except (ValueError, TypeError):
            return None

    if precision == "minute" and time_block.get("value"):
        try:
            return datetime.strptime(
                f"{date_text} {time_block['value']}", "%Y-%m-%d %H:%M"
            )
        except (ValueError, TypeError):
            return None

    # 只知时辰时，时辰中点已知（如丑时 = 02:00）。
    # 小运按公历年分年、按起运时刻截断，只依赖日期与日内时刻的近似，
    # 用中点足以支撑，不必因为"没到分钟"就整块放弃。
    if precision == "branch" and time_block.get("branch"):
        from scripts.pai_pan import SHICHEN_MID

        mid = SHICHEN_MID.get(str(time_block.get("branch")))
        if mid:
            return _build(int(mid[0]), int(mid[1]))
    return None


def _first_luck_datetime(
    normalized_input: dict[str, Any] | None, calculation: dict[str, Any]
) -> Any:
    """出生时刻 + 起运年数/月数。起运精度只到月，边界按该精度如实使用。"""
    import calendar
    from datetime import datetime

    birth = _birth_datetime(normalized_input, calculation)
    if birth is None:
        return None
    start = ((calculation.get("luck_cycles") or {}).get("start")) or {}
    years = start.get("years")
    months = start.get("months") or 0
    if not isinstance(years, int):
        return None
    month_total = birth.month - 1 + int(months) + years * 12
    year = birth.year + month_total // 12
    month = month_total % 12 + 1
    # 只在目标月没有该日时收敛到月末（2 月 30 日 -> 2 月最后一天），
    # 不能一律截成 28 日：那会把 31 日出生、起运 0 年的情况算到出生之前。
    last_day = calendar.monthrange(year, month)[1]
    day = min(birth.day, last_day)
    return datetime(year, month, day, birth.hour, birth.minute)


def _validate(
    pillars: dict[str, Any], relations: list[dict[str, Any]], inventory: dict[str, Any],
    derived_rules: dict[str, Any],
    auxiliary_chart: dict[str, Any] | None = None,
    cycle_interactions: dict[str, Any] | None = None,
    calculation: dict[str, Any] | None = None,
    annual_cycles: list[dict[str, Any]] | None = None,
    luck_cycles: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    checks = [
        {
            "id": "three_core_pillars_present",
            "pass": all(pillars.get(name) for name in ("year", "month", "day")),
            "message": "年、月、日三柱完整",
        },
        {
            "id": "relation_participants_bound",
            "pass": all(item["participants"] and item["values"] for item in relations),
            "message": "所有干支关系均绑定到具体柱位",
        },
        {
            "id": "element_inventory_complete",
            "pass": sum(inventory["counts"]["visible_stems"].values()) in (3, 4)
            and sum(inventory["counts"]["branch_primary_elements"].values()) in (3, 4),
            "message": "显干与地支本气五行清单完整",
        },
        {
            "id": "inventory_kept_separate_from_rule_scoring",
            "pass": inventory["scoring_applied"] is False,
            "message": "五行清单保持原始计数，旺衰评分只存在于独立规则档案",
        },
        {
            "id": "derived_rule_profile_validated",
            "pass": derived_rules.get("validation", {}).get("status") == "pass",
            "message": "旺衰、格局、用神与调候候选通过规则层校验",
        },
    ]

    # ---- 新增子包也要进门禁：改坏它们必须让 validation 变 fail ----
    def _rule_versions_ok(node: Any) -> bool:
        """所有 envelope 的规则都必须来自已登记且已批准的规则。"""
        if isinstance(node, dict):
            rule_id = node.get("rule_id")
            # 带 status/value 却是 rule_id=null 的，是损坏 envelope，不能跳过
            if rule_id is None and "status" in node and "value" in node:
                return False
            if isinstance(rule_id, str) and "status" in node and "value" in node:
                if node.get("status") == "validated":
                    # 只有声称"已验证"的事实才必须来自已批准规则
                    if not declarative_rules.is_approved(rule_id):
                        return False
                    if node.get("rule_version") is None:
                        return False
                elif node.get("status") == "unavailable":
                    # 未裁定规则降级为 unavailable 是**预期行为**，不是失败
                    if node.get("value") is not None:
                        return False
                else:
                    return False
            return all(_rule_versions_ok(value) for value in node.values())
        if isinstance(node, list):
            return all(_rule_versions_ok(item) for item in node)
        return True

    def _evidence_ids_unique(node: Any, seen: dict[str, str]) -> bool:
        if isinstance(node, dict):
            evidence = node.get("evidence")
            if isinstance(evidence, list):
                for item in evidence:
                    if not isinstance(item, dict):
                        return False
                    evidence_id = item.get("evidence_id")
                    pointer = item.get("json_pointer")
                    if not evidence_id or not pointer:
                        return False
                    previous = seen.get(evidence_id)
                    # 同一 id 指向同一位置 = 合法的重复引用；
                    # 同一 id 指向不同位置 = 真实冲突
                    if previous is not None and previous != pointer:
                        return False
                    seen[evidence_id] = pointer
            return all(_evidence_ids_unique(value, seen) for value in node.values())
        if isinstance(node, list):
            return all(_evidence_ids_unique(item, seen) for item in node)
        return True

    def _pointers_resolvable(node: Any, root: Any, calc: dict[str, Any] | None) -> bool:
        """证据指针必须能解析到非缺失值。

        ``pointer_root`` 决定解引用根：``calculation``（输入柱，消费者在
        systems.bazi.chart 里能拿到）或 ``facts``（默认为事实包自身）。
        """
        if isinstance(node, dict):
            evidence = node.get("evidence")
            if isinstance(evidence, list):
                for item in evidence:
                    if not isinstance(item, dict):
                        return False
                    pointer = item.get("json_pointer")
                    if not isinstance(pointer, str) or not pointer.startswith("/"):
                        return False
                    which = item.get("pointer_root") or "facts"
                    if which == "calculation":
                        if calc is None:
                            return False
                        if _resolve_pointer(calc, pointer) in (None, _MISSING):
                            return False
                    elif which == "facts":
                        if _resolve_pointer(root, pointer) in (None, _MISSING):
                            return False
                    else:
                        return False
            return all(_pointers_resolvable(value, root, calc) for value in node.values())
        if isinstance(node, list):
            return all(_pointers_resolvable(item, root, calc) for item in node)
        return True

    auxiliary = auxiliary_chart or {}

    def _auxiliary_recompute_ok(node: dict[str, Any]) -> bool:
        """纳音/旬空/胎元按规则**重算**，结果必须与输出一致。"""
        from .auxiliary_chart import _nayin, _taiyuan, _xunkong

        try:
            for name in ("year", "month", "day", "hour"):
                pillar = pillars.get(name)
                nayin_entry = (node.get("nayin") or {}).get(name) or {}
                xun_entry = (node.get("xunkong") or {}).get(name) or {}
                if pillar is None:
                    if nayin_entry.get("status") != "unavailable":
                        return False
                    if xun_entry.get("status") != "unavailable":
                        return False
                    continue
                ganzhi = pillar.get("ganzhi") or (
                    str(pillar.get("stem") or "") + str(pillar.get("branch") or "")
                )
                if nayin_entry.get("status") != "validated":
                    return False
                if nayin_entry.get("value") != _nayin(ganzhi):
                    return False
                if xun_entry.get("status") != "validated":
                    return False
                if list(xun_entry.get("value") or []) != list(_xunkong(ganzhi)):
                    return False
            month = pillars.get("month")
            taiyuan = node.get("taiyuan") or {}
            if month is None:
                if taiyuan.get("status") != "unavailable":
                    return False
            else:
                month_ganzhi = month.get("ganzhi") or (
                    str(month.get("stem") or "") + str(month.get("branch") or "")
                )
                if taiyuan.get("status") != "validated":
                    return False
                if taiyuan.get("value") != _taiyuan(month_ganzhi):
                    return False
        except (KeyError, TypeError, ValueError):
            return False
        return True

    if auxiliary:
        # 事实包自身作为解引用根：auxiliary_chart 在包顶层
        root_for_pointers = {"auxiliary_chart": auxiliary}
        evidence_seen: dict[str, str] = {}
        checks.append({
            "id": "auxiliary_values_recomputable",
            "pass": _auxiliary_recompute_ok(auxiliary),
            "message": "纳音/旬空/胎元按规则重算后必须与输出一致",
        })
        checks.append({
            "id": "auxiliary_rules_registered",
            "pass": _rule_versions_ok(auxiliary),
            "message": "辅助盘的每条事实都来自已登记且已批准的规则",
        })
        checks.append({
            "id": "auxiliary_evidence_ids_unique",
            "pass": _evidence_ids_unique(auxiliary, evidence_seen),
            "message": "辅助盘的 evidence_id 唯一且证据项完整",
        })
        checks.append({
            "id": "auxiliary_pointers_resolvable",
            "pass": _pointers_resolvable(auxiliary, root_for_pointers, calculation),
            "message": "辅助盘的证据指针都能在事实包内解析",
        })

    if cycle_interactions is not None:
        status = str(cycle_interactions.get("status") or "")
        checks.append({
            "id": "cycle_interactions_status_vocabulary",
            "pass": status in ("validated", "ambiguous", "unavailable"),
            "message": "岁运相互作用的状态必须落在 validated/ambiguous/unavailable 之内",
        })
        # ambiguous / unavailable 必须给原因，不能空着
        checks.append({
            "id": "cycle_interactions_reason_given",
            "pass": status == "validated" or bool(cycle_interactions.get("reason")),
            "message": "非 validated 的岁运结果必须写明原因",
        })
        checks.append({
            "id": "cycle_interactions_items_typed",
            "pass": all(
                isinstance(item, dict) and item.get("year") is not None
                and item.get("flags")
                for item in (cycle_interactions.get("items") or [])
            ),
            "message": "每条岁运命中都要有年份与命中标志",
        })

        # 标志必须**语义成立**：并临=干支全同；天克地冲=天干相克且地支相冲
        def _flag_semantics_ok(items: list[dict[str, Any]]) -> bool:
            from .cycle_interactions import GAN_WUXING, KE, _branch_chong, _stem_ke

            for item in items:
                annual = str(item.get("annual_ganzhi") or "")
                luck = str(item.get("luck_ganzhi") or "")
                if len(annual) < 2 or len(luck) < 2:
                    return False
                for flag in item.get("flags") or []:
                    if flag == "岁运并临":
                        if annual != luck:
                            return False
                    elif flag == "天克地冲":
                        if not (_stem_ke(annual[0], luck[0]) and _branch_chong(annual[1], luck[1])):
                            return False
                    else:
                        return False
            return True

        checks.append({
            "id": "cycle_interactions_flags_semantic",
            "pass": _flag_semantics_ok(cycle_interactions.get("items") or []),
            "message": "岁运标志必须与干支实际关系一致（并临/天克地冲）",
        })

        # 指针必须能在事实包里解析
        def _cycle_pointers_ok(items: list[dict[str, Any]]) -> bool:
            fact_root = {
                "annual_cycles": annual_cycles or [],
                "luck_cycles": luck_cycles or [],
            }
            for item in items:
                for key, pool in (("annual_pointer", "annual_cycles"), ("luck_pointer", "luck_cycles")):
                    pointer = item.get(key)
                    if not isinstance(pointer, str) or not pointer.startswith(f"/{pool}/"):
                        return False
                    if _resolve_pointer(fact_root, pointer) is _MISSING:
                        return False
                if item.get("candidate_count") != len(item.get("candidates") or []):
                    return False
            return True

        checks.append({
            "id": "cycle_interactions_pointers_resolvable",
            "pass": _cycle_pointers_ok(cycle_interactions.get("items") or []),
            "message": "岁运条目的流年/大运指针必须能在事实包内解析",
        })
    return {
        "status": "pass" if all(item["pass"] for item in checks) else "fail",
        "checks": checks,
        "hard_failures": [item["id"] for item in checks if not item["pass"]],
    }


def build(calculation: dict[str, Any], normalized_input: dict[str, Any]) -> dict[str, Any]:
    pillars = calculation["pillars"]
    relations = _annotate_transformation_reviews(pillars, _pair_relations(pillars))
    inventory = _element_inventory(pillars)
    luck = []
    for cycle in calculation["luck_cycles"]["cycles"]:
        luck.append({**cycle, **_transit_relations(f"luck-{cycle['sequence']}", cycle["ganzhi"], pillars)})
    annual = []
    for item in calculation["annual_cycles"]:
        annual.append({**item, **_transit_relations(f"annual-{item['year']}", item["ganzhi"], pillars)})
    annual_coverage = {
        "start_year": annual[0]["year"] if annual else None,
        "end_year": annual[-1]["year"] if annual else None,
        "count": len(annual),
        "requested_through": normalized_input.get("options", {}).get("annual_cycles_through"),
        "complete_for_requested_range": bool(annual) and annual[-1]["year"] == normalized_input.get("options", {}).get("annual_cycles_through"),
    }
    # 每条关系都要能按自身指针解析；跨流年/大运重复出现的同一组合，
    # evidence_id 只由地支值构成会撞车，所以这里显式检测冲突。
    _evidence_index: dict[str, str] = {}
    relation_arrays = [("natal_relations", relations)]
    for position, cycle in enumerate(luck or []):
        relation_arrays.append((f"luck_cycles/{position}/relations_to_natal",
                                cycle.get("relations_to_natal") or []))
    for position, cycle in enumerate(annual or []):
        relation_arrays.append((f"annual_cycles/{position}/relations_to_natal",
                                cycle.get("relations_to_natal") or []))
    for array_name, items in relation_arrays:
        for index, relation in enumerate(items):
            pointer = f"/{array_name}/{index}"
            relation["json_pointer"] = pointer
            evidence_id = relation.get("evidence_id")
            if not evidence_id:
                raise ValueError(f"{pointer} 的关系缺少 evidence_id")
            if evidence_id in _evidence_index:
                raise ValueError(
                    f"evidence_id 冲突：{evidence_id} 同时出现在 "
                    f"{_evidence_index[evidence_id]} 与 {pointer}"
                )
            _evidence_index[evidence_id] = pointer

    auxiliary_chart = build_auxiliary_chart(pillars)
    # 神煞：命中完全由引擎决定，这里只做格式改造（22 条，见规则登记）
    auxiliary_chart["shensha"] = build_shensha(calculation)
    # 通根 / 透干清单：让「身强于此、通根几点」这类判断可逐项追溯
    auxiliary_chart["stem_root_audit"] = build_stem_root_audit(pillars)
    # 岁运相互作用：只看可判定的两项（岁运并临、天克地冲）。
    # 大运无精确起止，结果状态为 ambiguous 并附原因——不冒充精确边界拆分。
    # 出生年从标准化输入里取；calculation 里没有 solar_text。
    # 出生年必须用**校正后的公历日期**：原始输入可能是农历，
    # 或经真太阳时校正后跨年。calculation 里的 solar 日期优先。
    birth_date_text = str(calculation.get("solar_date") or "")
    if not (len(birth_date_text) >= 4 and birth_date_text[:4].isdigit()):
        birth_date_text = str(
            ((normalized_input or {}).get("profile") or {}).get("date") or ""
        )
    birth_year = None
    if len(birth_date_text) >= 4 and birth_date_text[:4].isdigit():
        birth_year = int(birth_date_text[:4])
    cycle_interactions = build_cycle_interactions(luck, annual, birth_year)

    # 起运前逐年小运：不替换 luck_cycles 里的「起运前」条目，独立成字段
    xiaoyun_years = build_xiaoyun_years(
        hour_ganzhi=(pillars.get("hour") or {}).get("ganzhi"),
        year_stem=(pillars.get("year") or {}).get("stem"),
        sex=calculation.get("sex_for_calculation"),
        birth_at=_birth_datetime(normalized_input),
        first_luck_at=_first_luck_datetime(normalized_input, calculation),
    )

    structural_facts = {
        "auxiliary_chart": auxiliary_chart,
        "natal_relations": relations,
        "element_inventory": inventory,
    }
    derived_rules = build_derived_rules(calculation, structural_facts)
    validation = _validate(
        pillars, relations, inventory, derived_rules,
        auxiliary_chart=auxiliary_chart, cycle_interactions=cycle_interactions,
        calculation=calculation,
        annual_cycles=annual, luck_cycles=luck,
    )
    fingerprint_source = json.dumps(
        {"input": normalized_input, "pillars": pillars, "relations": relations,
         "inventory": inventory, "auxiliary": auxiliary_chart,
         "cycle_interactions": cycle_interactions,
         "xiaoyun_years": xiaoyun_years,
         "derived_rules": derived_rules, "luck": luck, "annual": annual},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "fingerprint": f"bz1-{_fnv1a(fingerprint_source)}",
        "readiness": {
            "level": "structural-and-derived-rule-candidates",
            "ai_may_interpret": validation["status"] == "pass",
            "supported_scopes": [
                "pillars", "stem-branch-properties", "ten-gods", "hidden-stems", "twelve-life-stages",
                "natal-relations", "element-inventory", "strength-candidate", "follow-pattern-candidate",
                "dominant-pattern-candidate",
                "pattern-candidates", "balance-useful-elements", "pattern-useful-elements",
                "full-qiongtong-120-cell-climate-candidate", "useful-element-conflicts",
                "combination-transformation-condition-audit", "luck-cycle-relations", "annual-relations",
                "annual-cycle-coverage",
                # 只有对应字段**全部可用**时才声明支持；
                # 缺时柱时业务上仍能解读，但"时柱纳音"这一项确实不可用，
                # 不能在 scopes 里笼统声明支持。
                *(
                    ["auxiliary-nayin"]
                    if all(
                        (auxiliary_chart.get("nayin") or {}).get(name, {}).get("status")
                        == "validated"
                        for name in ("year", "month", "day", "hour")
                    )
                    else []
                ),
                *(
                    ["auxiliary-xunkong"]
                    if all(
                        (auxiliary_chart.get("xunkong") or {}).get(name, {}).get("status")
                        == "validated"
                        for name in ("year", "month", "day", "hour")
                    )
                    else []
                ),
                *(
                    ["auxiliary-taiyuan"]
                    if (auxiliary_chart.get("taiyuan") or {}).get("status") == "validated"
                    else []
                ),
                *(
                    ["auxiliary-shensha"]
                    if (auxiliary_chart.get("shensha") or {}).get("status") == "validated"
                    else []
                ),
            ],
            "unsupported_scopes": [
                "school-agnostic-definitive-strength", "school-agnostic-definitive-combination-transformation",
                "definitive-single-useful-god", "monthly-timing", "bingyao-useful-god", "tongguan-useful-god",
            ],
        },
        "auxiliary_chart": auxiliary_chart,
        "cycle_interactions": cycle_interactions,
        "xiaoyun_years": xiaoyun_years,
        "natal_relations": relations,
        "evidence_index": _evidence_index,
        "element_inventory": inventory,
        "derived_rules": derived_rules,
        "luck_cycles": luck,
        "annual_cycles": annual,
        "annual_cycle_coverage": annual_coverage,
        "validation": validation,
    }

