"""岁运相互作用（plan-ai-complete.json T5）。

只做**可判定**的两项，其余留给既有关系表：
  - 岁运并临：大运干支与流年干支完全相同
  - 天克地冲：天干相克**且**地支相冲

边界诚实性：大运数据只给 ``age_range``（如 ``7-16岁``），没有精确起止时刻。
所以这里只做**按年龄区间的近似匹配**，并把每条结果的 ``status`` 标为
``ambiguous``、附 ``reason`` 说明这是近似——不用中点冒充全年大运，
也不声称换运年已被精确拆分。要精确拆分需要大运的起止时刻，
那属于 ``bazi_months`` 的职责。
"""

from __future__ import annotations

from typing import Any

GAN = "甲乙丙丁戊己庚辛壬癸"
ZHI = "子丑寅卯辰巳午未申酉戌亥"
GAN_WUXING = {
    "甲": "木", "乙": "木", "丙": "火", "丁": "火", "戊": "土",
    "己": "土", "庚": "金", "辛": "金", "壬": "水", "癸": "水",
}
# 五行相克：木克土、土克水、水克火、火克金、金克木
KE = {"木": "土", "土": "水", "水": "火", "火": "金", "金": "木"}
# 地支六冲
CHONG = {
    frozenset(pair)
    for pair in ("子午", "丑未", "寅申", "卯酉", "辰戌", "巳亥")
}


def _stem_ke(left: str, right: str) -> bool:
    a, b = GAN_WUXING.get(left), GAN_WUXING.get(right)
    if not a or not b:
        return False
    return KE.get(a) == b or KE.get(b) == a


def _branch_chong(left: str, right: str) -> bool:
    return frozenset((left, right)) in CHONG


def _age_span(age_range: str) -> tuple[int, int] | None:
    """``7-16岁`` -> (7, 16)；解析不出返回 None，不猜。"""
    if not isinstance(age_range, str):
        return None
    text = age_range.replace("岁", "")
    if "-" not in text:
        return None
    left, _, right = text.partition("-")
    if not (left.isdigit() and right.isdigit()):
        return None
    return int(left), int(right)


def build_cycle_interactions(
    luck_cycles: list[dict[str, Any]],
    annual_cycles: list[dict[str, Any]],
    birth_year: int | None,
) -> dict[str, Any]:
    """返回 {items, status, reason}。每条 item 带年份、双方干支与命中的标志。"""
    if not luck_cycles or not annual_cycles or birth_year is None:
        return {
            "status": "unavailable",
            "reason": "缺大运、流年或出生年，无法判定岁运关系",
            "items": [],
        }

    parsed = []
    for position, cycle in enumerate(luck_cycles):
        span = _age_span(cycle.get("age_range"))
        ganzhi = str(cycle.get("ganzhi") or "")
        # 起运前那条是「辛巳（小运）」，不是大运，跳过
        if span is None or len(ganzhi) < 2:
            continue
        parsed.append({
            "span": span,
            "ganzhi": ganzhi[:2],
            "sequence": cycle.get("sequence"),
            "sequence_index": cycle.get("sequence"),
            "position": position,
        })

    items: list[dict[str, Any]] = []
    for annual in annual_cycles:
        year = annual.get("year")
        ganzhi = str(annual.get("ganzhi") or "")
        if year is None or len(ganzhi) < 2:
            continue
        age = year - birth_year
        matching = [p for p in parsed if p["span"][0] <= age <= p["span"][1]]
        # 年龄是整数年：恰好等于某运的起点或终点时，该年**跨运**，
        # 相邻的大运也可能是这一年的另一半，必须一并列为候选。
        edge_positions = {id(p) for p in matching}
        for p in parsed:
            if id(p) in edge_positions:
                continue
            if age == p["span"][1] + 1 or age == p["span"][0] - 1:
                matching.append(p)
                edge_positions.add(id(p))
        # 年龄区间是整数年，换运年可能跨两条大运；候选全列出，不单选
        candidates = [
            {
                "luck_sequence": p["sequence"],
                "luck_ganzhi": p["ganzhi"],
                "age_range": f"{p['span'][0]}-{p['span'][1]}岁",
                "luck_pointer": f"/luck_cycles/{p['position']}",
            }
            for p in matching
        ]
        annual_position = annual_cycles.index(annual)
        for luck in matching:
            a_stem, a_branch = ganzhi[0], ganzhi[1]
            l_stem, l_branch = luck["ganzhi"][0], luck["ganzhi"][1]
            flags = []
            if a_stem == l_stem and a_branch == l_branch:
                flags.append("岁运并临")
            if _stem_ke(a_stem, l_stem) and _branch_chong(a_branch, l_branch):
                flags.append("天克地冲")
            if not flags:
                continue
            items.append({
                "year": year,
                "age": age,
                "annual_ganzhi": ganzhi,
                "annual_pointer": f"/annual_cycles/{annual_position}",
                "annual_pointer_root": "facts",
                "luck_ganzhi": luck["ganzhi"],
                "luck_sequence": luck["sequence"],
                "luck_pointer": f"/luck_cycles/{luck['position']}",
                "luck_pointer_root": "facts",
                # 同年可能同时落在两条大运的整数年龄区间内
                "candidates": candidates,
                "candidate_count": len(candidates),
                "flags": flags,
                "status": "ambiguous",
                "reason": (
                    "大运仅有年龄区间（无精确起止时刻），按年龄近似匹配；"
                    "换运年未做精确拆分"
                ),
            })

    if not parsed:
        # 一条大运都解析不出来（age_range 非法/缺失）时，
        # 不能声称"确定无命中"——那是把缺输入当成否定结论。
        return {
            "status": "unavailable",
            "reason": "没有可解析起止区间的大运，无法判定岁运关系",
            "items": [],
        }
    if not items:
        return {
            "status": "ambiguous",
            "reason": (
                "按年龄区间近似匹配未命中；大运无精确起止，"
                "换运边界附近的候选无法排除"
            ),
            "items": [],
        }
    return {
        "status": "ambiguous",
        "reason": "全部条目按年龄区间近似匹配，非精确边界拆分",
        "items": items,
    }
