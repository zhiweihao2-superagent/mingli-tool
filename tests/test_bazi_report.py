"""八字结构报告的渲染验收：只查事实与格式，不查吉凶判断。"""

from __future__ import annotations

import re
import unittest

from mingli_tool import bazi

import scripts.render_bazi_report as renderer


def _build(date: str = "1990-05-15", time_value: str = "12:30", through: int = 2033):
    payload = renderer.build_payload(date, time_value, "male", through)
    result = bazi.calculate(payload)
    text = renderer.render(result["calculation"], result["ai_facts"], int(date[:4]))
    return result, text


class BaziReportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result, cls.text = _build()
        cls.facts = cls.result["ai_facts"]

    def test_nine_sections_present(self):
        headings = re.findall(r"^## ", self.text, flags=re.M)
        self.assertGreaterEqual(len(headings), 10, f"章节过少：{headings}")

    def test_pillar_table_matches_calculation(self):
        for ganzhi in ("庚午", "辛巳", "庚辰", "壬午"):
            self.assertIn(ganzhi, self.text)
        for label in ("年柱", "月柱", "日柱", "时柱"):
            self.assertIn(f"| {label} |", self.text)

    def test_element_counts_match_inventory(self):
        counts = self.facts["element_inventory"]["counts"]["hidden_stems"]
        for element, value in counts.items():
            self.assertIn(f"| {element} |", self.text)
            self.assertIn(str(value), self.text)

    def test_strength_numbers_rendered(self):
        strength = self.facts["derived_rules"]["strength"]
        self.assertIn(str(strength["supportPoints"]), self.text)
        self.assertIn(str(strength["opposingPoints"]), self.text)
        self.assertIn(strength["conclusion"], self.text)

    def test_pattern_primary_rendered(self):
        primary = self.facts["derived_rules"]["pattern"]["primaryCandidate"]
        self.assertIn(primary, self.text)

    def test_no_assertive_prediction_words(self):
        forbidden = ["一定", "必然", "必定", "绝对", "铁口直断", "百分百", "100%", "绝不会"]
        for word in forbidden:
            self.assertNotIn(word, self.text, f"出现断言词：{word}")

    def test_no_ziwei_content(self):
        # 开头那句「与紫微报告分开」是刻意的边界声明，不算混入；
        # 正文（从「## 一、」起）不得出现紫微术语。
        body = self.text.split("## 一、", 1)[-1]
        for word in ("紫微", "化忌", "化禄", "大限", "生年四化", "钦天门"):
            self.assertNotIn(word, body, f"八字报告正文混入紫微用语：{word}")

    def test_decadal_marks(self):
        self.assertIn("岁运并临", self.text)
        self.assertRegex(self.text, r"\| 2002 \|[^|]+\|[^|]+\|[^|]+\| 壬午 \|[^|]*\| 岁运并临 \|")
        self.assertRegex(self.text, r"\| 1996 \|[^|]+\|[^|]+\|[^|]+\| 壬午 \|[^|]*\| 天克地冲 \|")

    def test_annual_rows_match_coverage(self):
        coverage = self.facts["annual_cycle_coverage"]
        rows = re.findall(r"^\| (?:19|20|21)\d{2} \|", self.text, flags=re.M)
        self.assertEqual(len(rows), coverage["count"])

    def test_each_section_has_evidence_pointer(self):
        pointers = re.findall(r"^依据：`", self.text, flags=re.M)
        self.assertGreaterEqual(len(pointers), 8)

    def test_unsupported_scopes_listed(self):
        unsupported = self.facts["readiness"].get("unsupported_scopes") or []
        for scope in unsupported[:3]:
            self.assertIn(scope, self.text)

    def test_shensha_rows_match_records(self):
        records = self.facts["auxiliary_chart"]["shensha"]["value"]
        self.assertIn(f"神煞（{len(records)} 条", self.text)

    def test_render_is_deterministic(self):
        _, again = _build()
        strip = lambda t: re.sub(r"^生成时间：.*$", "", t, flags=re.M)
        self.assertEqual(strip(self.text), strip(again))

    def test_every_section_has_provenance_citation(self):
        # 八个事实节都要有「出处」行；第九节是局限、第十节是附录，不需要
        cited = re.findall(r"^出处：《", self.text, flags=re.M)
        self.assertGreaterEqual(len(cited), 8, f"出处行只有 {len(cited)} 条")

    def test_provenance_appendix_present(self):
        self.assertIn("## 十、条款出处", self.text)
        self.assertIn("全部 anchor 都在知识包里逐条命中", self.text)

    def test_no_dangling_anchor_in_report(self):
        # 映射写错会在「出处」行里留下「未收录：」或附录里列出悬空项
        self.assertNotIn("未收录：", self.text)
        self.assertNotIn("查不到", self.text)

    def test_anchor_json_matches_knowledge_package(self):
        import json
        from pathlib import Path

        root = Path(renderer.__file__).resolve().parent.parent
        shared = json.loads(
            (root / "knowledge" / "bazi" / "scope-anchors.json").read_text(encoding="utf-8")
        )
        entries, scopes, note = renderer.load_anchor_maps()
        self.assertIsNone(note)
        self.assertEqual(set(scopes), set(shared["scopes"]))
        for scope, anchors in shared["scopes"].items():
            for anchor in anchors:
                with self.subTest(scope=scope, anchor=anchor):
                    self.assertIn(anchor, entries)

    def test_citation_format_matches_knowledge_layer(self):
        # 与 web/bazi-knowledge.js::citationOf 保持同一格式，AI 侧才能逐字对上
        self.assertIn("bazi-skill@112a5d84（MIT）", self.text)
        self.assertRegex(self.text, r"《滴天髓·旺衰判断原则》，bazi-skill@112a5d84（MIT）")


if __name__ == "__main__":
    unittest.main(verbosity=2)
