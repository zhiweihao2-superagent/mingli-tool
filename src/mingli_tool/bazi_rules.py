"""Versioned, evidence-backed BaZi derived-rule candidates.

This module deliberately returns candidates and counter-evidence rather than
presenting school-dependent interpretation rules as calendrical facts.
"""

from __future__ import annotations

import json
from typing import Any


SCHEMA_VERSION = "bazi-derived-rules/v2"
PROFILE_ID = "ziping-month-command-audited-v2"
ELEMENTS = ("木", "火", "土", "金", "水")
STEM_ELEMENT = dict(zip("甲乙丙丁戊己庚辛壬癸", "木木火火土土金金水水", strict=True))
PILLARS = ("year", "month", "day", "hour")
PILLAR_LABELS = {"year": "年柱", "month": "月柱", "day": "日柱", "hour": "时柱"}
GENERATES = {"木": "火", "火": "土", "土": "金", "金": "水", "水": "木"}
CONTROLS = {"木": "土", "土": "水", "水": "火", "火": "金", "金": "木"}
BRANCH_MULTIPLIERS = {"year": 1.0, "month": 2.0, "day": 1.0, "hour": 1.0}
VISIBLE_STEM_POINTS = 1.0
STRONG_ABOVE = 0.55
WEAK_BELOW = 0.45
FOLLOW_BELOW = 0.20
DOMINANT_AT_LEAST = 0.80
LIFE_STAGE_ORDER = {
    "帝旺": 6, "临官": 5, "长生": 4, "冠带": 3, "沐浴": 2, "养": 1,
    "衰": 0, "胎": 0, "墓": -1, "病": -2, "死": -3, "绝": -4,
}

PATTERN_NAMES = {
    "正官": "正官格", "七杀": "七杀格", "正财": "正财格", "偏财": "偏财格",
    "正印": "正印格", "偏印": "偏印格", "食神": "食神格", "伤官": "伤官格",
    "比肩": "月劫格", "劫财": "月劫格",
}
YANG_STEMS = set("甲丙戊庚壬")

CLIMATE_BY_MONTH = {
    "寅": {"temperature": "余寒", "moisture": "渐润", "primary": ["火"], "secondary": ["水"], "reason": "初春先观察温度，再观察滋养是否充足"},
    "卯": {"temperature": "温和", "moisture": "偏润", "primary": ["火"], "secondary": ["水"], "reason": "仲春以生发是否顺畅为主要观察点"},
    "辰": {"temperature": "渐暖", "moisture": "湿土", "primary": ["火"], "secondary": ["木"], "reason": "辰月湿土，先观察温燥与疏通"},
    "巳": {"temperature": "偏热", "moisture": "渐燥", "primary": ["水"], "secondary": ["金"], "reason": "初夏先观察降温与润燥"},
    "午": {"temperature": "炎热", "moisture": "偏燥", "primary": ["水"], "secondary": ["金"], "reason": "盛夏以降温润燥为先"},
    "未": {"temperature": "暑热", "moisture": "燥土", "primary": ["水"], "secondary": ["金"], "reason": "未月暑土，先观察水润是否受阻"},
    "申": {"temperature": "转凉", "moisture": "偏燥", "primary": ["水"], "secondary": ["火"], "reason": "初秋先润燥，同时观察温度下降"},
    "酉": {"temperature": "偏凉", "moisture": "燥", "primary": ["水"], "secondary": ["火"], "reason": "仲秋先润燥，再观察寒暖"},
    "戌": {"temperature": "渐寒", "moisture": "燥土", "primary": ["水"], "secondary": ["火"], "reason": "戌月燥土，润燥与温度需要并看"},
    "亥": {"temperature": "寒", "moisture": "偏湿", "primary": ["火"], "secondary": ["木"], "reason": "初冬先观察温暖与寒湿流通"},
    "子": {"temperature": "严寒", "moisture": "水旺", "primary": ["火"], "secondary": ["木"], "reason": "仲冬以温暖为先，再看是否有生火条件"},
    "丑": {"temperature": "寒", "moisture": "寒湿土", "primary": ["火"], "secondary": ["木"], "reason": "丑月寒湿，先温暖再疏通"},
}

# 《穷通宝鉴》通行速查口径。首位为主用，其余为辅用；各刊本互有
# 出入，所以结果必须显示规则档案与来源，不能冒充跨门派唯一结论。
# Adapted under MIT from qilaidev/metaphysics-engine, commit
# 7631af8ddcd8bf2941fc00006c724c3b5de28fba.
TIAOHOU_STEMS = {
    "甲": {
        "寅": ["丙", "癸"], "卯": ["庚", "丙", "丁", "戊", "己"], "辰": ["庚", "丁", "壬"],
        "巳": ["癸", "丁", "庚"], "午": ["癸", "丁", "庚"], "未": ["癸", "丁", "庚"],
        "申": ["庚", "丁", "壬"], "酉": ["庚", "丁", "丙"], "戌": ["庚", "甲", "丁", "壬", "癸"],
        "亥": ["庚", "丁", "丙", "戊"], "子": ["丁", "庚", "丙"], "丑": ["丁", "庚", "丙"],
    },
    "乙": {
        "寅": ["丙", "癸"], "卯": ["丙", "癸"], "辰": ["癸", "丙", "戊"], "巳": ["癸"],
        "午": ["癸", "丙"], "未": ["癸", "丙"], "申": ["丙", "癸", "己"],
        "酉": ["癸", "丙", "丁"], "戌": ["癸", "辛"], "亥": ["丙", "戊"], "子": ["丙"], "丑": ["丙"],
    },
    "丙": {
        "寅": ["壬", "庚"], "卯": ["壬", "己"], "辰": ["壬", "甲"], "巳": ["壬", "庚", "癸"],
        "午": ["壬", "庚"], "未": ["壬", "庚"], "申": ["壬", "戊"], "酉": ["壬", "癸"],
        "戌": ["甲", "壬"], "亥": ["甲", "戊", "庚", "壬"], "子": ["壬", "戊", "己"], "丑": ["壬", "甲"],
    },
    "丁": {
        "寅": ["甲", "庚"], "卯": ["庚", "甲"], "辰": ["甲", "庚"], "巳": ["甲", "庚"],
        "午": ["壬", "庚", "癸"], "未": ["甲", "壬", "庚"], "申": ["甲", "庚", "丙", "戊"],
        "酉": ["甲", "庚", "丙", "戊"], "戌": ["甲", "庚", "戊"], "亥": ["甲", "庚"],
        "子": ["甲", "庚"], "丑": ["甲", "庚"],
    },
    "戊": {
        "寅": ["丙", "甲", "癸"], "卯": ["丙", "甲", "癸"], "辰": ["甲", "丙", "癸"],
        "巳": ["甲", "丙", "癸"], "午": ["壬", "甲", "丙"], "未": ["癸", "丙", "甲"],
        "申": ["丙", "癸", "甲"], "酉": ["丙", "癸"], "戌": ["甲", "丙", "癸"],
        "亥": ["甲", "丙"], "子": ["丙", "甲"], "丑": ["丙", "甲"],
    },
    "己": {
        "寅": ["丙", "庚", "甲"], "卯": ["甲", "癸", "丙"], "辰": ["丙", "癸", "甲"],
        "巳": ["癸", "丙"], "午": ["癸", "丙"], "未": ["癸", "丙"], "申": ["丙", "癸"],
        "酉": ["丙", "癸"], "戌": ["甲", "丙", "癸"], "亥": ["丙", "甲", "戊"],
        "子": ["丙", "甲", "戊"], "丑": ["丙", "甲", "戊"],
    },
    "庚": {
        "寅": ["丙", "甲", "戊", "壬"], "卯": ["丁", "甲", "庚", "丙"],
        "辰": ["甲", "丁", "壬", "癸"], "巳": ["壬", "戊", "丙", "丁"], "午": ["壬", "癸"],
        "未": ["丁", "甲"], "申": ["丁", "甲"], "酉": ["丁", "甲", "丙"], "戌": ["甲", "壬"],
        "亥": ["丁", "丙"], "子": ["丁", "甲", "丙"], "丑": ["丙", "丁", "甲"],
    },
    "辛": {
        "寅": ["己", "壬", "庚"], "卯": ["壬", "甲"], "辰": ["壬", "甲"],
        "巳": ["壬", "甲", "癸"], "午": ["壬", "己", "癸"], "未": ["壬", "庚", "甲"],
        "申": ["壬", "甲", "戊"], "酉": ["壬", "甲"], "戌": ["壬", "甲"], "亥": ["壬", "丙"],
        "子": ["丙", "戊", "壬", "甲"], "丑": ["丙", "壬", "戊", "己"],
    },
    "壬": {
        "寅": ["庚", "丙", "戊"], "卯": ["戊", "辛", "庚"], "辰": ["甲", "庚"],
        "巳": ["壬", "辛", "庚", "癸"], "午": ["癸", "庚", "辛"], "未": ["辛", "甲"],
        "申": ["戊", "丁"], "酉": ["甲", "庚"], "戌": ["甲", "丙"], "亥": ["戊", "丙", "庚"],
        "子": ["戊", "丙"], "丑": ["丙", "丁", "甲"],
    },
    "癸": {
        "寅": ["辛", "丙"], "卯": ["庚", "辛"], "辰": ["丙", "辛", "甲"], "巳": ["辛"],
        "午": ["庚", "辛", "壬", "癸"], "未": ["庚", "辛", "壬", "癸"], "申": ["丁"],
        "酉": ["辛", "丙"], "戌": ["辛", "甲", "壬", "癸"], "亥": ["庚", "辛", "戊", "丁"],
        "子": ["丙", "辛"], "丑": ["丙", "丁"],
    },
}


def _fnv1a(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    number = 0x811C9DC5
    for byte in text.encode("utf-8"):
        number ^= byte
        number = (number * 0x01000193) & 0xFFFFFFFF
    return f"{number:08x}"


def _normalize_ten_god(value: str | None) -> str | None:
    if not value:
        return None
    if "七杀" in value or "偏官" in value:
        return "七杀"
    if "偏印" in value or "枭" in value:
        return "偏印"
    for name in ("正官", "正财", "偏财", "正印", "食神", "伤官", "比肩", "劫财"):
        if name in value:
            return name
    return value


def _ten_god_group(value: str | None) -> str | None:
    value = _normalize_ten_god(value)
    if value in {"比肩", "劫财"}:
        return "companion"
    if value in {"正印", "偏印"}:
        return "resource"
    if value in {"食神", "伤官"}:
        return "output"
    if value in {"正财", "偏财"}:
        return "wealth"
    if value in {"正官", "七杀"}:
        return "officer"
    return None


def _element_roles(day_element: str) -> dict[str, str]:
    resource = next(element for element, produced in GENERATES.items() if produced == day_element)
    officer = next(element for element, controlled in CONTROLS.items() if controlled == day_element)
    return {
        "resource": resource,
        "companion": day_element,
        "output": GENERATES[day_element],
        "wealth": CONTROLS[day_element],
        "officer": officer,
    }


def _path(pillar: str, suffix: str = "") -> str:
    base = f"/systems/bazi/chart/pillars/{pillar}"
    return f"{base}/{suffix}" if suffix else base


def _evidence(label: str, pointer: str, value: Any, points: float | None = None) -> dict[str, Any]:
    result = {"label": label, "pointer": pointer, "value": value}
    if points is not None:
        result["points"] = round(points, 2)
    return result


def _clashed_pillars(relations: list[dict[str, Any]]) -> set[str]:
    return {
        participant
        for relation in relations if relation.get("kind") == "branch-six-clash"
        for participant in relation.get("participants", [])
        if participant in PILLARS
    }


def _strength(pillars: dict[str, Any], relations: list[dict[str, Any]]) -> dict[str, Any]:
    day_stem = pillars["day"]["stem"]
    day_element = pillars["day"]["stem_element"]
    support_groups = {"companion", "resource"}
    support_evidence: list[dict[str, Any]] = []
    opposing_evidence: list[dict[str, Any]] = []
    root_evidence: list[dict[str, Any]] = []
    support = opposing = 0.0

    for pillar_name in PILLARS:
        pillar = pillars.get(pillar_name)
        if not pillar:
            continue
        group = "companion" if pillar_name == "day" else _ten_god_group(pillar.get("ten_god"))
        if not group:
            continue
        item = _evidence(
            f"{PILLAR_LABELS[pillar_name]}天干{pillar['stem']}为"
            f"{'日主自身' if pillar_name == 'day' else _normalize_ten_god(pillar.get('ten_god'))}",
            _path(pillar_name, "stem"), pillar["stem"], VISIBLE_STEM_POINTS,
        )
        if group in support_groups:
            support += VISIBLE_STEM_POINTS
            support_evidence.append(item)
        else:
            opposing += VISIBLE_STEM_POINTS
            opposing_evidence.append(item)

    root_points = 0.0
    for pillar_name in PILLARS:
        pillar = pillars.get(pillar_name)
        if not pillar:
            continue
        hidden = pillar.get("hidden_stems") or []
        for index, stem in enumerate(hidden):
            group = _ten_god_group(stem.get("ten_god"))
            if not group:
                continue
            points = BRANCH_MULTIPLIERS[pillar_name] * float(stem.get("nominal_weight", 0))
            item = _evidence(
                f"{PILLAR_LABELS[pillar_name]}{pillar['branch']}藏{stem['stem']}（{stem['role']}）",
                _path(pillar_name, f"hidden_stems/{index}"), stem["stem"], points,
            )
            if group in support_groups:
                support += points
                support_evidence.append(item)
                root_points += points
                root_evidence.append(item)
            else:
                opposing += points
                opposing_evidence.append(item)

    total = support + opposing
    ratio = support / total if total else 0.5
    if ratio < WEAK_BELOW:
        band, conclusion = "weak", "身弱候选"
    elif ratio <= STRONG_ABOVE:
        band, conclusion = "balanced", "中和候选"
    else:
        band, conclusion = "strong", "身强候选"

    month_hidden = pillars["month"].get("hidden_stems") or []
    month_main = month_hidden[0] if month_hidden else None
    month_group = _ten_god_group(month_main.get("ten_god") if month_main else None)
    has_seasonal_command = bool(month_main and month_main.get("element") == day_element)
    visible_support = [
        item for item in support_evidence
        if "/stem" in item["pointer"]
        and "/hidden_stems/" not in item["pointer"]
        and item["pointer"] != _path("day", "stem")
    ]
    dominant_group_points = {group: 0.0 for group in ("output", "wealth", "officer")}
    for item in opposing_evidence:
        pointer = item["pointer"]
        if "/hidden_stems/" in pointer:
            parts = pointer.split("/")
            pillar = pillars[parts[5]]
            ten_god = pillar["hidden_stems"][int(parts[-1])]["ten_god"]
        else:
            pillar = pillars[pointer.split("/")[5]]
            ten_god = pillar["ten_god"]
        group = _ten_god_group(ten_god)
        if group in dominant_group_points:
            dominant_group_points[group] += item["points"]

    follow_candidate = None
    if ratio < FOLLOW_BELOW and root_points == 0 and not visible_support and month_group not in support_groups:
        dominant = max(dominant_group_points, key=dominant_group_points.get)
        follow_names = {"output": "从儿候选", "wealth": "从财候选", "officer": "从官杀候选"}
        follow_candidate = {
            "name": follow_names[dominant],
            "status": "strict-candidate",
            "supportingEvidence": ["同党占比低于两成", "四支全无印比藏根", "天干除日主外未见印比", "月令主气不属印比"],
            "counterEvidence": [],
            "dominantOpposingGroup": dominant,
            "policy": "从格只作为严格候选；若时辰未知或合化未决，不升级为确认结论。",
        }

    dominant_candidate = None
    if has_seasonal_command and ratio >= DOMINANT_AT_LEAST:
        dominant_names = {"木": "曲直格", "火": "炎上格", "土": "稼穑格", "金": "从革格", "水": "润下格"}
        dominant_candidate = {
            "name": dominant_names[day_element],
            "status": "strict-candidate",
            "supportingEvidence": ["月令本气与日主同五行", "印比同党占比不低于八成"],
            "counterEvidence": [],
            "dominantElement": day_element,
            "policy": "专旺只按得令且同党占比达到八成的硬条件输出候选；合化未决时不升级为确认结论。",
        }

    uncertainty = []
    if not pillars.get("hour"):
        uncertainty.append("出生时辰未知，少一柱会影响根气、透干与从格排除")
    if any(relation.get("kind") in {"stem-combine", "branch-three-harmony", "branch-three-meeting"} for relation in relations):
        uncertainty.append("命局存在合会；v1 保留原五行计分并把是否成化列为待复核项")
    confidence = "low" if not pillars.get("hour") else "medium" if abs(ratio - 0.5) < 0.10 or uncertainty else "high"
    month_stage = pillars["month"].get("day_master_life_stage")
    return {
        "status": "candidate",
        "conclusion": conclusion,
        "band": band,
        "supportRatio": round(ratio, 4),
        "supportPoints": round(support, 2),
        "opposingPoints": round(opposing, 2),
        # 逐项清单：让 supportPoints / opposingPoints **可复算**。
        # 只给总数时，消费者无法验证 5.0 是怎么来的，也无法判断某柱改了会影响多少。
        "items": {
            "support": support_evidence,
            "opposing": opposing_evidence,
        },
        "recompute": {
            "visibleStemPoints": VISIBLE_STEM_POINTS,
            "branchMultipliers": dict(BRANCH_MULTIPLIERS),
            "formula": "天干各计 visibleStemPoints；藏干计 branchMultipliers[柱] × nominal_weight",
            "thresholds": {"weakBelow": WEAK_BELOW, "strongAbove": STRONG_ABOVE},
        },
        "confidence": confidence,
        "threeFactors": {
            "command": {
                "status": "supported" if has_seasonal_command else "not-supported",
                "monthBranch": pillars["month"]["branch"],
                "mainQiTenGod": _normalize_ten_god(month_main.get("ten_god") if month_main else None),
                "dayMasterLifeStage": month_stage,
                "lifeStageOrder": LIFE_STAGE_ORDER.get(month_stage),
                "evidencePaths": [_path("month", "branch"), _path("month", "day_master_life_stage")],
            },
            "roots": {
                "status": "supported" if root_points > 0 else "absent",
                "effectivePoints": round(root_points, 2),
                "evidencePaths": [item["pointer"] for item in root_evidence],
            },
            "momentum": {
                "status": "supported" if visible_support else "not-supported",
                "visibleSupportCount": len(visible_support),
                "evidencePaths": [item["pointer"] for item in visible_support],
            },
        },
        "supportingEvidence": support_evidence,
        "opposingEvidence": opposing_evidence,
        "followCandidate": follow_candidate,
        "dominantCandidate": dominant_candidate,
        "uncertainty": uncertainty,
        "thresholds": {"strongAbove": STRONG_ABOVE, "weakBelow": WEAK_BELOW, "followBelow": FOLLOW_BELOW},
        "ruleNote": "四天干各计 1；各地支藏干归一为 1，月支藏干乘 2；满四柱总分为 9。同党（印比）>55% 为强、<45% 为弱，中间为中和。该阈值属于选定规则档案，不是跨门派统一标准。",
    }


def _visible_ten_gods(pillars: dict[str, Any]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for pillar_name in ("year", "month", "hour"):
        pillar = pillars.get(pillar_name)
        if not pillar:
            continue
        ten_god = _normalize_ten_god(pillar.get("ten_god"))
        if ten_god:
            result.setdefault(ten_god, []).append(_path(pillar_name, "stem"))
    return result


def _pattern(pillars: dict[str, Any]) -> dict[str, Any]:
    hidden = pillars["month"].get("hidden_stems") or []
    visible = _visible_ten_gods(pillars)
    day_stem = pillars["day"]["stem"]
    month_stage = pillars["month"].get("day_master_life_stage")
    candidates = []
    for index, stem in enumerate(hidden):
        ten_god = _normalize_ten_god(stem.get("ten_god"))
        if ten_god not in PATTERN_NAMES:
            continue
        is_transmitted = any(
            pillar and pillar.get("stem") == stem.get("stem")
            for name, pillar in pillars.items() if name != "day"
        )
        required = [
            _evidence(
                f"月令{pillars['month']['branch']}藏{stem['stem']}为{ten_god}",
                _path("month", f"hidden_stems/{index}"), stem["stem"],
            )
        ]
        bonus = []
        breaking = []
        if is_transmitted:
            transmit_path = next(
                _path(name, "stem") for name, pillar in pillars.items()
                if name != "day" and pillar and pillar.get("stem") == stem.get("stem")
            )
            bonus.append(_evidence(f"{stem['stem']}透出天干", transmit_path, stem["stem"]))
        if ten_god == "正官" and "伤官" in visible:
            breaking.append(_evidence("伤官透干，对正官格构成破格因素", visible["伤官"][0], "伤官"))
        elif ten_god == "七杀":
            if "食神" in visible:
                bonus.append(_evidence("食神透干，形成制杀候选", visible["食神"][0], "食神"))
            elif "正印" in visible or "偏印" in visible:
                key = "正印" if "正印" in visible else "偏印"
                bonus.append(_evidence("印星透干，形成化杀候选", visible[key][0], key))
            else:
                breaking.append(_evidence("未见食神制杀或印星化杀的透干证据", _path("month"), "制化未见"))
        elif ten_god in {"正财", "偏财"} and ("比肩" in visible or "劫财" in visible):
            key = "劫财" if "劫财" in visible else "比肩"
            breaking.append(_evidence("比劫透干，构成争财候选", visible[key][0], key))
        elif ten_god in {"正印", "偏印"} and ("正财" in visible or "偏财" in visible):
            key = "正财" if "正财" in visible else "偏财"
            breaking.append(_evidence("财星透干，构成财克印候选", visible[key][0], key))
        elif ten_god == "食神" and "偏印" in visible:
            breaking.append(_evidence("偏印透干，构成枭印夺食候选", visible["偏印"][0], "偏印"))
        elif ten_god == "伤官" and "正官" in visible:
            breaking.append(_evidence("正官透干，构成伤官见官候选", visible["正官"][0], "正官"))

        special_name = None
        special_basis = None
        if index == 0 and month_stage == "临官":
            special_name, special_basis = "建禄格", "月支为日主临官禄地"
        elif index == 0 and day_stem in YANG_STEMS and month_stage == "帝旺":
            special_name, special_basis = "羊刃格", "阳干月支为日主帝旺刃地"
        elif index == 0 and ten_god == "劫财" and day_stem not in YANG_STEMS:
            special_name, special_basis = "月劫格", "阴干不立羊刃，月令本气劫财取月劫"

        if special_name:
            priority = 0
        elif index == 0 and is_transmitted:
            priority = 1
        elif is_transmitted:
            priority = 2
        elif index == 0:
            priority = 3
        else:
            priority = 4 + index
        status = "mixed" if breaking else "supported" if is_transmitted or ten_god in {"比肩", "劫财"} else "latent"
        candidates.append({
            "name": special_name or PATTERN_NAMES[ten_god], "tenGod": ten_god, "monthHiddenRole": stem.get("role"),
            "status": status, "priority": priority, "transmitted": is_transmitted,
            "requiredMatched": required, "bonusMatched": bonus, "breakingTriggered": breaking,
            "basis": special_basis or ("月令藏干透干优先" if is_transmitted else "藏干皆不透时取月令本气"),
            "source": "《子平真诠》月令取格工程口径；规则实现审计自 qilaidev/metaphysics-engine",
        })
    candidates.sort(key=lambda item: item["priority"])
    return {
        "status": "candidate-list",
        "primaryCandidate": candidates[0]["name"] if candidates else None,
        "candidates": candidates,
        "policy": "格局来自月令藏干与透干的候选排序；破格与救应逐项保留，不以格名直接推断现实结果。",
    }


def _climate(pillars: dict[str, Any]) -> dict[str, Any]:
    day_stem = pillars["day"]["stem"]
    month_branch = pillars["month"]["branch"]
    baseline = CLIMATE_BY_MONTH[month_branch]
    requested_stems = TIAOHOU_STEMS[day_stem][month_branch]
    visible_stems = {pillar["stem"] for pillar in pillars.values() if pillar}
    hidden_stems = {
        stem["stem"]
        for pillar in pillars.values() if pillar
        for stem in (pillar.get("hidden_stems") or [])
    }
    status = [
        {
            "stem": stem,
            "element": STEM_ELEMENT[stem],
            "role": "primary" if index == 0 else "secondary",
            "revealed": stem in visible_stems,
            "hidden": stem in hidden_stems,
        }
        for index, stem in enumerate(requested_stems)
    ]
    return {
        "status": "full-table-candidate",
        "temperature": baseline["temperature"], "moisture": baseline["moisture"],
        "primaryElements": [STEM_ELEMENT[requested_stems[0]]],
        "secondaryElements": list(dict.fromkeys(STEM_ELEMENT[stem] for stem in requested_stems[1:])),
        "primaryStems": requested_stems[:1], "secondaryStems": requested_stems[1:],
        "presentRequestedStems": [item["stem"] for item in status if item["revealed"]],
        "requestedStemStatus": status,
        "reason": baseline["reason"],
        "reference": "《穷通宝鉴》通行速查表（十日干×十二月支；各刊本互有出入）",
        "ruleSource": {
            "repository": "qilaidev/metaphysics-engine",
            "commit": "7631af8ddcd8bf2941fc00006c724c3b5de28fba",
            "license": "MIT",
            "path": "backend/constants/geju.js",
        },
        "evidencePaths": [_path("day", "stem"), _path("month", "branch")],
        "boundary": "调候与扶抑、格局并列，不替代综合取用；此表是通行简表而非唯一刊本或经典逐字原文。",
    }


def _useful_elements(pillars: dict[str, Any], strength: dict[str, Any], pattern: dict[str, Any], climate: dict[str, Any]) -> dict[str, Any]:
    day_element = pillars["day"]["stem_element"]
    roles = _element_roles(day_element)
    band = strength["band"]
    if strength.get("followCandidate"):
        dominant = strength["followCandidate"]["dominantOpposingGroup"]
        balance = {
            "status": "conflict-pending-follow-review", "primaryElements": [roles[dominant]],
            "secondaryElements": [], "avoidElements": [roles["resource"], roles["companion"]],
            "reason": "出现从格严格候选；扶抑取法与顺势取法方向相反，暂不合并为单一用神。",
        }
    elif strength.get("dominantCandidate"):
        balance = {
            "status": "dominant-pattern-candidate",
            "primaryElements": [roles["resource"], roles["companion"], roles["output"]],
            "secondaryElements": [],
            "avoidElements": [roles["wealth"], roles["officer"]],
            "reason": "出现专旺格严格候选，顺其气势取印比扶势、食伤泄秀，避免财官逆势。",
        }
    elif band in {"weak", "extremely-weak"}:
        balance = {
            "status": "candidate", "primaryElements": [roles["resource"]],
            "secondaryElements": [roles["companion"]],
            "avoidElements": [roles["officer"], roles["wealth"], roles["output"]],
            "reason": "规则档案判为偏弱，先取生扶，再取同类。",
        }
    elif band in {"strong", "extremely-strong"}:
        balance = {
            "status": "candidate", "primaryElements": [roles["output"]],
            "secondaryElements": [roles["wealth"], roles["officer"]],
            "avoidElements": [roles["resource"], roles["companion"]],
            "reason": "规则档案判为偏强，先取泄秀，再观察财与官杀是否能承接。",
        }
    else:
        balance = {
            "status": "circulation-review", "primaryElements": [], "secondaryElements": [], "avoidElements": [],
            "reason": "强弱接近中和，不按扶弱抑强机械指定单一五行，转入流通与格局检查。",
        }

    primary_pattern = pattern["candidates"][0] if pattern["candidates"] else None
    pattern_support = {"status": "unavailable", "coreElement": None, "supportingElements": [], "avoidElements": []}
    if primary_pattern:
        group = _ten_god_group(primary_pattern["tenGod"])
        core = roles.get(group)
        support_map = {
            "officer": [roles["resource"]], "wealth": [roles["officer"]],
            "resource": [roles["officer"]], "output": [roles["wealth"]],
            "companion": [roles["output"]],
        }
        avoid_map = {
            "officer": [roles["output"]], "wealth": [roles["companion"]],
            "resource": [roles["wealth"]], "output": [roles["resource"]],
            "companion": [roles["resource"]],
        }
        pattern_support = {
            "status": "candidate", "pattern": primary_pattern["name"], "coreElement": core,
            "supportingElements": support_map.get(group, []), "avoidElements": avoid_map.get(group, []),
            "reason": "格局取法与扶抑取法分开保存；破格条件优先于泛化吉凶。",
        }

    climate_primary = climate.get("primaryElements", [])
    axes = {
        "balance": balance,
        "pattern": pattern_support,
        "climate": {
            "status": climate["status"], "primaryElements": climate_primary,
            "secondaryElements": climate.get("secondaryElements", []),
            "primaryStems": climate.get("primaryStems", []), "secondaryStems": climate.get("secondaryStems", []),
        },
    }
    positive_lists = [
        balance.get("primaryElements", []) + balance.get("secondaryElements", []),
        ([pattern_support["coreElement"]] if pattern_support.get("coreElement") else []) + pattern_support.get("supportingElements", []),
        climate_primary + climate.get("secondaryElements", []),
    ]
    repeated = [element for element in ELEMENTS if sum(element in values for values in positive_lists) >= 2]
    conflicts = []
    for element in ELEMENTS:
        favored_by = [name for name, axis in axes.items() if element in axis.get("primaryElements", []) + axis.get("secondaryElements", []) + ([axis.get("coreElement")] if axis.get("coreElement") else []) + axis.get("supportingElements", [])]
        avoided_by = [name for name, axis in axes.items() if element in axis.get("avoidElements", [])]
        if favored_by and avoided_by:
            conflicts.append({"element": element, "favoredBy": favored_by, "avoidedBy": avoided_by})
    conflict_elements = {item["element"] for item in conflicts}
    consensus = [element for element in repeated if element not in conflict_elements]
    priority_sources = [
        ("climate", climate_primary + climate.get("secondaryElements", [])),
        ("pattern", ([pattern_support["coreElement"]] if pattern_support.get("coreElement") else []) + pattern_support.get("supportingElements", [])),
        ("balance", balance.get("primaryElements", []) + balance.get("secondaryElements", [])),
    ]
    contextual = []
    for axis, values in priority_sources:
        for element in values:
            if element and element not in consensus and element not in conflict_elements and not any(item["element"] == element for item in contextual):
                contextual.append({"element": element, "axis": axis})
    selected = consensus[:]
    selection_basis = "cross-axis-consensus"
    if not selected and contextual:
        selected = [contextual[0]["element"]]
        selection_basis = f"profile-priority-{contextual[0]['axis']}"
    resolution = {
        "profile": "conservative-three-axis-consensus-v1",
        "status": "consensus" if consensus else "context-candidate" if selected else "conflict-unresolved",
        "selectedCandidateElements": selected,
        "selectionBasis": selection_basis if selected else "no-unconflicted-candidate",
        "crossAxisConsensusElements": consensus,
        "contextualCandidatesByPriority": contextual,
        "excludedConflictElements": [item["element"] for item in conflicts],
        "axisPriorityWhenNoConsensus": ["climate", "pattern", "balance"],
        "policy": "两轴以上同取且没有反向意见时列为跨轴共识；没有共识时，按调候、格局、扶抑顺序只给情境候选；冲突五行不进入选择结果。",
    }
    return {
        "status": "multi-axis-candidates",
        "axes": axes,
        "repeatedFavorableElements": repeated,
        "conflicts": conflicts,
        "resolution": resolution,
        "policy": "不把扶抑、格局、调候三种取法压成一个神秘的单一答案；重复项与冲突项分别展示。",
    }


def build(calculation: dict[str, Any], structural_facts: dict[str, Any]) -> dict[str, Any]:
    pillars = calculation["pillars"]
    relations = structural_facts["natal_relations"]
    strength = _strength(pillars, relations)
    pattern = _pattern(pillars)
    climate = _climate(pillars)
    useful = _useful_elements(pillars, strength, pattern, climate)
    checks = [
        {"id": "strength_has_evidence", "pass": bool(strength["supportingEvidence"] or strength["opposingEvidence"])},
        {"id": "strength_ratio_bounded", "pass": 0 <= strength["supportRatio"] <= 1},
        {"id": "pattern_candidates_bound_to_month", "pass": all(item["requiredMatched"] for item in pattern["candidates"])},
        {"id": "useful_elements_split_by_axis", "pass": set(useful["axes"]) == {"balance", "pattern", "climate"}},
        {"id": "useful_elements_resolution_recorded", "pass": bool(useful.get("resolution", {}).get("profile"))},
        {"id": "climate_boundary_declared", "pass": bool(climate.get("boundary"))},
    ]
    result = {
        "schema_version": SCHEMA_VERSION,
        "rule_profile": {
            "id": PROFILE_ID,
            "school": "子平月令取格 + 扶抑量化 + 穷通调候速查的透明工程口径",
            "source": {
                "repository": "qilaidev/metaphysics-engine",
                "commit": "7631af8ddcd8bf2941fc00006c724c3b5de28fba",
                "license": "MIT",
                "adaptedFiles": [
                    "backend/constants/rulings.js",
                    "backend/constants/geju.js",
                    "backend/services/bazi.service.js",
                ],
            },
            "monthBranchMultiplier": BRANCH_MULTIPLIERS["month"],
            "otherBranchMultipliers": {key: value for key, value in BRANCH_MULTIPLIERS.items() if key != "month"},
            "visibleStemPoints": VISIBLE_STEM_POINTS,
            "strengthThresholds": {"strongAbove": STRONG_ABOVE, "weakBelow": WEAK_BELOW},
            "specialPatternThresholds": {"followBelow": FOLLOW_BELOW, "dominantAtLeast": DOMINANT_AT_LEAST},
            "boundaries": [
                "分数只在本档案内部比较，不宣称跨门派唯一正确",
                "从格与专旺格只输出严格候选",
                "合化在 v2 不自动改写五行",
                "调候采用完整十日干×十二月支通行速查表，但不冒充唯一刊本或经典逐字原文",
            ],
        },
        "strength": strength,
        "pattern": pattern,
        "climate_adjustment": climate,
        "useful_elements": useful,
        "validation": {
            "status": "pass" if all(check["pass"] for check in checks) else "fail",
            "checks": checks,
            "hard_failures": [check["id"] for check in checks if not check["pass"]],
        },
    }
    result["fingerprint"] = f"bzdr1-{_fnv1a(result)}"
    return result

