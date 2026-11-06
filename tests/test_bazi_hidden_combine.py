"""地支暗合的 66 组全表契约。

口径（项目决定，不编造古籍出处）：只认传统通行的四组——子巳、丑寅、卯申、午亥。
自由「藏干相合」规则会命中 18 组不同支（30/66 是把同支也算进去的统计），
几乎失去区分度，因此用白名单钉死：

- 藏干笛卡尔积只用于枚举**已入白名单支对**的五合证据，不决定谁算暗合
- 同支不算暗合
- 与六合独立判断（当前两者无交集，但规则上不互相排除）

这是对 r683「自由笛卡尔积」审查意见的**有意偏离**，已由规划方裁定维持白名单。
"""

from __future__ import annotations

import unittest
from itertools import combinations

from mingli_tool.bazi_facts import (
    BRANCH_COMBINES,
    BRANCH_HIDDEN_COMBINES,
    _pair_relations,
    engine,
)

# bazi_facts 内部的 engine 就是 scripts/pai_pan（ZHI/GAN 都在那里）
ZHI = tuple(engine.ZHI)


def _pillars(branch_left: str, branch_right: str) -> dict:
    """两柱最小输入：天干固定为甲/乙，避免天干五合干扰地支判定。"""
    return {
        "year": {"stem": "甲", "branch": branch_left},
        "day": {"stem": "乙", "branch": branch_right},
    }


def _kinds(left: str, right: str) -> list[str]:
    return [fact["kind"] for fact in _pair_relations(_pillars(left, right))]


class HiddenCombineTableTest(unittest.TestCase):
    def test_whitelist_is_exactly_four_pairs(self):
        self.assertEqual(len(BRANCH_HIDDEN_COMBINES), 4)
        expected = {frozenset("子巳"), frozenset("丑寅"), frozenset("卯申"), frozenset("午亥")}
        self.assertEqual(set(BRANCH_HIDDEN_COMBINES), expected)

    def test_all_66_pairs_snapshot(self):
        """66 组无序支对逐一钉死：命中的必须正好是白名单四组。"""
        hits = set()
        for left, right in combinations(ZHI, 2):
            kinds = _kinds(left, right)
            count = kinds.count("branch-hidden-combine")
            self.assertLessEqual(count, 1, f"{left}{right} 产出多条暗合")
            if count:
                hits.add(frozenset((left, right)))
        self.assertEqual(hits, set(BRANCH_HIDDEN_COMBINES))

    def test_order_does_not_matter(self):
        for pair in BRANCH_HIDDEN_COMBINES:
            left, right = sorted(pair, key=ZHI.index)
            self.assertIn("branch-hidden-combine", _kinds(left, right))
            self.assertIn("branch-hidden-combine", _kinds(right, left))

    def test_same_branch_never_hidden_combine(self):
        for branch in ZHI:
            self.assertNotIn("branch-hidden-combine", _kinds(branch, branch))

    def test_current_six_combine_table_does_not_intersect_whitelist(self):
        """当前数据下白名单与六合无交集——这是事实，不是靠代码排除实现的。"""
        self.assertEqual(set(BRANCH_COMBINES) & set(BRANCH_HIDDEN_COMBINES), set())

    def test_hidden_combine_and_six_combine_are_independent(self):
        """规则上两者独立：把某个六合支对临时加进白名单，两种 kind 必须同时输出。"""
        import unittest.mock as mock

        from mingli_tool import bazi_facts

        # 六合六组的藏干之间都凑不出五合，所以反过来做：
        # 把一组**已经有藏干五合证据**的白名单支对临时加进六合表，
        # 断言同一柱对同时输出两个 kind——这才验证得了"不互相排除"。
        pair = frozenset("子巳")
        # BRANCH_COMBINES 是 dict（支对 → 五行），补一项即可
        patched = dict(bazi_facts.BRANCH_COMBINES)
        patched[pair] = "水"
        with mock.patch.object(bazi_facts, "BRANCH_COMBINES", patched):
            left, right = sorted(pair, key=ZHI.index)
            kinds = [f["kind"] for f in bazi_facts._pair_relations(_pillars(left, right))]
            self.assertIn("branch-six-combine", kinds, "六合应照常输出")
            self.assertIn("branch-hidden-combine", kinds, "暗合不应被六合排掉")
        # 恢复后仍无交集
        self.assertEqual(set(bazi_facts.BRANCH_COMBINES) & set(bazi_facts.BRANCH_HIDDEN_COMBINES), set())

    def test_positive_pair_structure(self):
        facts = _pair_relations(_pillars("午", "亥"))
        hidden = [f for f in facts if f["kind"] == "branch-hidden-combine"]
        self.assertEqual(len(hidden), 1)
        fact = hidden[0]
        self.assertEqual(fact["participants"], ["year", "day"])
        self.assertIn(fact["evidence_id"], {"natal.relation.branch-hidden-combine.year.day",
                                            "natal.relation.branch-hidden-combine.day.year"})
        # 藏干对必须带**方向**：左右分别对应两个参与柱，否则甲己和己甲分不清
        pairs = {(item["left_stem"], item["right_stem"]) for item in fact["hidden_stem_pairs"]}
        # 方向有意义：年柱在前（午的藏干在左，亥的在右）
        self.assertIn(("丁", "壬"), pairs)
        self.assertIn(("己", "甲"), pairs)
        for item in fact["hidden_stem_pairs"]:
            self.assertIn("result_element", item, "每对藏干都要带自己的结果五行")
        # 多组结果五行可能不同，所以关系本身不设单一 result_element
        self.assertNotIn("result_element", fact)

    def test_yin_chou_reports_three_directional_pairs(self):
        """寅丑是唯一有三组藏干相合的组合，方向和排序都要稳定。"""
        facts = _pair_relations(_pillars("寅", "丑"))
        fact = [f for f in facts if f["kind"] == "branch-hidden-combine"][0]
        triples = [(i["left_stem"], i["right_stem"], i["result_element"])
                   for i in fact["hidden_stem_pairs"]]
        self.assertEqual(triples, [("甲", "己", "土"), ("丙", "辛", "水"), ("戊", "癸", "火")])

    def test_hidden_stems_come_from_engine_table(self):
        """藏干必须来自引擎的 CANGGAN，不是本地手抄表。"""
        from mingli_tool.bazi_facts import _hidden_stems

        for branch in ZHI:
            expected = tuple(stem for stem, _element in engine.CANGGAN[branch])
            self.assertEqual(_hidden_stems(branch), expected, branch)

    def test_old_free_rule_hits_are_excluded(self):
        """子寅在自由藏干规则下命中，但不在白名单内，必须排除。"""
        self.assertNotIn("branch-hidden-combine", _kinds("子", "寅"))

    def test_module_level_hidden_combinations_entry(self):
        """藏干五合枚举要有**模块级**入口，调用方与测试才能单独用。"""
        from mingli_tool.bazi_facts import _hidden_combinations

        pairs = _hidden_combinations("寅", "丑")
        self.assertEqual(
            [(item["left_stem"], item["right_stem"]) for item in pairs],
            [("甲", "己"), ("丙", "辛"), ("戊", "癸")],
        )
        single = _hidden_combinations("子", "寅")
        self.assertEqual(
            [(item["left_stem"], item["right_stem"]) for item in single],
            [("癸", "戊")],
        )

    def test_unknown_branch_raises(self):
        """未知地支必须报错：静默跳过等于假装这一柱没有关系。"""
        with self.assertRaises(ValueError):
            _kinds("子", "？")


if __name__ == "__main__":
    unittest.main()
