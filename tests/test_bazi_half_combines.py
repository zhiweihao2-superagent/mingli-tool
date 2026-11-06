"""半合 / 拱合 / 半会 / 拱会 的全表契约（24 组）。

规则：
- 三合局两支含旺支（子卯午酉）→ branch-half-harmony，否则 → branch-arch-harmony
- 三会局同构：branch-half-meeting / branch-arch-meeting
- 有方向无关（无序支对），但换顺序结果必须一致
"""

from __future__ import annotations

import unittest

from mingli_tool.bazi_facts import _pair_relations, engine

# (左支, 右支, 期望 kind, 期望五行)
CASES: tuple[tuple[str, str, str, str], ...] = (
    # 三合：申子辰 水
    ("申", "子", "branch-half-harmony", "水"),
    ("子", "辰", "branch-half-harmony", "水"),
    ("申", "辰", "branch-arch-harmony", "水"),
    # 三合：亥卯未 木
    ("亥", "卯", "branch-half-harmony", "木"),
    ("卯", "未", "branch-half-harmony", "木"),
    ("亥", "未", "branch-arch-harmony", "木"),
    # 三合：寅午戌 火
    ("寅", "午", "branch-half-harmony", "火"),
    ("午", "戌", "branch-half-harmony", "火"),
    ("寅", "戌", "branch-arch-harmony", "火"),
    # 三合：巳酉丑 金
    ("巳", "酉", "branch-half-harmony", "金"),
    ("酉", "丑", "branch-half-harmony", "金"),
    ("巳", "丑", "branch-arch-harmony", "金"),
    # 三会：亥子丑 水
    ("亥", "子", "branch-half-meeting", "水"),
    ("子", "丑", "branch-half-meeting", "水"),
    ("亥", "丑", "branch-arch-meeting", "水"),
    # 三会：寅卯辰 木
    ("寅", "卯", "branch-half-meeting", "木"),
    ("卯", "辰", "branch-half-meeting", "木"),
    ("寅", "辰", "branch-arch-meeting", "木"),
    # 三会：巳午未 火
    ("巳", "午", "branch-half-meeting", "火"),
    ("午", "未", "branch-half-meeting", "火"),
    ("巳", "未", "branch-arch-meeting", "火"),
    # 三会：申酉戌 金
    ("申", "酉", "branch-half-meeting", "金"),
    ("酉", "戌", "branch-half-meeting", "金"),
    ("申", "戌", "branch-arch-meeting", "金"),
)


def _pillars(left: str, right: str) -> dict:
    return {
        "year": {"stem": "甲", "branch": left},
        "day": {"stem": "乙", "branch": right},
    }


def _facts(left: str, right: str) -> list[dict]:
    return _pair_relations(_pillars(left, right))


class HalfCombineTableTest(unittest.TestCase):
    def test_table_covers_24_pairs(self):
        self.assertEqual(len(CASES), 24)
        self.assertEqual(len({frozenset((a, b)) for a, b, _, _ in CASES}), 24)

    def test_each_case_kind_and_element(self):
        for left, right, kind, element in CASES:
            with self.subTest(pair=left + right, kind=kind):
                matched = [f for f in _facts(left, right) if f["kind"] == kind]
                self.assertEqual(len(matched), 1, f"{left}{right} 应恰好一条 {kind}")
                self.assertEqual(matched[0]["result_element"], element)
                self.assertEqual(matched[0]["group_element"], element)
                self.assertEqual(
                    sorted(matched[0]["values"], key=engine.ZHI.index),
                    sorted([left, right], key=engine.ZHI.index),
                )

    def test_reversed_input_gives_same_result(self):
        for left, right, kind, element in CASES:
            with self.subTest(pair=right + left):
                forward = [f for f in _facts(left, right) if f["kind"] == kind]
                backward = [f for f in _facts(right, left) if f["kind"] == kind]
                self.assertEqual(len(forward), 1)
                self.assertEqual(len(backward), 1)
                self.assertEqual(forward[0]["result_element"], backward[0]["result_element"])
                self.assertEqual(forward[0]["result_element"], element)

    def test_no_other_pair_produces_half_or_arch(self):
        """24 组之外不得出现半合/拱合/半会/拱会。"""
        expected = {frozenset((a, b)) for a, b, _, _ in CASES}
        from itertools import combinations

        for left, right in combinations(tuple(engine.ZHI), 2):
            kinds = {f["kind"] for f in _facts(left, right)}
            has = {
                k for k in kinds
                if k in {"branch-half-harmony", "branch-arch-harmony",
                         "branch-half-meeting", "branch-arch-meeting"}
            }
            with self.subTest(pair=left + right):
                if frozenset((left, right)) in expected:
                    self.assertTrue(has)
                else:
                    self.assertEqual(has, set())

    def test_same_branch_never_half_or_arch(self):
        for branch in engine.ZHI:
            kinds = {f["kind"] for f in _facts(branch, branch)}
            self.assertNotIn("branch-half-harmony", kinds)
            self.assertNotIn("branch-arch-harmony", kinds)
            self.assertNotIn("branch-half-meeting", kinds)
            self.assertNotIn("branch-arch-meeting", kinds)


if __name__ == "__main__":
    unittest.main()
