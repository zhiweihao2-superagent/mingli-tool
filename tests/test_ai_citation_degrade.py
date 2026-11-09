"""逐主题资料引用的降级纪律：首轮严格拒绝，重试后显式降级、绝不杜撰出处。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from mingli_tool import web  # noqa: E402


def _contract():
    return {
        "schemaVersion": "mingli-ai-input/v1",
        "mode": "facts-only",
        "systems": {
            "ziwei": {
                "fingerprint": "zw-test",
                "facts": {
                    "validation": {"status": "pass"},
                    "readiness": {"ai_may_interpret": True},
                    "palaces": {"子女宫": {"name": "子女宫", "majorStars": ["贪狼"]}},
                },
            }
        },
        "knowledge": {
            "status": "ok",
            "entries": [
                {"anchor": "紫微星性-贪狼", "citation": "紫微星性-贪狼", "text": "贪狼主变化与欲望。"},
                {"anchor": "紫微宫位-子女", "citation": "紫微宫位-子女", "text": "子女宫主缘分与教养。"},
            ],
        },
    }


def _output(section_citations):
    return {
        "schemaVersion": "mingli-ai-interpretation/v1",
        "status": "ok",
        "mode": "model",
        "summary": {
            "plainLanguage": "整体看子女缘分偏内敛。",
            "evidencePaths": ["/systems/ziwei/facts/palaces/子女宫"],
            "confidence": "medium",
        },
        "sections": [
            {
                "topic": "children",
                "kind": "interpretation",
                "title": "子女缘分",
                "plainLanguage": "亲子之间的交流偏向少说多做。",
                "evidencePaths": ["/systems/ziwei/facts/palaces/子女宫"],
                "confidence": "medium",
                "reflectionQuestion": "你上一次和孩子单独聊天是什么时候？",
                "oneLineSummary": "亲子交流少说多做。",
                "evidenceExplanation": "子女宫主星与辅星共同构成这条判断的依据。",
                "practicalAdvice": ["每周留一次不谈学习的闲聊"],
                "knowledgeCitations": list(section_citations),
            }
        ],
        "knowledgeCitations": list(section_citations),
        "limitations": ["仅覆盖子女宫。"],
    }


TOPIC_ANCHORS = {"children": ["紫微星性-贪狼", "紫微宫位-子女"]}


class CitationDegradeTests(unittest.TestCase):
    def test_strict_mode_still_rejects_missing_citations(self):
        with self.assertRaises(ValueError) as ctx:
            web._validate_ai_output(
                _contract(), _output([]), expected_topics=["children"], report_mode=True,
                topic_anchors=TOPIC_ANCHORS,
            )
        self.assertEqual(str(ctx.exception), "TOPIC_CITATIONS_REQUIRED")

    def test_strict_mode_rejects_foreign_citation(self):
        with self.assertRaises(ValueError) as ctx:
            web._validate_ai_output(
                _contract(), _output(["紫微星性-破军"]), expected_topics=["children"], report_mode=True,
                topic_anchors=TOPIC_ANCHORS,
            )
        self.assertEqual(str(ctx.exception), "KNOWLEDGE_CITATION_INVALID")

    def test_degrade_marks_section_without_inventing_citations(self):
        payload = _output([])
        audit = web._validate_ai_output(
            _contract(), payload, expected_topics=["children"], report_mode=True,
            topic_anchors=TOPIC_ANCHORS, allow_unsourced=True,
        )
        self.assertEqual(audit["status"], "pass")
        self.assertEqual(len(audit["unsourcedTopics"]), 1)
        self.assertEqual(audit["unsourcedTopics"][0]["topic"], "children")
        section = payload["sections"][0]
        self.assertEqual(section["knowledgeCitations"], [])
        self.assertIn("未标注资料引用", section["citationNote"])

    def test_valid_section_has_no_unsourced_flags(self):
        payload = _output(["紫微宫位-子女"])
        audit = web._validate_ai_output(
            _contract(), payload, expected_topics=["children"], report_mode=True,
            topic_anchors=TOPIC_ANCHORS, allow_unsourced=True,
        )
        self.assertNotIn("unsourcedTopics", audit)
        self.assertEqual(payload["sections"][0]["knowledgeCitations"], ["紫微宫位-子女"])
        self.assertNotIn("citationNote", payload["sections"][0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
