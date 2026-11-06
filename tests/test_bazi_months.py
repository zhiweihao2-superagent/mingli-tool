"""流月坐标的确定性测试。

覆盖：月份数量与索引、边界连续性、立春跨年、五虎遁干支、不支持年份、命盘绑定。
全部断言只依赖 pinned 引擎的定气输出，不涉及 AI。
"""

import copy
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

from mingli_tool.bazi import calculate  # noqa: E402
from mingli_tool.bazi_months import (  # noqa: E402
    MAX_TARGET_YEAR,
    MIN_TARGET_YEAR,
    MONTH_COUNT,
    _fmt_instant,
    build_monthly_facts,
    resolve_dayun,
)
from scripts import pai_pan as engine  # noqa: E402


def request_payload(date="1990-05-15", through=2026):
    return {
        "schema_version": "1.0",
        "profile": {
            "display_name": None,
            "calendar": "solar",
            "date": date,
            "is_leap_month": False,
            "time": {"precision": "minute", "value": "12:30"},
            "timezone": "Asia/Shanghai",
            "sex_for_calculation": "male",
            "birthplace": {"label": None, "longitude": None, "latitude": None},
        },
        "rules": {"profile_id": "engine-default-v1", "true_solar_time": False},
        "options": {"save_history": False, "annual_cycles_through": through},
    }


class MonthlyRelationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = calculate(request_payload())
        cls.calculation = cls.result["calculation"]
        cls.normalized = cls.result["normalized_input"]

    def test_relations_are_tagged_with_layer(self):
        facts = build_monthly_facts(self.calculation, 2026, self.normalized)
        known = {"natal", "luck", "annual", "monthly"}
        for month in facts["months"]:
            for relation in month["relations"]:
                self.assertEqual(len(relation["layers"]), len(relation["participants"]))
                for layer in relation["layers"]:
                    self.assertIn(layer, known)
                # months 是零基数组，第 N 月的证据必须指向 N-1
                self.assertTrue(
                    relation["evidence_id"].startswith(
                        f"monthly.months[{month['index'] - 1}].relation."
                    ),
                    relation["evidence_id"],
                )

    def test_relation_evidence_points_to_its_own_month(self):
        facts = build_monthly_facts(self.calculation, 2026, self.normalized)
        seen = []
        for month in facts["months"]:
            for relation in month["relations"]:
                # 下标必须与所属月份一致，不能整体错一位
                self.assertIn(f"monthly.months[{month['index'] - 1}].", relation["evidence_id"])
                seen.append(relation["evidence_id"])
        self.assertEqual(len(seen), len(set(seen)), "关系证据 ID 不应重复")

    def test_pure_natal_relations_are_not_duplicated(self):
        facts = build_monthly_facts(self.calculation, 2026, self.normalized)
        for month in facts["months"]:
            for relation in month.get("relations", []):
                self.assertFalse(
                    all(layer == "natal" for layer in relation["layers"]),
                    f"第 {month['index']} 月出现纯原局关系，应已过滤",
                )

    def test_annual_and_monthly_layers_present(self):
        facts = build_monthly_facts(self.calculation, 2026, self.normalized)
        seen = set()
        for month in facts["months"]:
            for relation in month["relations"]:
                seen.update(relation["layers"])
        self.assertIn("annual", seen)
        self.assertIn("monthly", seen)

    def test_every_relation_binds_participant_to_layer_and_value(self):
        # 三合/三会里同一支可出现在多个柱位，participants 会多于唯一支值，
        # 所以要求「每个参与者都有一条 binding」并且 binding 的取值与其柱位一致，
        # 唯一支值另放 required_values。
        facts = build_monthly_facts(self.calculation, 2026, self.normalized)
        checked = 0
        for month in facts["months"]:
            for relation in month["relations"]:
                bindings = relation["bindings"]
                self.assertEqual(len(bindings), len(relation["participants"]))
                self.assertEqual(len(bindings), len(relation["layers"]))
                for binding in bindings:
                    self.assertIn(binding["layer"], {"natal", "luck", "annual", "monthly"})
                    self.assertIn(binding["channel"], {"stem", "branch"})
                    self.assertTrue(binding["value"])
                    checked += 1
                for value in relation["required_values"]:
                    self.assertIn(value, engine.GAN + engine.ZHI)
        self.assertGreater(checked, 0, "应至少检查到一条关系绑定")

    def test_three_harmony_with_duplicate_pillars_stays_aligned(self):
        """年柱与大运同为申时，三合参与者有 4 个但唯一支值只有 3 个。"""
        from mingli_tool.bazi_months import _relation_facts

        pillars = {
            "year": {"stem": "甲", "branch": "申"},
            "month": {"stem": "丙", "branch": "寅"},
            "day": {"stem": "戊", "branch": "午"},
            "hour": {"stem": "庚", "branch": "子"},
            "dayun": {"stem": "壬", "branch": "申"},
            "liunian": {"stem": "甲", "branch": "子"},
            "liuyue": {"stem": "丙", "branch": "辰"},
        }
        facts = _relation_facts(1, pillars)
        harmonies = [
            item for item in facts
            if item["kind"] in {"branch-three-harmony", "branch-three-meeting"}
        ]
        self.assertTrue(harmonies, "应存在三合或三会事实")
        for item in harmonies:
            self.assertEqual(len(item["bindings"]), len(item["participants"]))
            # 有重复柱位时，唯一支值数量少于参与者数量
            if len(item["participants"]) > len(item["required_values"]):
                self.assertGreater(len(item["participants"]), 3)
            for binding in item["bindings"]:
                expected = pillars[binding["participant"]][binding["channel"]]
                self.assertEqual(binding["value"], expected)

    def test_combine_relations_carry_candidate_status_only(self):
        facts = build_monthly_facts(self.calculation, 2026, self.normalized)
        allowed = {"supported-candidate", "pending-candidate", "blocked-candidate"}
        for month in facts["months"]:
            for relation in month["relations"]:
                if relation["kind"] in {
                    "stem-combine", "branch-six-combine",
                    "branch-three-harmony", "branch-three-meeting",
                }:
                    self.assertIn(relation["transformation"]["status"], allowed)
                    self.assertFalse(relation["transformation"].get("rewrites_original_elements", False))

    def test_combine_relations_declare_conditions(self):
        facts = build_monthly_facts(self.calculation, 2026, self.normalized)
        combines = [
            relation
            for month in facts["months"]
            for relation in month["relations"]
            if relation["kind"] in {
                "stem-combine", "branch-six-combine",
                "branch-three-harmony", "branch-three-meeting",
            }
        ]
        self.assertTrue(combines, "该盘应至少有一个组合关系可供审计")
        for relation in combines:
            block = relation["transformation"]
            self.assertIn(
                block["status"],
                {"supported-candidate", "pending-candidate", "blocked-candidate"},
            )
            self.assertTrue(block["required_structure"])
            self.assertTrue(block["supporting_conditions"])
            self.assertIsInstance(block["blocking_conditions"], list)
            self.assertIn("structure_intact", block)
            self.assertEqual(block["structure_intact"], not block["blocking_conditions"])
            # 阻断证据必须自带数据，且可寻址标记与实际是否输出一致
            for blocker in block["blocking_conditions"]:
                self.assertTrue(blocker["kind"])
                self.assertTrue(blocker["participants"])
                self.assertEqual(len(blocker["layers"]), len(blocker["participants"]))
                self.assertIsInstance(blocker["addressable"], bool)

    def test_unsupported_relation_kinds_are_declared(self):
        audit = build_monthly_facts(self.calculation, 2026, self.normalized)["relation_audit"]
        # 关系表已补全：半合/半会/拱合/拱会/三朋/暗合都进了 supported。
        # 守卫的重点从"必须有未实现项"转成"支持与未支持不能重叠、也不能漏声明"。
        self.assertTrue(audit["supported"])
        self.assertEqual(
            set(audit["supported"]) & set(audit["unsupported"]),
            set(),
            "同一类型不能既支持又不支持",
        )
        for kind in ("branch-half-harmony", "branch-half-meeting",
                     "branch-arch-harmony", "branch-arch-meeting",
                     "stem-three-combine", "branch-hidden-combine"):
            self.assertIn(kind, audit["supported"], f"{kind} 应已实现")
            self.assertNotIn(kind, audit["unsupported"])

    def test_relation_audit_reports_available_layers(self):
        facts = build_monthly_facts(self.calculation, 2026, self.normalized)
        audit = facts["relation_audit"]
        self.assertIn(audit["status"], {"ok", "partial"})
        self.assertIn("natal", audit["layers"])
        self.assertIn("annual", audit["layers"])
        self.assertIn("monthly", audit["layers"])

    def test_dayun_resolves_to_a_real_cycle_or_says_why(self):
        dayun = resolve_dayun(self.calculation, self.normalized, 2026)
        if dayun["status"] == "ok":
            self.assertEqual(len(dayun["ganzhi"]), 2)
            self.assertEqual(dayun["gan"], dayun["ganzhi"][0])
            self.assertEqual(dayun["zhi"], dayun["ganzhi"][1])
            self.assertRegex(dayun["age_range"], r"^\d+-\d+岁$")
            self.assertTrue(dayun["from"] <= dayun["at"] < dayun["to"])
        else:
            self.assertIn("reason", dayun)

    def test_dayun_marks_uncertain_months_near_boundary(self):
        """出生 1990-05-15、起运 7 年 3 个月（精度到月，±1 月不确定）。

        2027-08-15 附近换运，因此 7 月前后若干月都无法确定归属，
        必须标 indeterminate 并排除大运层，而不是按推定时刻硬分。
        """
        facts = build_monthly_facts(self.calculation, 2027, self.normalized)
        layers = facts["layers"]["luck"]
        uncertain = [
            month["index"] for month in facts["months"]
            if month["luck"]["status"] == "indeterminate"
        ]
        self.assertIn(7, uncertain, f"换运月应标不确定，实际 {uncertain}")
        self.assertTrue(uncertain, "应至少有一个不确定月")
        self.assertEqual(layers["crossed_months"], uncertain)

        for month in facts["months"]:
            if month["luck"]["status"] != "indeterminate":
                continue
            scope = month["relation_scope"]
            self.assertIn("luck", scope["omitted_layers"])
            self.assertNotIn("luck", scope["computed_layers"])
            self.assertIn("不确定", scope["reason"])

    def test_crossed_month_excludes_luck_layer(self):
        """不确定月的大运层不参与关系审计，也不会凭空绑定某个大运。"""
        facts = build_monthly_facts(self.calculation, 2027, self.normalized)
        month = facts["months"][6]
        self.assertEqual(month["luck"]["status"], "indeterminate")
        self.assertIsNone(month["luck"].get("ganzhi"))
        self.assertTrue(month["luck"]["boundaries"])
        for relation in month["relations"]:
            self.assertNotIn("luck", relation["layers"])

    def test_months_far_from_boundary_keep_luck_layer(self):
        facts = build_monthly_facts(self.calculation, 2027, self.normalized)
        determined = [
            month for month in facts["months"]
            if month["luck"]["status"] == "ok"
        ]
        self.assertTrue(determined, "远离换运点的月份应能确定大运")
        for month in determined:
            self.assertIn("luck", month["relation_scope"]["computed_layers"])
            self.assertEqual(month["relation_scope"]["omitted_layers"], [])

    def test_dayun_is_stable_in_a_year_without_boundary(self):
        facts = build_monthly_facts(self.calculation, 2026, self.normalized)
        self.assertEqual(len(facts["layers"]["luck"]["cycles_used"]), 1)

    def test_uncertain_month_reports_boundaries(self):
        """不确定月要把引起不确定的换运时刻列出来，便于人工核对。"""
        facts = build_monthly_facts(self.calculation, 2027, self.normalized)
        uncertain = [m for m in facts["months"] if m["luck"]["status"] == "indeterminate"]
        self.assertTrue(uncertain)
        month = uncertain[0]
        self.assertEqual(month["relation_scope"]["omitted_layers"], ["luck"])
        self.assertEqual(month["relation_scope"]["segments"], 0)
        self.assertTrue(month["relation_scope"]["boundaries"])
        self.assertTrue(month["relation_scope"]["suggestion"])

    def test_boundary_at_month_start_is_not_a_crossing(self):
        """半开区间 [start,end)：换运时刻恰为月初时，整月已属新运，不算跨界。"""
        from datetime import datetime as dt
        from mingli_tool.bazi_months import _boundaries_within

        start = dt(2027, 8, 7, 8, 0)
        end = dt(2027, 9, 7, 20, 0)
        boundary = dt(2027, 8, 7, 8, 0)          # 恰好等于 start
        self.assertEqual(_boundaries_within(start, end, [boundary]), [])
        self.assertEqual(
            _boundaries_within(start, end, [dt(2027, 8, 15, 12, 0)]),
            [dt(2027, 8, 15, 12, 0)],
        )
        self.assertEqual(_boundaries_within(start, end, [end]), [])   # 恰在末端不外溢

    def test_qiyun_days_shift_boundaries_when_present(self):
        """起运若带天数，换运时刻必须随之平移，不能被忽略。"""
        from datetime import datetime as dt
        from mingli_tool.bazi_months import resolve_dayun_at

        moment = dt(2027, 9, 1, 12, 0, tzinfo=engine.BJ)
        base = resolve_dayun_at(self.calculation, self.normalized, moment)
        self.assertEqual(base["status"], "ok")

        shifted_calc = copy.deepcopy(self.calculation)
        shifted_calc["luck_cycles"]["start"]["days"] = 40
        shifted = resolve_dayun_at(shifted_calc, self.normalized, moment)
        # 换运推后 40 天（08-15 → 09-24），同一时刻应落回上一个 10 年
        self.assertNotEqual(shifted.get("ganzhi"), base.get("ganzhi"))
        self.assertLess(shifted["from"], base["from"])

    def test_natal_conflict_blocks_cross_layer_combine(self):
        """原局内部冲突也必须计入阻断条件，否则跨层组合会被误判为结构完整。"""
        from mingli_tool.bazi_months import _relation_facts

        pillars = {
            "year": {"stem": "甲", "branch": "子"},
            "month": {"stem": "庚", "branch": "午"},   # 甲庚冲（纯原局）
            "day": {"stem": "丙", "branch": "寅"},
            "hour": {"stem": "戊", "branch": "辰"},
            "liunian": {"stem": "壬", "branch": "申"},
            "liuyue": {"stem": "己", "branch": "巳"},  # 甲己合
        }
        facts = _relation_facts(1, pillars)

        combines = [
            item for item in facts
            if item["kind"] == "stem-combine" and "liuyue" in item["participants"]
        ]
        self.assertTrue(combines, "应存在流月参与的干合")
        item = combines[0]
        self.assertIn("year", item["participants"])
        self.assertTrue(
            item["transformation"]["blocking_conditions"],
            "原局甲庚冲应作为阻断条件出现",
        )
        self.assertFalse(item["transformation"]["structure_intact"])

    def test_cross_channel_conflict_does_not_block_combine(self):
        """天干合不应被同一柱位的地支冲阻断——阻断只在同一通道内成立。"""
        from mingli_tool.bazi_months import _relation_facts

        pillars = {
            "year": {"stem": "甲", "branch": "子"},
            "month": {"stem": "丙", "branch": "午"},   # 子午冲（地支，跨通道）
            "day": {"stem": "戊", "branch": "寅"},
            "hour": {"stem": "辛", "branch": "巳"},
            "liunian": {"stem": "己", "branch": "未"},  # 甲己合（天干，年柱参与）
            "liuyue": {"stem": "丁", "branch": "酉"},
        }
        facts = _relation_facts(1, pillars)

        stem_combines = [
            item for item in facts
            if item["kind"] == "stem-combine" and set(item["participants"]) == {"year", "liunian"}
        ]
        self.assertTrue(stem_combines, "应存在年柱与月柱的天干合")
        # 地支的 子午冲 属于 branch 通道，不应阻断天干合
        self.assertEqual(stem_combines[0]["transformation"]["blocking_conditions"], [])
        self.assertTrue(stem_combines[0]["transformation"]["structure_intact"])

    def test_shichen_precision_still_marks_uncertain(self):
        """出生时刻只到时辰时，换运月同样要标不确定（保守处理）。"""
        import copy as _copy

        coarse = _copy.deepcopy(self.normalized)
        coarse["profile"]["time"] = {"precision": "branch", "branch": "午"}

        facts = build_monthly_facts(self.calculation, 2027, coarse)
        uncertain = [m for m in facts["months"] if m["luck"]["status"] == "indeterminate"]
        self.assertTrue(uncertain, "时辰精度下换运月应标不确定")
        month = uncertain[0]
        self.assertIn("luck", month["relation_scope"]["omitted_layers"])
        self.assertNotIn("luck", month["relation_scope"]["computed_layers"])

    def test_normal_month_covers_luck_layer(self):
        facts = build_monthly_facts(self.calculation, 2026, self.normalized)
        for month in facts["months"]:
            self.assertIn("luck", month["relation_scope"]["computed_layers"])
            self.assertEqual(month["relation_scope"]["omitted_layers"], [])

    def test_months_before_qiyun_are_marked_before_start(self):
        facts = build_monthly_facts(self.calculation, 1995, self.normalized)
        self.assertTrue(
            all(month["luck"]["status"] == "before_start" for month in facts["months"])
        )
        self.assertEqual(facts["layers"]["luck"]["cycles_used"], [])
        self.assertEqual(facts["relation_audit"]["status"], "partial")
        self.assertNotIn("luck", facts["relation_audit"]["layers"])

    def test_dayun_unavailable_without_birth_date(self):
        dayun = resolve_dayun(self.calculation, None, 2026)
        self.assertEqual(dayun["status"], "unavailable")
        self.assertIn("reason", dayun)

    def test_dayun_skips_pre_start_small_luck_row(self):
        # 「起运前 0岁-8岁」不是大运，不能被当成大运返回
        dayun = resolve_dayun(self.calculation, self.normalized, 2000)
        if dayun["status"] == "ok":
            self.assertNotIn("起运前", str(dayun.get("age_range")))


class MonthlyFactsTest(unittest.TestCase):
    def test_twelve_months_with_sequential_index(self):
        facts = build_monthly_facts(None, 2024)
        self.assertEqual(facts["status"], "ok")
        self.assertEqual(len(facts["months"]), MONTH_COUNT)
        self.assertEqual([m["index"] for m in facts["months"]], list(range(1, 13)))

    def test_boundaries_are_contiguous_and_ordered(self):
        for year in (1950, 1990, 2024, 2026, 2050):
            months = build_monthly_facts(None, year)["months"]
            for current, following in zip(months, months[1:]):
                self.assertEqual(
                    current["end"],
                    following["start"],
                    f"{year} 年第 {current['index']} 月与下月不连续",
                )
            for month in months:
                self.assertLess(month["start"], month["end"])

    def test_first_month_starts_at_lichun_and_lasts_until_next_lichun(self):
        for year in (1984, 2024, 2026):
            months = build_monthly_facts(None, year)["months"]
            # 用产品同一套取整（秒级四舍五入），别在测试里另写一份截断逻辑
            lichun = _fmt_instant(engine.solar_term_beijing(year, 315))
            next_lichun = _fmt_instant(engine.solar_term_beijing(year + 1, 315))
            self.assertEqual(months[0]["start"], lichun)
            self.assertEqual(months[-1]["end"], next_lichun)
            self.assertEqual(months[0]["jie"], "立春")

    def test_month_ganzhi_follows_wuhudun_on_annual_stem(self):
        # 甲己之年丙作首：2024 甲辰年，正月丙寅，十二月丁丑
        months_2024 = build_monthly_facts(None, 2024)["months"]
        self.assertEqual(months_2024[0]["ganzhi"], "丙寅")
        self.assertEqual(months_2024[11]["ganzhi"], "丁丑")
        self.assertEqual(
            [m["ganzhi"] for m in months_2024],
            ["丙寅", "丁卯", "戊辰", "己巳", "庚午", "辛未",
             "壬申", "癸酉", "甲戌", "乙亥", "丙子", "丁丑"],
        )

        # 丙辛之岁寻庚上：2026 丙午年，正月庚寅
        months_2026 = build_monthly_facts(None, 2026)["months"]
        self.assertEqual(months_2026[0]["ganzhi"], "庚寅")
        self.assertEqual(months_2026[11]["ganzhi"], "辛丑")

        # 戊癸何方发，壬子是真途：2028 戊申年，正月甲寅
        months_2028 = build_monthly_facts(None, 2028)["months"]
        self.assertEqual(months_2028[0]["ganzhi"], "甲寅")

    def test_branch_sequence_is_yin_to_chou(self):
        months = build_monthly_facts(None, 2026)["months"]
        self.assertEqual([m["zhi"] for m in months], list("寅卯辰巳午未申酉戌亥子丑"))
        self.assertEqual(months[10]["jie"], "大雪")   # 子月由大雪起
        self.assertEqual(months[11]["jie"], "小寒")   # 丑月由小寒起

    def test_adjacent_years_join_without_gap(self):
        # 2023 年末月终点必须等于 2024 年首月起点：立春是同一时刻
        prev = build_monthly_facts(None, 2023)["months"][-1]
        head = build_monthly_facts(None, 2024)["months"][0]
        self.assertEqual(prev["end"], head["start"])

    def test_instants_on_both_sides_of_lichun_get_different_pillars(self):
        """立春两侧必须落在不同流月，且干支不同——这是换年换月的核心断言。"""
        previous = build_monthly_facts(None, 2023)["months"][-1]
        following = build_monthly_facts(None, 2024)["months"][0]
        boundary = following["start"]

        self.assertEqual(previous["end"], boundary)
        self.assertLess(previous["start"], boundary)      # 立春前一刻仍属上一月
        self.assertLess(boundary, following["end"])       # 立春后一刻已属下一月
        self.assertNotEqual(previous["ganzhi"], following["ganzhi"])
        self.assertEqual(following["jie"], "立春")
        self.assertEqual(following["zhi"], "寅")

    def test_every_month_interval_is_positive(self):
        for year in (1900, 1984, 2024, 2026, 2099):
            for month in build_monthly_facts(None, year)["months"]:
                self.assertLess(month["start"], month["end"], f"{year}-{month['index']}")
                self.assertGreater(month["duration_days"], 0)

    def test_month_json_pointer_is_zero_based(self):
        facts = build_monthly_facts(None, 2026)
        self.assertEqual(facts["months"][0]["json_pointer"], "/months/0")
        self.assertEqual(facts["months"][11]["json_pointer"], "/months/11")

    def test_month_fingerprint_covers_boundaries(self):
        facts = build_monthly_facts(None, 2026)
        self.assertTrue(facts["fingerprint"].startswith("mf-"))
        # 同样输入指纹稳定
        self.assertEqual(
            facts["fingerprint"], build_monthly_facts(None, 2026)["fingerprint"]
        )
        # 换年份指纹改变
        self.assertNotEqual(
            facts["fingerprint"], build_monthly_facts(None, 2027)["fingerprint"]
        )
        # 手工改边界后自行复算会不同（装配层据此发现被篡改的边界）
        from mingli_tool.bazi_months import month_fingerprint

        tampered = [dict(month) for month in facts["months"]]
        tampered[0]["start"] = "2026-02-05T00:00:00+08:00"
        self.assertNotEqual(month_fingerprint(tampered), facts["fingerprint"])

    def test_month_ganzhi_matches_engine_resolution(self):
        """流月干支必须与固定引擎自己的定月结果一致，而不是只跟手写表比。"""
        for year in (2024, 2026, 2028):
            facts = build_monthly_facts(None, year)
            annual_gan = facts["annual"]["gan"]
            annual_gan_index = engine.GAN.index(annual_gan)
            for month in facts["months"]:
                start = datetime.fromisoformat(month["start"])
                end = datetime.fromisoformat(month["end"])
                probe = start + (end - start) / 2
                gan, zhi, jie_name, _lon, _prev, _next = engine.resolve_month_pillar(
                    probe, annual_gan_index
                )
                self.assertEqual(
                    gan + zhi, month["ganzhi"],
                    f"{year} 年第 {month['index']} 月干支与引擎不一致",
                )
                self.assertEqual(jie_name, month["jie"], f"{year} 第 {month['index']} 月节气名不符")

    def test_year_pillar_at_boundary_matches_engine(self):
        """立春两侧的年柱必须与引擎的立春分年一致。

        注意：事实包里的边界时刻截断到秒，真实交节时刻带亚秒，
        所以"立春时刻"本身要按引擎口径取 +1 秒之后才算进入新年。
        """
        for year in (2024, 2026):
            facts = build_monthly_facts(None, year)
            boundary = datetime.fromisoformat(facts["months"][0]["start"])
            before = engine.resolve_year_pillar(boundary - timedelta(seconds=1))
            after = engine.resolve_year_pillar(boundary + timedelta(seconds=1))
            self.assertEqual(before[0], year - 1, "立春前应仍属上一年")
            self.assertEqual(after[0], year, "立春后应属本年")
            self.assertNotEqual(before[1] + before[2], after[1] + after[2])

    def test_month_labels_match_their_index(self):
        labels = [m["label"] for m in build_monthly_facts(None, 2026)["months"]]
        self.assertEqual(
            labels,
            ["正月", "二月", "三月", "四月", "五月", "六月",
             "七月", "八月", "九月", "十月", "冬月", "腊月"],
        )
        # 第三个月不能因为下标偏移标成「2月」
        self.assertEqual(labels[2], "三月")
        self.assertEqual(labels[11], "腊月")

    @staticmethod
    def _month_at(facts, moment):
        for month in facts["months"]:
            start = datetime.fromisoformat(month["start"])
            end = datetime.fromisoformat(month["end"])
            if start <= moment < end:
                return month
        return None

    def test_non_lichun_jie_boundary_switches_month_pillar(self):
        """非立春的节月边界（惊蛰）两侧：交节时刻必须归入新月，且干支改变。"""
        facts = build_monthly_facts(None, 2026)
        second = facts["months"][1]
        self.assertEqual(second["jie"], "惊蛰")

        boundary = datetime.fromisoformat(second["start"])
        just_before = self._month_at(facts, boundary - timedelta(seconds=1))
        at_boundary = self._month_at(facts, boundary)

        self.assertIsNotNone(just_before)
        self.assertIsNotNone(at_boundary)
        self.assertEqual(just_before["index"], 1, "交节前一刻应仍属上一月")
        self.assertEqual(at_boundary["index"], 2, "交节时刻必须归入新月（半开区间）")
        self.assertNotEqual(just_before["ganzhi"], at_boundary["ganzhi"])
        self.assertEqual(at_boundary["ganzhi"], "辛卯")

    def test_every_jie_boundary_switches_month_pillar_by_engine(self):
        """全部 12 个节气边界：两侧必须分属不同月，且月柱与**引擎**一致。

        原来只验了 2026 年惊蛰一个点，其余 11 个节气边界没有被任何断言覆盖，
        边界附近的归属错误会漏检。这里逐节气核对，并在边界两侧各取 1 秒。
        """
        from scripts import pai_pan as engine

        for year in (2000, 2026):
            facts = build_monthly_facts(None, year)
            for month in facts["months"]:
                with self.subTest(year=year, jie=month["jie"]):
                    boundary = datetime.fromisoformat(month["start"])
                    just_before = boundary - timedelta(seconds=1)

                    # 边界时刻必须归入本月
                    at_boundary = self._month_at(facts, boundary)
                    self.assertIsNotNone(at_boundary)
                    self.assertEqual(at_boundary["index"], month["index"],
                                     f"{month['jie']} 交节时刻未归入本月")

                    # 边界前一刻必须归入上一个月（第 1 个月的边界是年初起点，跳过）
                    if month["index"] > 1:
                        before = self._month_at(facts, just_before)
                        self.assertIsNotNone(before)
                        self.assertEqual(before["index"], month["index"] - 1,
                                         f"{month['jie']} 交节前一秒不在上一月")
                        self.assertNotEqual(before["ganzhi"], month["ganzhi"],
                                            f"{month['jie']} 换月但月柱没变")

                    # 月柱必须由引擎在同一时刻算出同样的结果
                    owner = year + 1 if month["jie"] == "小寒" else year
                    expected = engine.solar_term_beijing(owner, month["jie_longitude"])
                    self.assertEqual(boundary, expected,
                                     f"{month['jie']} 起点与引擎时刻不一致")

    def test_xiaohan_boundary_crosses_calendar_year(self):
        """第 12 月（丑月）起于次年小寒、止于次年立春，跨公历年不能错位。"""
        facts = build_monthly_facts(None, 2026)
        last = facts["months"][11]
        self.assertEqual(last["zhi"], "丑")
        self.assertEqual(last["jie"], "小寒")
        self.assertTrue(last["start"].startswith("2027-01-05"), last["start"])
        self.assertTrue(last["end"].startswith("2027-02-04"), last["end"])

        # 跨年边界的归属：立春前一刻属 2026 年第 12 月，立春时刻起属 2027 年
        next_facts = build_monthly_facts(None, 2027)
        boundary = datetime.fromisoformat(next_facts["months"][0]["start"])
        self.assertIsNone(self._month_at(facts, boundary), "2026 年不应包含 2027 立春时刻")
        self.assertEqual(self._month_at(facts, boundary - timedelta(seconds=1))["index"], 12)
        self.assertEqual(self._month_at(next_facts, boundary)["index"], 1)

    def test_annual_ganzhi_matches_engine(self):
        for year in (1984, 2000, 2024, 2026):
            facts = build_monthly_facts(None, year)
            self.assertEqual(facts["annual"]["ganzhi"], engine.liunian_gz(year))
            self.assertEqual(
                facts["annual"]["gan"], facts["annual"]["ganzhi"][0]
            )
            self.assertEqual(
                facts["annual"]["zhi"], facts["annual"]["ganzhi"][1]
            )

    def test_half_years_cover_exactly_twelve_months(self):
        facts = build_monthly_facts(None, 2024)
        first = facts["half_years"]["first_half"]
        second = facts["half_years"]["second_half"]
        self.assertEqual(first["months"], [1, 2, 3, 4, 5, 6])
        self.assertEqual(second["months"], [7, 8, 9, 10, 11, 12])
        self.assertEqual(
            len(first["evidence_ids"]) + len(second["evidence_ids"]), MONTH_COUNT
        )
        self.assertEqual(first["end"], second["start"])
        self.assertEqual(first["first_ganzhi"], "丙寅")
        self.assertEqual(second["last_ganzhi"], "丁丑")

    def test_validation_passes_for_supported_years(self):
        for year in (1900, 2024, 2099):
            validation = build_monthly_facts(None, year)["validation"]
            failed = [c for c in validation["checks"] if not c["pass"]]
            self.assertEqual(validation["status"], "pass", f"{year}: {failed}")

    def test_unsupported_year_is_explicit_not_approximated(self):
        for year in (MIN_TARGET_YEAR - 1, MAX_TARGET_YEAR + 1, 1800):
            facts = build_monthly_facts(None, year)
            self.assertEqual(facts["status"], "unsupported")
            self.assertEqual(facts["months"], [])
            self.assertIn("覆盖范围", facts["reason"])

    def test_birth_pillars_bound_when_calculation_given(self):
        calculation = {
            "pillars": {
                "year": {"stem": "甲", "branch": "子"},
                "month": {"stem": "丙", "branch": "寅"},
                "day": {"stem": "戊", "branch": "午"},
                "hour": {"stem": "壬", "branch": "子"},
            }
        }
        facts = build_monthly_facts(calculation, 2026)
        self.assertEqual(facts["birth_pillars"]["year"]["stem"], "甲")
        self.assertEqual(facts["birth_pillars"]["day"]["branch"], "午")

        without = build_monthly_facts(None, 2026)
        self.assertIsNone(without["birth_pillars"])

    def test_evidence_ids_are_stable_and_indexed(self):
        facts = build_monthly_facts(None, 2026)
        self.assertEqual(
            [m["evidence_id"] for m in facts["months"]],
            [f"monthly.months[{i}]" for i in range(12)],
        )


class AdapterIntegrationTest(unittest.TestCase):
    """适配器出口必须带上重点年份的流月事实，且不破坏原有字段。"""

    @classmethod
    def setUpClass(cls):
        cls.result = calculate(request_payload(through=2027))

    def test_monthly_facts_present_in_response(self):
        self.assertIn("monthly_facts", self.result)
        monthly = self.result["monthly_facts"]
        self.assertEqual(monthly["status"], "ok")
        self.assertEqual(monthly["target_year"], 2027)
        self.assertEqual(len(monthly["months"]), MONTH_COUNT)

    def test_monthly_facts_targets_requested_year(self):
        # 重点年份来自 options.annual_cycles_through，不能被别的年份顶替
        self.assertEqual(self.result["monthly_facts"]["target_year"], 2027)
        self.assertEqual(self.result["normalized_input"]["options"]["annual_cycles_through"], 2027)

    def test_monthly_facts_carry_relations_and_layers(self):
        monthly = self.result["monthly_facts"]
        self.assertIn("relation_audit", monthly)
        self.assertIn("luck", monthly["layers"])
        self.assertTrue(any(m["relation_count"] for m in monthly["months"]))

    def test_existing_fields_still_intact(self):
        for key in ("schema_version", "normalized_input", "calculation", "ai_facts", "provenance"):
            self.assertIn(key, self.result)
        self.assertEqual(self.result["calculation"]["system"], "bazi")


if __name__ == "__main__":
    unittest.main(verbosity=2)

class LuckDigestTest(unittest.TestCase):
    """分段大运必须真的进指纹。

    真实夹具里目前没有「月内换运」的月份（split months: 0），
    所以这条路径不会被真实数据覆盖——历史上正是因此潜伏了一个字段名 bug
    （摘要读 from/to，实际写的是 start/end）。这里用构造数据钉死。
    """

    def _luck(self, start: str, end: str) -> dict:
        return {
            "status": "ok",
            "ganzhi": "甲子",
            "from": "2026-01-01T00:00:00+08:00",
            "to": "2026-12-31T00:00:00+08:00",
            "segments": [
                {"start": start, "end": end, "ganzhi": "甲子"},
            ],
        }

    def test_segment_boundaries_change_the_digest(self):
        from mingli_tool.bazi_months import _luck_digest

        first = _luck_digest(self._luck("2026-03-01T00:00:00+08:00", "2026-03-15T00:00:00+08:00"))
        second = _luck_digest(self._luck("2026-03-02T00:00:00+08:00", "2026-03-15T00:00:00+08:00"))
        self.assertNotEqual(first, second, "分段起止变化必须改变大运摘要")

    def test_missing_segments_is_stable(self):
        from mingli_tool.bazi_months import _luck_digest

        self.assertEqual(_luck_digest(self._luck("", "")), _luck_digest(self._luck("", "")))
