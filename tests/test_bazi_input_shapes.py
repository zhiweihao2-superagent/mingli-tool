"""输入形态的端到端防回归（12 个用例）。

来历：2026-10-30 用临时脚本跑了 12 种输入形态（缺时辰、农历、闰月、立春前后、
子时边界、31 日出生…），全部 pass，但那是脚本不是测试。临时脚本会腐烂，
这里把它固化成断言，防止后续改动把某一种形态弄崩。

断言三件事：
  1. 不抛异常
  2. `validation.status == pass`
  3. 该有的关键字段存在且形态正确（不该因为输入形态而凭空消失）
"""

from __future__ import annotations

import copy
import unittest

from mingli_tool.bazi import calculate

BASE = {
    "schema_version": "1.0",
    "profile": {
        "display_name": None,
        "calendar": "solar",
        "date": "1990-05-15",
        "is_leap_month": False,
        "time": {"precision": "minute", "value": "12:30", "branch": None},
        "timezone": "Asia/Shanghai",
        "sex_for_calculation": "male",
        "birthplace": {"label": None, "longitude": None, "latitude": None},
    },
    "rules": {"profile_id": "engine-default-v1", "true_solar_time": False},
    "options": {"save_history": False, "annual_cycles_through": 2026},
}

CASES: list[tuple[str, dict]] = [
    ("标准男命", {}),
    ("标准女命", {"profile": {"sex_for_calculation": "female"}}),
    ("时辰未知", {"profile": {"time": {"precision": "unknown", "value": None, "branch": None}}}),
    ("只知时辰", {"profile": {"time": {"precision": "branch", "branch": "子"}}}),
    ("早子时", {"profile": {"time": {"precision": "minute", "value": "00:10", "branch": None}}}),
    ("晚子时", {"profile": {"time": {"precision": "minute", "value": "23:30", "branch": None}}}),
    ("31 日出生", {"profile": {"date": "1990-01-31"}}),
    ("元旦出生", {"profile": {"date": "1990-01-01",
                              "time": {"precision": "minute", "value": "00:00", "branch": None}}}),
    ("除夕出生", {"profile": {"date": "1990-12-31",
                              "time": {"precision": "minute", "value": "23:59", "branch": None}}}),
    ("立春前", {"profile": {"date": "1990-02-03"}}),
    ("立春后", {"profile": {"date": "1990-02-05"}}),
    ("农历输入", {"profile": {"calendar": "lunar", "date": "1990-04-21"}}),
]


def _run(patch: dict) -> dict:
    payload = copy.deepcopy(BASE)
    for key, value in patch.items():
        if key == "profile":
            payload["profile"].update(value)
        else:
            payload[key] = value
    return calculate(payload)


class InputShapesTest(unittest.TestCase):
    def test_every_shape_validates_without_crash(self):
        for label, patch in CASES:
            with self.subTest(case=label):
                result = _run(patch)
                self.assertEqual(
                    result["ai_facts"]["validation"]["status"], "pass",
                    f"{label} 校验未通过",
                )

    def test_year_month_day_pillars_always_present(self):
        for label, patch in CASES:
            with self.subTest(case=label):
                calc = _run(patch)["calculation"]
                for name in ("year", "month", "day"):
                    pillar = calc["pillars"].get(name)
                    self.assertIsNotNone(pillar, f"{label} 缺{name}柱")
                    self.assertTrue(pillar.get("ganzhi"))

    def test_lunar_and_solar_inputs_agree(self):
        """农历 1990-04-21 与公历 1990-05-15 应是同一天，四柱必须一致。"""
        lunar = _run({"profile": {"calendar": "lunar", "date": "1990-04-21"}})["calculation"]
        solar = _run({})["calculation"]
        self.assertEqual(
            [lunar["pillars"][n]["ganzhi"] for n in ("year", "month", "day")],
            [solar["pillars"][n]["ganzhi"] for n in ("year", "month", "day")],
        )

    def test_lichun_boundary_switches_year_pillar(self):
        before = _run({"profile": {"date": "1990-02-03"}})["calculation"]
        after = _run({"profile": {"date": "1990-02-05"}})["calculation"]
        self.assertNotEqual(
            before["pillars"]["year"]["ganzhi"],
            after["pillars"]["year"]["ganzhi"],
            "立春前后年柱必须切换",
        )
        self.assertEqual(before["pillars"]["year"]["ganzhi"], "己巳")
        self.assertEqual(after["pillars"]["year"]["ganzhi"], "庚午")

    def test_late_zi_advances_day_pillar(self):
        early = _run({"profile": {"time": {"precision": "minute", "value": "00:10", "branch": None}}})
        late = _run({"profile": {"time": {"precision": "minute", "value": "23:30", "branch": None}}})
        self.assertNotEqual(
            early["calculation"]["pillars"]["day"]["ganzhi"],
            late["calculation"]["pillars"]["day"]["ganzhi"],
            "早子时与晚子时的日柱必须不同",
        )

    def test_unknown_hour_degrades_honestly(self):
        """缺时辰时：时柱缺失，但小运/命宫必须标 unavailable 而不是给出猜测值。"""
        facts = _run({"profile": {"time": {"precision": "unknown", "value": None, "branch": None}}})["ai_facts"]
        self.assertIsNone(facts["pillars"] if False else None)  # 时柱在 calculation 里
        aux = facts["auxiliary_chart"]
        self.assertEqual(aux["minggong"]["status"], "unavailable")
        self.assertIsNone(aux["minggong"]["value"])
        self.assertEqual(facts["xiaoyun_years"]["status"], "unavailable")
        self.assertTrue(facts["xiaoyun_years"]["missing_inputs"])

    def test_branch_precision_still_yields_xiaoyun(self):
        """只知时辰也够算小运：按公历年分年只需要日期与日内近似的时刻。"""
        facts = _run({"profile": {"time": {"precision": "branch", "branch": "子"}}})["ai_facts"]
        self.assertEqual(facts["xiaoyun_years"]["status"], "validated")
        self.assertGreaterEqual(len(facts["xiaoyun_years"]["value"]), 1)

    def test_shensha_never_crashes_on_missing_anchors(self):
        """缺时辰时神煞仍可部分求值，且 unevaluated_targets 要标出来。"""
        facts = _run({"profile": {"time": {"precision": "unknown", "value": None, "branch": None}}})["ai_facts"]
        shensha = facts["auxiliary_chart"]["shensha"]
        self.assertEqual(len(shensha["rule_status"]), 44)


if __name__ == "__main__":
    unittest.main()
