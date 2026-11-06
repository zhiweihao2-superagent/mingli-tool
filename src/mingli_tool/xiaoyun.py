"""起运前逐年小运（plan-fill3.json T3）。

口径来自 Codex 裁定：
  - 以**时柱**为基准，六十甲子索引（甲子=0）
  - 年干甲丙戊庚壬为阳，乙丁己辛癸为阴
  - 阳男阴女 direction=+1，阴男阳女 direction=-1
  - 第 n 虚岁（出生年为 1）干支索引 = (hour_index + direction*n) % 60，正模处理负数
  - 出生年区间 [出生时刻, 次年1月1日00:00)，其后按公历年切
  - 与 [出生时刻, 第一大运起运时刻) 求交，非空才输出

不替换 `luck_cycles[0]` 的「起运前」条目，也不与它合并成大运。
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

GAN = "甲乙丙丁戊己庚辛壬癸"
ZHI = "子丑寅卯辰巳午未申酉戌亥"
YANG_STEMS = set("甲丙戊庚壬")


def _jiazi_index(ganzhi: str) -> int:
    if not isinstance(ganzhi, str) or len(ganzhi) != 2:
        raise ValueError(f"非法干支：{ganzhi!r}")
    g, z = GAN.find(ganzhi[0]), ZHI.find(ganzhi[1])
    if g < 0 or z < 0:
        raise ValueError(f"非法干支：{ganzhi!r}")
    if g % 2 != z % 2:
        raise ValueError(f"干支不能相配：{ganzhi!r}")
    for n in range(60):
        if n % 10 == g and n % 12 == z:
            return n
    raise ValueError(f"干支不在六十甲子内：{ganzhi!r}")


def _ganzhi_at(index: int) -> str:
    index %= 60
    return GAN[index % 10] + ZHI[index % 12]


def build_xiaoyun_years(
    hour_ganzhi: str | None,
    year_stem: str | None,
    sex: str | None,
    birth_at: datetime | None,
    first_luck_at: datetime | None,
    boundary_precision: str | None = None,
) -> dict[str, Any]:
    """返回 {status, value, reason, missing_inputs, direction}。"""
    missing = []
    if not hour_ganzhi:
        missing.append("hour_ganzhi")
    if not year_stem:
        missing.append("year_stem")
    if not sex:
        missing.append("sex")
    if birth_at is None:
        missing.append("birth_at")
    if first_luck_at is None:
        missing.append("first_luck_at")
    if missing:
        return {
            "status": "unavailable",
            "value": None,
            "reason": "缺 " + "、".join(missing),
            "missing_inputs": missing,
            "direction": None,
            "rule_id": "xiaoyun.yearly",
            "rule_version": "1",
            "boundary": None,
            "evidence": [],
        }

    if sex not in ("male", "female"):
        raise ValueError(f"非法性别：{sex!r}")
    if year_stem not in GAN:
        raise ValueError(f"非法年干：{year_stem!r}")
    hour_index = _jiazi_index(hour_ganzhi)

    is_yang_year = year_stem in YANG_STEMS
    # 阳男阴女为顺，阴男阳女为逆
    same_parity = (is_yang_year and sex == "male") or (not is_yang_year and sex == "female")
    direction = 1 if same_parity else -1

    if first_luck_at < birth_at:
        raise ValueError("起运时刻早于出生时刻")

    years: list[dict[str, Any]] = []
    cursor = birth_at
    virtual_age = 1
    tzinfo = getattr(birth_at, "tzinfo", None)

    def _next_new_year(moment: datetime) -> datetime:
        """次年元旦；带上与出生时刻相同的时区，避免朴素/感知混比。"""
        if tzinfo is None:
            return datetime(moment.year + 1, 1, 1)
        return datetime(moment.year + 1, 1, 1, tzinfo=tzinfo)

    while cursor < first_luck_at:
        seg_end = _next_new_year(cursor)
        item_end = min(seg_end, first_luck_at)
        if item_end <= cursor:
            break
        # 起运恰在元旦：该年不输出
        if item_end == cursor:
            break
        years.append({
            "year": cursor.year,
            "virtual_age": virtual_age,
            "ganzhi": _ganzhi_at(hour_index + direction * virtual_age),
            "start_at": cursor.isoformat(),
            "end_at_exclusive": item_end.isoformat(),
            "direction": direction,
        })
        cursor = item_end
        virtual_age += 1

    return {
        "status": "validated",
        "value": years,
        "reason": None,
        "missing_inputs": [],
        "direction": direction,
        # 规则元数据：按版本可复算
        "rule_id": "xiaoyun.yearly",
        "rule_version": "1",
        # 起运时刻只精确到「年+月」，不是精确时刻——如实上报，不冒充确定
        "boundary": {
            "first_luck_precision": boundary_precision or "unknown",
            "first_luck_at": first_luck_at.isoformat(),
            "birth_at": birth_at.isoformat(),
            "basis": "birth + 起运年/月（无日内精确时刻）",
        },
        "evidence": [
            {"evidence_id": "xiaoyun.hour_ganzhi", "pointer_root": "calculation",
             "json_pointer": "/pillars/hour/ganzhi"},
            {"evidence_id": "xiaoyun.year_stem", "pointer_root": "calculation",
             "json_pointer": "/pillars/year/stem"},
        ],
    }
