"""AI 能否解读的**最低线**断言。

这套测试的判据不是"证据索引是否完备"，而是"一个解读模型拿到这份包，
能不能讲出四柱格局、旺衰喜忌、大运流年、紫微十二宫"。

来历：2026-10-30 用真实命盘做了一次实战检验，发现两个复审十几轮都没提过的硬伤——
四柱天干十神全是 null、calculation 里性别是 None。两者的共同点是：
它们不影响任何"结构完整性"检查，却直接让解读缺了骨架。
所以这里把"解读必需项"逐条钉死。
"""

from __future__ import annotations

import unittest

from mingli_tool.bazi import calculate

PAYLOAD = {
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

PILLARS = ("year", "month", "day", "hour")


class BaziInterpretabilityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.response = calculate(PAYLOAD)
        cls.calculation = cls.response["calculation"]
        cls.facts = cls.response["ai_facts"]

    # ---------------- 四柱：解读的骨架 ----------------
    def test_sex_is_present(self):
        """性别决定大运顺逆与部分神煞，缺了就无法解读。"""
        self.assertIn(self.calculation.get("sex_for_calculation"), ("male", "female"))

    def test_every_pillar_has_stem_and_branch(self):
        for name in PILLARS:
            pillar = self.calculation["pillars"].get(name)
            self.assertIsNotNone(pillar, f"缺{name}柱")
            self.assertTrue(pillar.get("ganzhi"), f"{name}柱没有干支")

    def test_stem_ten_god_present_except_day_master(self):
        """除日主自身外，每一柱天干都必须有十神。

        这是那次实战检验抓到的硬伤：天干十神全是 null，
        解读时讲不出「比肩/劫财/食神」，骨架就塌了。
        """
        for name in PILLARS:
            pillar = self.calculation["pillars"][name]
            if name == "day":
                self.assertIsNone(
                    pillar.get("ten_god"),
                    "日主自身不该有十神",
                )
                continue
            self.assertIsNotNone(
                pillar.get("ten_god"),
                f"{name}柱天干缺少十神，解读无法进行",
            )

    def test_hidden_stems_carry_ten_god_and_weight(self):
        for name in PILLARS:
            hidden = self.calculation["pillars"][name].get("hidden_stems") or []
            self.assertTrue(hidden, f"{name}柱没有藏干")
            for item in hidden:
                self.assertTrue(item.get("ten_god"), "藏干缺少十神")
                self.assertIsNotNone(item.get("nominal_weight"), "藏干缺少权重")

    # ---------------- 旺衰 / 格局 / 用神 ----------------
    def test_derived_rules_have_all_four_axes(self):
        derived = self.facts.get("derived_rules") or {}
        for key in ("strength", "pattern", "useful_elements", "climate_adjustment"):
            self.assertIn(key, derived, f"derived_rules 缺 {key}")
        self.assertEqual(derived.get("validation", {}).get("status"), "pass")

    # ---------------- 大运 / 流年 ----------------
    def test_luck_cycles_have_ganzhi_and_ten_god(self):
        luck = self.facts.get("luck_cycles") or []
        self.assertGreaterEqual(len(luck), 5, "大运步数过少")
        real = [c for c in luck if c.get("sequence") != "起运前"]
        self.assertTrue(real, "没有可用的正式大运")
        for cycle in real:
            self.assertEqual(len(str(cycle.get("ganzhi") or "")), 2, "大运干支缺失")
            self.assertTrue(cycle.get("age_range"), "大运缺年龄区间")
            self.assertIsNotNone(cycle.get("ten_god"), "大运缺十神")

    def test_annual_cycles_cover_requested_year(self):
        annual = self.facts.get("annual_cycles") or []
        self.assertGreaterEqual(len(annual), 10, "流年数量过少")
        years = [item.get("year") for item in annual]
        self.assertIn(2026, years, "缺少目标年份的流年")
        for item in annual:
            self.assertEqual(len(str(item.get("ganzhi") or "")), 2, "流年干支缺失")

    # ---------------- 辅助盘 ----------------
    def test_auxiliary_chart_is_usable(self):
        aux = self.facts.get("auxiliary_chart") or {}
        for key in ("nayin", "taiyuan", "xunkong", "shensha"):
            self.assertIn(key, aux, f"辅助盘缺 {key}")
        for name in PILLARS:
            self.assertEqual(aux["nayin"][name]["status"], "validated", f"{name}柱纳音不可用")
        self.assertGreaterEqual(
            len((aux.get("shensha") or {}).get("value") or []),
            1,
            "神煞一条都没命中，解读会缺失这一层",
        )

    def test_cycle_interactions_never_fake_certainty(self):
        """岁运结论必须诚实：没有精确大运边界时只能是 ambiguous。"""
        ci = self.facts.get("cycle_interactions") or {}
        self.assertIn(ci.get("status"), ("validated", "ambiguous", "unavailable"))
        if ci.get("status") != "validated":
            self.assertTrue(ci.get("reason"), "非 validated 必须说明原因")

    # ---------------- 契约门槛 ----------------
    def test_fact_pack_is_open_for_interpretation(self):
        readiness = self.facts.get("readiness") or {}
        self.assertEqual(self.facts["validation"]["status"], "pass")
        self.assertTrue(readiness.get("ai_may_interpret"), "AI 解读被门禁挡住")
        supported = readiness.get("supported_scopes") or []
        for scope in ("pillars", "ten-gods", "hidden-stems", "luck-cycle-relations"):
            self.assertIn(scope, supported, f"缺少 {scope} 支持声明")


if __name__ == "__main__":
    unittest.main()
