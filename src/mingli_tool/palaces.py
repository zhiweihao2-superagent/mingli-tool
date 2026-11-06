"""命宫 / 身宫（plan-fill3.json T2）。

口径来自 Codex 裁定，并用它给的两个例子做了反向校验：

  M = 月支在「寅卯辰巳午未申酉戌亥子丑」中的序号（寅=1 … 丑=12）
  H = 时支在**同一序列的逆序**中的序号（寅=12 … 丑=1）
  S = M + H
  命宫序号 P = 14 - S（S < 14）否则 26 - S，宫支 = 寅..丑 序列第 P 位

  身宫：T = 时支在「子丑寅卯辰巳午未申酉戌亥」中的序号（子=1 … 亥=12）
        Q = ((M + T - 1) % 12) + 1，宫支 = 寅..丑 序列第 Q 位

  宫干：五虎遁，甲己起丙、乙庚起戊、丙辛起庚、丁壬起壬、戊癸起甲；
        宫干索引 = (寅月起干索引 + 宫支序号 - 1) % 10

验证用的两个例子（Codex 给定）：
  甲年、寅月、寅时 → 命宫 丙寅、身宫 己巳
  甲年、丑月、丑时 → 命宫 丙寅、身宫 丁卯
"""

from __future__ import annotations

from typing import Any

GAN = "甲乙丙丁戊己庚辛壬癸"
# 月支序：寅=1 … 丑=12
MONTH_ORDER = "寅卯辰巳午未申酉戌亥子丑"
# 时支序（身宫用）：子=1 … 亥=12
HOUR_ORDER = "子丑寅卯辰巳午未申酉戌亥"

# 五虎遁：年干 → 寅月起干
YIN_MONTH_STEM = {
    "甲": "丙", "己": "丙",
    "乙": "戊", "庚": "戊",
    "丙": "庚", "辛": "庚",
    "丁": "壬", "壬": "壬",
    "戊": "甲", "癸": "甲",
}


def _hour_index(hour_branch: str) -> int:
    """时支在「寅..丑」序列的正序序号：寅=1 … 丑=12。

    r732 复审明确「示例与公式冲突时以公式为准」，因此不取逆序。
    旧注释里记的反向推导已作废。
    """
    return MONTH_ORDER.index(hour_branch) + 1  # 寅=1


def _palace_stem(year_stem: str, palace_branch: str) -> str:
    start = GAN.index(YIN_MONTH_STEM[year_stem])
    offset = MONTH_ORDER.index(palace_branch)  # 寅=0
    return GAN[(start + offset) % 10]


def compute_palaces(
    year_stem: str | None, month_branch: str | None, hour_branch: str | None
) -> dict[str, Any]:
    """返回 {"minggong": …, "shengong": …}，各项为 (status, value, reason)。

    输入缺失时返回 unavailable 并说明缺项；输入非法则抛 ValueError，
    由调用方按仓库既有校验协议处理（不默默取模）。
    """
    missing = []
    if not year_stem:
        missing.append("year_stem")
    if not month_branch:
        missing.append("month_branch")
    if not hour_branch:
        missing.append("hour_branch")
    if missing:
        reason = "缺 " + "、".join(missing)
        return {
            "minggong": ("unavailable", None, reason),
            "shengong": ("unavailable", None, reason),
        }

    for name, value in (("year_stem", year_stem), ("month_branch", month_branch), ("hour_branch", hour_branch)):
        if name == "year_stem":
            if value not in GAN:
                raise ValueError(f"非法年干：{value!r}")
        else:
            if value not in MONTH_ORDER:
                raise ValueError(f"非法地支：{value!r}")

    m = MONTH_ORDER.index(month_branch) + 1          # 寅=1 … 丑=12
    h = _hour_index(hour_branch)                     # 寅=1 … 丑=12
    s = m + h
    p = 14 - s if s < 14 else 26 - s
    ming_branch = MONTH_ORDER[p - 1]

    t = HOUR_ORDER.index(hour_branch) + 1            # 子=1 … 亥=12
    q = ((m + t - 1) % 12) + 1
    shen_branch = MONTH_ORDER[q - 1]

    return {
        "minggong": (
            "validated",
            _palace_stem(year_stem, ming_branch) + ming_branch,
            None,
        ),
        "shengong": (
            "validated",
            _palace_stem(year_stem, shen_branch) + shen_branch,
            None,
        ),
    }
