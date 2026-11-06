"""端到端多命盘实跑：不崩、状态合理、关键字段非空。

覆盖容易出问题的输入形态：缺时辰、农历、闰月、跨年边界、31 日出生。
"""

import copy
import sys

sys.path.insert(0, "src")

from mingli_tool.bazi import calculate

BASE = {
    "schema_version": "1.0",
    "profile": {
        "display_name": None, "calendar": "solar", "date": "1990-05-15",
        "is_leap_month": False,
        "time": {"precision": "minute", "value": "12:30", "branch": None},
        "timezone": "Asia/Shanghai", "sex_for_calculation": "male",
        "birthplace": {"label": None, "longitude": None, "latitude": None},
    },
    "rules": {"profile_id": "engine-default-v1", "true_solar_time": False},
    "options": {"save_history": False, "annual_cycles_through": 2026},
}

CASES = [
    ("标准男命", {}),
    ("标准女命", {"profile": {"sex_for_calculation": "female"}}),
    ("时辰未知", {"profile": {"time": {"precision": "unknown", "value": None, "branch": None}}}),
    ("只知时辰", {"profile": {"time": {"precision": "branch", "branch": "子"}}}),
    ("早子时", {"profile": {"time": {"precision": "minute", "value": "00:10", "branch": None}}}),
    ("晚子时", {"profile": {"time": {"precision": "minute", "value": "23:30", "branch": None}}}),
    ("31 日出生", {"profile": {"date": "1990-01-31"}}),
    ("元旦出生", {"profile": {"date": "1990-01-01", "time": {"precision": "minute", "value": "00:00", "branch": None}}}),
    ("除夕出生", {"profile": {"date": "1990-12-31", "time": {"precision": "minute", "value": "23:59", "branch": None}}}),
    ("立春前", {"profile": {"date": "1990-02-03"}}),
    ("立春后", {"profile": {"date": "1990-02-05"}}),
    ("农历输入", {"profile": {"calendar": "lunar", "date": "1990-04-21"}}),
]

rows = []
for label, patch in CASES:
    payload = copy.deepcopy(BASE)
    for key, value in patch.items():
        if key == "profile":
            payload["profile"].update(value)
        else:
            payload[key] = value
    try:
        result = calculate(payload)
        facts = result["ai_facts"]
        calc = result["calculation"]
        aux = facts.get("auxiliary_chart") or {}
        xiaoyun = facts.get("xiaoyun_years") or {}
        luck = facts.get("luck_cycles") or []
        # 注意：pillars["hour"] 可能是 **None**（时辰未知），
        # 用 .get(n, {}) 拿到的是 None 而不是默认值，必须再 or {}。
        tens = [
            ((calc.get("pillars") or {}).get(n) or {}).get("ten_god")
            for n in ("year", "month", "hour")
        ]
        rows.append({
            "case": label,
            "validation": (facts.get("validation") or {}).get("status"),
            "pillars": " ".join(
                ((calc.get("pillars") or {}).get(n) or {}).get("ganzhi") or "缺"
                for n in ("year", "month", "day", "hour")
            ),
            "ten_gods": "" if all(tens) else "有缺",
            "luck": len([c for c in luck if c.get("ganzhi")]),
            "xiaoyun": xiaoyun.get("status"),
            "minggong": (aux.get("minggong") or {}).get("status"),
            "shensha": len((aux.get("shensha") or {}).get("value") or []),
        })
    except Exception as exc:  # noqa: BLE001
        rows.append({"case": label, "error": f"{type(exc).__name__}: {exc}"})

print(f"{'用例':<12}{'校验':<8}{'四柱':<24}{'十神':<6}{'大运':<5}{'小运':<12}{'命宫':<12}{'神煞'}")
for row in rows:
    if "error" in row:
        print(f"{row['case']:<12}ERROR {row['error']}")
        continue
    print(
        f"{row['case']:<12}{str(row['validation']):<8}{row['pillars']:<24}"
        f"{row['ten_gods'] or 'ok':<6}{row['luck']:<5}{str(row['xiaoyun']):<12}"
        f"{str(row['minggong']):<12}{row['shensha']}"
    )

failures = [row for row in rows if "error" in row or row.get("validation") != "pass"]
print()
print("失败用例:", failures if failures else "无")
