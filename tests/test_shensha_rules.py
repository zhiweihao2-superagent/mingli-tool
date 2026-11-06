"""新增 18 条神煞的成对断言（plan-fill3.json T4 / T6）。

每条至少一个**命中**用例和一个**不命中**用例：只测命中证明不了规则真的在筛，
因为"永远返回命中"也能过。反例是这条规则的区分力所在。

构造方法：显式控制四柱干支，使目标支**在命中用例里出现、在反例里完全不出现**。
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import pai_pan  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def names(year, month, day, hour=("乙", "辰"), sex="male"):
    """四柱以 (干, 支) 传入；时辰可省。"""
    lines, _records = pai_pan.compute_shensha(
        year[0], year[1], month[0], month[1], day[0], day[1],
        hour[0] if hour else None, hour[1] if hour else None, sex,
    )
    return {line[2:].split(" — ")[0] for line in lines if line.startswith("- ")}


class P1RulesTest(unittest.TestCase):
    def test_taiji(self):
        # 甲日干 → 子午
        self.assertIn("太极贵人", names(("丙", "子"), ("戊", "卯"), ("甲", "寅")))
        # 四支取 卯巳辰亥，不含子午
        self.assertNotIn("太极贵人", names(("丙", "卯"), ("戊", "巳"), ("甲", "辰"), ("乙", "亥")))

    def test_fuxing(self):
        # 甲日干 → 子寅
        self.assertIn("福星贵人", names(("丙", "子"), ("戊", "卯"), ("甲", "寅")))
        # 四支取 卯巳辰亥，不含子寅
        self.assertNotIn("福星贵人", names(("丙", "卯"), ("戊", "巳"), ("甲", "辰"), ("乙", "亥")))

    def test_hongluan(self):
        # 年支子(0) → 红鸾 卯
        self.assertIn("红鸾", names(("丙", "子"), ("戊", "卯"), ("甲", "辰"), ("乙", "巳")))
        self.assertNotIn("红鸾", names(("丙", "子"), ("戊", "巳"), ("甲", "辰"), ("乙", "亥")))

    def test_tianxi(self):
        # 年支子(0) → 天喜 酉
        self.assertIn("天喜", names(("丙", "子"), ("戊", "酉"), ("甲", "辰"), ("乙", "巳")))
        self.assertNotIn("天喜", names(("丙", "子"), ("戊", "巳"), ("甲", "辰"), ("乙", "亥")))

    def test_hongyan(self):
        # 甲日干 → 午
        self.assertIn("红艳", names(("丙", "午"), ("戊", "巳"), ("甲", "辰"), ("乙", "亥")))
        self.assertNotIn("红艳", names(("丙", "卯"), ("戊", "巳"), ("甲", "辰"), ("乙", "亥")))

    def test_yinyang_chacuo(self):
        self.assertIn("阴阳差错", names(("丙", "卯"), ("戊", "巳"), ("丙", "子"), ("乙", "亥")))
        self.assertNotIn("阴阳差错", names(("丙", "卯"), ("戊", "巳"), ("甲", "辰"), ("乙", "亥")))

    def test_kuigang(self):
        self.assertIn("魁罡", names(("丙", "卯"), ("戊", "巳"), ("庚", "辰"), ("乙", "亥")))
        self.assertNotIn("魁罡", names(("丙", "卯"), ("戊", "巳"), ("甲", "辰"), ("乙", "亥")))


class P2RulesTest(unittest.TestCase):
    def test_liuxia(self):
        # 甲日干 → 酉
        self.assertIn("流霞", names(("丙", "酉"), ("戊", "巳"), ("甲", "辰"), ("乙", "亥")))
        self.assertNotIn("流霞", names(("丙", "卯"), ("戊", "巳"), ("甲", "辰"), ("乙", "亥")))

    def test_suisha(self):
        # 年支申（申子辰组）→ 未
        self.assertIn("岁煞", names(("丙", "申"), ("戊", "未"), ("甲", "辰"), ("乙", "亥")))
        self.assertNotIn("岁煞", names(("丙", "申"), ("戊", "巳"), ("甲", "辰"), ("乙", "亥")))

    def test_xiaohao_goushen_jiaosha(self):
        # 年支子(0)：小耗=辰，勾神=卯，绞煞=戌
        self.assertIn("小耗", names(("丙", "子"), ("戊", "辰"), ("甲", "巳"), ("乙", "亥")))
        self.assertIn("勾神", names(("丙", "子"), ("戊", "卯"), ("甲", "巳"), ("乙", "亥")))
        self.assertIn("绞煞", names(("丙", "子"), ("戊", "戌"), ("甲", "巳"), ("乙", "亥")))
        miss = names(("丙", "子"), ("戊", "巳"), ("甲", "寅"), ("乙", "亥"))
        self.assertNotIn("小耗", miss)
        self.assertNotIn("勾神", miss)
        self.assertNotIn("绞煞", miss)

    def test_shie_dabai(self):
        self.assertIn("十恶大败", names(("丙", "卯"), ("戊", "巳"), ("甲", "辰"), ("乙", "亥")))
        self.assertNotIn("十恶大败", names(("丙", "卯"), ("戊", "巳"), ("甲", "子"), ("乙", "亥")))

    def test_guluan(self):
        self.assertIn("孤鸾", names(("丙", "卯"), ("戊", "巳"), ("乙", "巳"), ("乙", "亥")))
        self.assertNotIn("孤鸾", names(("丙", "卯"), ("戊", "巳"), ("甲", "辰"), ("乙", "亥")))

    def test_jiuchou(self):
        self.assertIn("九丑", names(("丙", "卯"), ("戊", "巳"), ("戊", "子"), ("乙", "亥")))
        self.assertNotIn("九丑", names(("丙", "卯"), ("戊", "巳"), ("甲", "辰"), ("乙", "亥")))

    def test_jinshen_tuishen(self):
        self.assertIn("进神", names(("丙", "卯"), ("戊", "巳"), ("甲", "子"), ("乙", "亥")))
        tui = names(("丙", "卯"), ("戊", "巳"), ("丁", "卯"), ("乙", "亥"))
        self.assertIn("退神", tui)
        self.assertNotIn("进神", tui)

    def test_sanqi_requires_ordered_three_stems(self):
        self.assertIn("三奇贵人", names(("甲", "卯"), ("戊", "巳"), ("庚", "辰"), ("乙", "亥")))
        self.assertNotIn("三奇贵人", names(("戊", "卯"), ("甲", "巳"), ("庚", "辰"), ("乙", "亥")))


class RuleRegistryTest(unittest.TestCase):
    """用**规则 ID 集合**证明有 44 条不同规则，而不是数 add( 的次数。"""

    def test_forty_distinct_rule_ids(self):
        from mingli_tool.auxiliary_chart import SHENSHA_RULE_IDS

        ids = list(SHENSHA_RULE_IDS.values())
        self.assertEqual(len(ids), 44, "规则名到 ID 的映射应有 44 条")
        self.assertEqual(len(set(ids)), 44, "规则 ID 必须两两不同")

    def test_every_id_matches_a_source_call(self):
        """每个规则名都必须在 compute_shensha 里真的出现，不能只有映射没有实现。"""
        from mingli_tool.auxiliary_chart import SHENSHA_RULE_IDS

        source = (ROOT / "scripts" / "pai_pan.py").read_text(encoding="utf-8")
        body = source[source.index("def compute_shensha"):]
        body = body[: body.index("\ndef ", 10)]
        missing = [name for name in SHENSHA_RULE_IDS if f'"{name}"' not in body]
        self.assertEqual(missing, [], f"这些规则名在实现里找不到：{missing}")


class ShenshaEnvelopeTest(unittest.TestCase):
    """逐规则状态与未评估目标。"""

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

    def _shensha(self, time_block):
        import copy

        from mingli_tool.bazi import calculate

        payload = copy.deepcopy(self.BASE)
        payload["profile"]["time"] = time_block
        return calculate(payload)["ai_facts"]["auxiliary_chart"]["shensha"]

    def test_rule_status_covers_every_rule(self):
        sh = self._shensha({"precision": "minute", "value": "12:30", "branch": None})
        self.assertEqual(len(sh["rule_status"]), 44)
        statuses = {item["status"] for item in sh["rule_status"]}
        self.assertTrue(statuses <= {"hit", "no-hit"})

    def test_hits_are_marked_hit(self):
        sh = self._shensha({"precision": "minute", "value": "12:30", "branch": None})
        hit_ids = {h["rule_id"] for h in sh["value"] or []}
        marked = {item["rule_id"] for item in sh["rule_status"] if item["status"] == "hit"}
        self.assertEqual(hit_ids, marked, "命中集合与 rule_status 标注必须一致")

    def test_unknown_hour_marks_hour_unevaluated(self):
        sh = self._shensha({"precision": "unknown", "value": None, "branch": None})
        self.assertIn("hour", sh["unevaluated_targets"])
        self.assertTrue(sh.get("unevaluated_note"))

    def test_known_hour_has_no_unevaluated_targets(self):
        sh = self._shensha({"precision": "branch", "branch": "午"})
        self.assertEqual(sh["unevaluated_targets"], [])


class ShenshaSixTest(unittest.TestCase):
    """国印 / 德秀 / 丧门 / 童子：每条都有命中与不命中两个用例。"""

    def test_guoyin_hit(self):
        # 甲日干见戌支
        self.assertIn("国印贵人", names(("丙", "子"), ("丙", "戌"), ("甲", "寅")))

    def test_guoyin_miss(self):
        # 甲日干，四支 子卯辰亥，不含戌
        self.assertNotIn("国印贵人", names(("丙", "子"), ("戊", "卯"), ("甲", "辰"), ("乙", "亥")))

    def test_dexiu_hit(self):
        # 月支戌（寅午戌）德干为丙丁，月干丙命中
        self.assertIn("德秀", names(("庚", "子"), ("丙", "戌"), ("甲", "子"), ("庚", "午")))

    def test_dexiu_miss(self):
        # 月支戌，四干 庚庚甲庚，既不是德干（丙丁）也不是秀干（戊癸）
        self.assertNotIn("德秀", names(("庚", "子"), ("庚", "戌"), ("甲", "子"), ("庚", "午")))

    def test_sangmen_hit(self):
        # 年支辰 → 顺数两位为午
        self.assertIn("丧门", names(("庚", "辰"), ("丙", "戌"), ("甲", "子"), ("庚", "午")))

    def test_sangmen_miss(self):
        # 年支辰，四支 辰戌子申，不含午
        self.assertNotIn("丧门", names(("庚", "辰"), ("丙", "戌"), ("甲", "子"), ("庚", "申")))

    def test_tongzi_hit(self):
        # 月支戌（秋）→ 日支/时支见寅或子
        self.assertIn("童子", names(("庚", "辰"), ("丙", "戌"), ("甲", "子"), ("庚", "午")))

    def test_tongzi_miss(self):
        # 月支戌（秋），日支午、时支辰都不在 寅/子
        self.assertNotIn("童子", names(("丙", "子"), ("丙", "戌"), ("甲", "午"), ("戊", "辰")))


if __name__ == "__main__":
    unittest.main()
