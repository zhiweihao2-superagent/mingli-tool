"""服务端「一份合同只装一套体系」的硬约束。

用户定下的规矩：八字是八字，紫微是紫微，喂给模型时各喂一份，不许合成。
这条规矩如果只写在提示词里，模型一句"综合来看"就绕过去了，所以必须在服务端
校验层拦住——本文件就是那层门禁的断言。

覆盖：
  1. 双体系合同在入口即被拒（CONTRACT_MULTI_SYSTEM），不会跑到模型那一步；
  2. 单体系八字合同能通过入口校验；
  3. 每段必须引用本体系路径（SYSTEM_EVIDENCE_MISSING）；
  4. 八字必须自报判法口径，且口径要与合同一致
     （METHOD_STATEMENT_REQUIRED / METHOD_STATEMENT_MISMATCH）；
  5. 主题白名单里不再有 cross-system；
  6. 提示词按体系切换：八字多要 methodStatement，紫微不提。
"""

from __future__ import annotations

import unittest

from mingli_tool import web


def bazi_contract(system_only: bool = True) -> dict:
    systems = {
        "bazi": {
            "fingerprint": "bz-test",
            "ruleProfile": {"id": "ziping-month-command-audited-v2"},
            "chart": {"pillars": {}},
            "facts": {
                "validation": {"status": "pass"},
                "readiness": {"ai_may_interpret": True},
                "derived_rules": {"validation": {"status": "pass"}},
                "evidence": True,
            },
        }
    }
    if not system_only:
        systems["ziwei"] = {
            "fingerprint": "zw-test",
            "facts": {
                "validation": {"status": "pass"},
                "readiness": {"aiMayInterpret": True},
                "flyingValidation": {"status": "pass"},
                "periods": {"validation": {"decadal": {"status": "pass"}, "annual": {"status": "pass"}}},
                "fineTiming": {"status": "pass"},
                "evidence": True,
            },
        }
    return {
        "schemaVersion": "mingli-ai-input/v1",
        "mode": "facts-only",
        "systems": systems,
        "requestedScopes": ["bazi:pillars"],
        "scopeCatalog": {"supported": ["bazi:pillars"], "unsupported": []},
    }


def bazi_output(**overrides) -> dict:
    output = {
        "schemaVersion": "mingli-ai-interpretation/v1",
        "status": "ok",
        "mode": "model",
        "summary": {
            "plainLanguage": "四柱给出阅读起点。",
            "evidencePaths": ["/systems/bazi/facts/evidence"],
            "confidence": "medium",
        },
        "sections": [
            {
                "topic": "self",
                "kind": "interpretation",
                "title": "自己的反应方式",
                "plainLanguage": "日主偏刚，遇事倾向先立规矩。",
                "evidencePaths": ["/systems/bazi/facts/evidence"],
                "confidence": "medium",
                "reflectionQuestion": "遇到新任务时你先立规矩还是先动手？",
            }
        ],
        "limitations": ["只解释已校验结构。"],
        "methodStatement": "据子平月令派规则档案 ziping-month-command-audited-v2 计算，保留候选与破格条件。",
    }
    output.update(overrides)
    return output


class MultiSystemContractTest(unittest.TestCase):
    def test_rejects_contract_carrying_two_systems(self):
        with self.assertRaises(ValueError) as ctx:
            web._validate_ai_contract(bazi_contract(system_only=False))
        self.assertEqual(str(ctx.exception), "CONTRACT_MULTI_SYSTEM")

    def test_accepts_single_system_contract(self):
        web._validate_ai_contract(bazi_contract())  # 不抛异常即通过

    def test_cross_system_topic_is_gone(self):
        self.assertNotIn("cross-system", web.AI_TOPICS)
        self.assertIn("self", web.AI_TOPICS)


class OutputDisciplineTest(unittest.TestCase):
    def setUp(self):
        self.contract = bazi_contract()

    def test_happy_path_passes(self):
        audit = web._validate_ai_output(self.contract, bazi_output())
        self.assertEqual(audit["status"], "pass")
        self.assertGreaterEqual(audit["evidenceCount"], 2)

    def test_block_without_own_system_evidence_is_rejected(self):
        output = bazi_output()
        output["summary"]["evidencePaths"] = ["/mode"]
        with self.assertRaises(ValueError) as ctx:
            web._validate_ai_output(self.contract, output)
        self.assertEqual(str(ctx.exception), "SYSTEM_EVIDENCE_MISSING")

    def test_bazi_without_method_statement_is_rejected(self):
        output = bazi_output()
        output.pop("methodStatement")
        with self.assertRaises(ValueError) as ctx:
            web._validate_ai_output(self.contract, output)
        self.assertEqual(str(ctx.exception), "METHOD_STATEMENT_REQUIRED")

    def test_method_statement_must_match_rule_profile(self):
        with self.assertRaises(ValueError) as ctx:
            web._validate_ai_output(self.contract, bazi_output(methodStatement="据某派口径计算。"))
        self.assertEqual(str(ctx.exception), "METHOD_STATEMENT_MISMATCH")

    def test_unresolvable_evidence_is_rejected(self):
        output = bazi_output()
        output["sections"][0]["evidencePaths"] = ["/systems/bazi/facts/nope"]
        with self.assertRaises(ValueError) as ctx:
            web._validate_ai_output(self.contract, output)
        self.assertEqual(str(ctx.exception), "EVIDENCE_VALIDATION_FAILED")


class PromptSplitTest(unittest.TestCase):
    def _prompt(self, contract, knowledge=None):
        system = next(iter(contract["systems"]))
        profile_id = ((contract["systems"].get("bazi") or {}).get("ruleProfile") or {}).get("id") or ""
        request = web._make_report_request(
            "test-model", {"topics": []}, ["/systems/bazi/facts/evidence"], ["bazi-foundation"],
            compact=True, system=system, rule_profile_id=profile_id, knowledge=knowledge,
        )
        # 提示词分两条消息：system 里是纪律，user 里是事实与原文摘录。
        # 断言检查全文，否则会漏掉只写在 user 侧的内容。
        return chr(10).join(message["content"] for message in request["messages"])

    def test_bazi_prompt_requires_method_statement(self):
        prompt = self._prompt(bazi_contract())
        self.assertIn("methodStatement", prompt)
        self.assertIn("ziping-month-command-audited-v2", prompt)
        self.assertIn("只解读八字", prompt)
        self.assertNotIn("cross-system", prompt)

    def test_ziwei_prompt_has_no_method_statement(self):
        contract = bazi_contract(system_only=False)
        contract["systems"] = {"ziwei": contract["systems"]["ziwei"]}
        prompt = self._prompt(contract)
        self.assertIn("只解读紫微", prompt)
        self.assertNotIn("methodStatement", prompt)


def knowledge_digest(anchors=("十神定义及生克关系/十神推导规则",)) -> dict:
    return {
        "schema": "mingli.bazi-knowledge-digest/v1",
        "status": "ok",
        "scopes": [
            {
                "scope": "bazi:ten-gods",
                "status": "ok",
                "sections": [
                    {"anchor": anchor, "citation": "《子平真诠·用神与相神》，bazi-skill@112a5d84（MIT）", "text": "正文摘录"}
                    for anchor in anchors
                ],
            }
        ],
    }


def ziwei_output(**overrides) -> dict:
    """紫微侧输出：没有 methodStatement，但同样要带本体系证据。"""
    output = {
        "schemaVersion": "mingli-ai-interpretation/v1",
        "status": "ok",
        "mode": "model",
        "summary": {
            "plainLanguage": "紫微盘给出阅读起点。",
            "evidencePaths": ["/systems/ziwei/facts/evidence"],
            "confidence": "medium",
        },
        "sections": [{
            "topic": "career",
            "kind": "interpretation",
            "title": "工作方式",
            "oneLineSummary": "先看投入方式。",
            "plainLanguage": "官禄宫的主星记录为天相，适合观察责任分配。",
            "evidenceExplanation": "按宫位与主星查表。",
            "evidencePaths": ["/systems/ziwei/facts/evidence"],
            "confidence": "medium",
            "practicalAdvice": ["记录一次真实的取舍", "对照三个月后的结果"],
            "reflectionQuestion": "你判断长期投入时最看重什么？",
        }],
        "limitations": ["只解读紫微一套体系。"],
    }
    output.update(overrides)
    return output


class KnowledgeCitationTest(unittest.TestCase):
    """知识层纪律：带了古籍摘录，就必须标明用了哪一节，且不许编 anchor。"""

    def setUp(self):
        self.contract = bazi_contract()
        self.contract["knowledge"] = knowledge_digest()

    def test_citation_required_when_digest_present(self):
        with self.assertRaises(ValueError) as ctx:
            web._validate_ai_output(self.contract, bazi_output())
        self.assertEqual(str(ctx.exception), "KNOWLEDGE_CITATIONS_REQUIRED")

    def test_unknown_anchor_is_rejected(self):
        with self.assertRaises(ValueError) as ctx:
            web._validate_ai_output(
                self.contract,
                bazi_output(knowledgeCitations=["不存在的典籍/不存在的小节"]),
            )
        self.assertEqual(str(ctx.exception), "KNOWLEDGE_CITATION_INVALID")

    def test_known_anchor_passes(self):
        audit = web._validate_ai_output(
            self.contract,
            bazi_output(knowledgeCitations=["十神定义及生克关系/十神推导规则"]),
        )
        self.assertEqual(audit["status"], "pass")

    def test_empty_citation_list_is_allowed(self):
        # 整批用不上摘录时允许写 []，但字段必须存在——不存在和「明确没用」是两件事
        audit = web._validate_ai_output(self.contract, bazi_output(knowledgeCitations=[]))
        self.assertEqual(audit["status"], "pass")

    def test_contract_without_digest_needs_no_citation(self):
        contract = bazi_contract()
        audit = web._validate_ai_output(contract, bazi_output())
        self.assertEqual(audit["status"], "pass")

    def test_prompt_carries_digest_only_for_bazi(self):
        prompt = PromptSplitTest._prompt(self, bazi_contract(), knowledge=knowledge_digest())
        self.assertIn("knowledgeCitations", prompt)
        self.assertIn("十神定义及生克关系/十神推导规则", prompt)
        self.assertIn("八字古籍原文摘录", prompt)

    def test_ziwei_prompt_carries_digest_too(self):
        # 两套体系都要「解读带出处」：紫微侧换成查表断语摘录，纪律同一条
        contract = bazi_contract(system_only=False)
        contract["systems"] = {"ziwei": contract["systems"]["ziwei"]}
        prompt = PromptSplitTest._prompt(self, contract, knowledge=knowledge_digest())
        self.assertIn("knowledgeCitations", prompt)
        self.assertIn("紫微查表断语与星性摘录", prompt)
        self.assertNotIn("八字古籍原文摘录", prompt)

    def test_ziwei_entry_anchors_are_accepted(self):
        # 紫微摘录是扁平 entries：锚点与出处串都要能通过校验
        contract = bazi_contract(system_only=False)
        contract["systems"] = {"ziwei": contract["systems"]["ziwei"]}
        contract["knowledge"] = {
            "schema": "mingli.ziwei-knowledge-digest/v1",
            "status": "ok",
            "entries": [{
                "anchor": "ziwei.knowledge.太阳.财帛宫",
                "citation": "钦天门紫微斗数 SKILL v7.7·太阳·财帛宫",
                "text": "庙旺逢生年忌又自化禄，构成矛盾架构",
            }],
            "anchors": ["ziwei.knowledge.太阳.财帛宫"],
        }
        output = ziwei_output()
        output["knowledgeCitations"] = ["ziwei.knowledge.太阳.财帛宫"]
        self.assertEqual(web._validate_ai_output(contract, output)["status"], "pass")
        # 出处串逐字相等也放行：它由锚点唯一决定，编造的书名进不来
        output["knowledgeCitations"] = ["钦天门紫微斗数 SKILL v7.7·太阳·财帛宫"]
        self.assertEqual(web._validate_ai_output(contract, output)["status"], "pass")
        output["knowledgeCitations"] = ["《紫微斗数全书·财帛》"]
        with self.assertRaises(ValueError) as ctx:
            web._validate_ai_output(contract, output)
        self.assertEqual(str(ctx.exception), "KNOWLEDGE_CITATION_INVALID")


class TopicCitationTest(unittest.TestCase):
    """逐主题引用：整份数组证明不了「这张卡用的是这条」，所以每段单独标明。

    主题清单由服务端自己从 knowledge + reportPlan 重算，不采信客户端传来的值。
    """

    def setUp(self):
        self.contract = bazi_contract()
        # 两条 anchor 分属两个 scope：主题分配才看得出「取的是自己那一条」
        self.contract["knowledge"] = {
            "schema": "mingli.bazi-knowledge-digest/v1",
            "status": "ok",
            "scopes": [
                {
                    "scope": "bazi:ten-gods",
                    "status": "ok",
                    "sections": [{
                        "anchor": "十神定义及生克关系/十神推导规则",
                        "citation": "《子平真诠·用神与相神》，bazi-skill@112a5d84（MIT）",
                        "text": "十神以日干为主。",
                    }],
                },
                {
                    "scope": "bazi:natal-relations",
                    "status": "ok",
                    "sections": [{
                        "anchor": "地支关系/六冲",
                        "citation": "《渊海子平·六冲》，bazi-skill@112a5d84（MIT）",
                        "text": "六冲者，地支相冲。",
                    }],
                },
            ],
        }
        self.contract["reportPlan"] = {
            "schemaVersion": "mingli-report-plan/v2",
            "topics": [
                {"id": "bazi-foundation", "title": "八字基础结构", "system": "bazi", "knowledgeAnchors": [], "evidence": []},
                {"id": "bazi-relations", "title": "原局合冲刑害", "system": "bazi", "knowledgeAnchors": [], "evidence": []},
            ],
            "patternCandidates": [],
            "patternCandidateCount": 0,
        }
        self.specs = web._report_topic_specs(self.contract, ["bazi-foundation", "bazi-relations"])

    def _anchors(self):
        return web._topic_knowledge_anchors(self.contract["knowledge"], self.specs)

    def _output(self, citations, topic="bazi-foundation"):
        output = bazi_output(knowledgeCitations=["十神定义及生克关系/十神推导规则"])
        section = dict(output["sections"][0])
        section["topic"] = topic
        if citations is not _MISSING:
            section["knowledgeCitations"] = citations
        output["sections"] = [section]
        return output

    def test_topic_map_follows_scope_mapping(self):
        anchors = self._anchors()
        self.assertEqual(anchors["bazi-foundation"], ["十神定义及生克关系/十神推导规则"])
        self.assertEqual(anchors["bazi-relations"], ["地支关系/六冲"])

    def test_topic_without_mapping_gets_empty_list(self):
        specs = web._report_topic_specs(self.contract, ["bazi-relations"])
        specs[0]["id"] = "bazi-climate"
        self.assertEqual(web._topic_knowledge_anchors(self.contract["knowledge"], specs)["bazi-climate"], [])

    def test_ziwei_topic_map_is_palace_based(self):
        knowledge = {"entries": [
            {"anchor": "ziwei.knowledge.贪狼.官禄宫", "kind": "palace-reading", "star": "贪狼", "palace": "官禄宫"},
            {"anchor": "ziwei.nature.贪狼", "kind": "star-nature", "star": "贪狼", "palace": None},
            {"anchor": "ziwei.knowledge.武曲.夫妻宫", "kind": "palace-reading", "star": "武曲", "palace": "夫妻宫"},
        ]}
        specs = [{"id": "career", "system": "ziwei", "palace": "官禄宫"}]
        self.assertEqual(
            web._topic_knowledge_anchors(knowledge, specs)["career"],
            ["ziwei.knowledge.贪狼.官禄宫", "ziwei.nature.贪狼"],
        )

    def test_missing_section_citations_is_rejected(self):
        with self.assertRaises(ValueError) as ctx:
            web._validate_ai_output(self.contract, self._output(_MISSING), topic_anchors=self._anchors())
        self.assertEqual(str(ctx.exception), "TOPIC_CITATIONS_REQUIRED")

    def test_empty_section_citations_is_rejected_when_topic_has_anchors(self):
        with self.assertRaises(ValueError) as ctx:
            web._validate_ai_output(self.contract, self._output([]), topic_anchors=self._anchors())
        self.assertEqual(str(ctx.exception), "TOPIC_CITATIONS_REQUIRED")

    def test_missing_section_citations_is_fine_when_topic_has_no_anchors(self):
        # 年度主题这类没有专属摘录的主题：省略字段与写 [] 等价，不能判成"没标引用"。
        output = self._output(_MISSING, topic="annual-overview")
        audit = web._validate_ai_output(
            self.contract, output,
            expected_topics=["annual-overview"],
            topic_anchors={"annual-overview": []},
        )
        self.assertEqual(audit["status"], "pass")
        self.assertEqual(output["sections"][0]["knowledgeCitations"], [])

    def test_other_topic_anchor_alone_is_rejected(self):
        with self.assertRaises(ValueError) as ctx:
            web._validate_ai_output(
                self.contract, self._output(["地支关系/六冲"]), topic_anchors=self._anchors(),
            )
        self.assertEqual(str(ctx.exception), "TOPIC_CITATION_MISMATCH")

    def test_own_anchor_passes(self):
        audit = web._validate_ai_output(
            self.contract,
            self._output(["十神定义及生克关系/十神推导规则"]),
            topic_anchors=self._anchors(),
        )
        self.assertEqual(audit["status"], "pass")

    def test_unknown_anchor_still_rejected(self):
        with self.assertRaises(ValueError) as ctx:
            web._validate_ai_output(
                self.contract, self._output(["编造的章节"]), topic_anchors=self._anchors(),
            )
        self.assertEqual(str(ctx.exception), "KNOWLEDGE_CITATION_INVALID")

    def test_topic_without_anchors_may_cite_nothing(self):
        # 主题自己的清单为空（该宫无断语 / scope 无章节）时，不硬造主题级要求
        self.contract["reportPlan"]["topics"][0]["id"] = "bazi-climate"
        specs = web._report_topic_specs(self.contract, ["bazi-climate"])
        audit = web._validate_ai_output(
            self.contract, self._output([], topic="bazi-climate"),
            topic_anchors=web._topic_knowledge_anchors(self.contract["knowledge"], specs),
        )
        self.assertEqual(audit["status"], "pass")

    def test_prompt_lists_per_topic_anchors(self):
        request = web._make_report_request(
            "test-model", {"topics": []}, ["/systems/bazi/facts/evidence"], ["bazi-foundation"],
            compact=True, system="bazi", rule_profile_id="ziping-month-command-audited-v2",
            knowledge=self.contract["knowledge"], topic_anchors=self._anchors(),
        )
        prompt = chr(10).join(message["content"] for message in request["messages"])
        self.assertIn("每个主题自己的 anchor 清单", prompt)
        self.assertIn("section.knowledgeCitations", prompt)
        self.assertIn("十神定义及生克关系/十神推导规则", prompt)


    def test_prompt_requires_plain_language(self):
        # 用户的原话是「AI 解读晦涩难懂」；这些约束是那一轮的整改，删掉就等于退回教材腔。
        request = web._make_report_request(
            "test-model", {"topics": []}, ["/systems/bazi/facts/evidence"], ["bazi-foundation"],
            compact=True, system="bazi", rule_profile_id="ziping-month-command-audited-v2",
        )
        prompt = chr(10).join(message["content"] for message in request["messages"])
        self.assertIn("写作要求", prompt)
        self.assertIn("完全不懂命理的人写信", prompt)
        self.assertIn("全程用「你」称呼对方", prompt)
        self.assertIn("plainLanguage 固定三段", prompt)
        self.assertIn("oneLineSummary 是这个主题的人话标题", prompt)
        self.assertIn("术语每 150 字最多出现一个", prompt)
        self.assertIn("plainLanguage 里不许出现这些词", prompt)
        self.assertIn("证据、校验、候选、契约、路径", prompt)
        self.assertIn("practicalAdvice 每条以动词开头", prompt)
        self.assertNotIn("four 不许出现", prompt)

_MISSING = object()

class KnowledgeCitationRollupTest(unittest.TestCase):
    """顶层 knowledgeCitations 是逐段引用的并集。

    真机跑出来的失败形态：每个 section 都老老实实写了 knowledgeCitations，
    顶层却漏了或写成 []，于是整批被判 KNOWLEDGE_CITATIONS_REQUIRED。
    补齐只做「按出现顺序去重合并」，元素仍要逐字过白名单，不放宽任何一条。
    """

    def _output(self, sections, top=_MISSING):
        output = {"sections": sections}
        if top is not _MISSING:
            output["knowledgeCitations"] = top
        return web._rollup_knowledge_citations(output)

    def test_missing_top_level_uses_section_union(self):
        output = self._output([
            {"knowledgeCitations": ["甲/一", "甲/二"]},
            {"knowledgeCitations": ["乙/一"]},
        ])
        self.assertEqual(output["knowledgeCitations"], ["甲/一", "甲/二", "乙/一"])

    def test_empty_top_level_is_filled(self):
        output = self._output([{"knowledgeCitations": ["甲/一"]}], top=[])
        self.assertEqual(output["knowledgeCitations"], ["甲/一"])

    def test_existing_top_level_is_kept(self):
        output = self._output([{"knowledgeCitations": ["甲/一"]}], top=["乙/一"])
        self.assertEqual(output["knowledgeCitations"], ["乙/一"])

    def test_union_keeps_first_occurrence_order(self):
        output = self._output([
            {"knowledgeCitations": ["丙/一", "甲/一"]},
            {"knowledgeCitations": ["甲/一", "乙/一"]},
        ])
        self.assertEqual(output["knowledgeCitations"], ["丙/一", "甲/一", "乙/一"])

    def test_sections_without_citations_contribute_nothing(self):
        output = self._output([
            {"knowledgeCitations": []},
            {"knowledgeCitations": ["甲/一"]},
            {},
            {"knowledgeCitations": "甲/二"},
        ])
        self.assertEqual(output["knowledgeCitations"], ["甲/一"])

    def test_nothing_to_roll_up_still_materializes_empty_list(self):
        # 字段缺失与「没引用」是两件事：后者写作 []，前者会被判成没标引用。
        output = self._output([{}, {}])
        self.assertEqual(output["knowledgeCitations"], [])

    def test_non_dict_input_is_returned_as_is(self):
        for value in ([], "x", None, 3):
            self.assertEqual(web._rollup_knowledge_citations(value), value)

    def test_sections_not_a_list_is_returned_as_is(self):
        output = {"sections": "oops", "knowledgeCitations": []}
        self.assertEqual(web._rollup_knowledge_citations(output), output)

    def test_prompt_states_top_level_is_union(self):
        contract = bazi_contract()
        contract["knowledge"] = {
            "schema": "mingli.bazi-knowledge-digest/v1",
            "status": "ok",
            "scopes": [{
                "scope": "bazi:ten-gods",
                "status": "ok",
                "sections": [{
                    "anchor": "十神定义及生克关系/十神推导规则",
                    "citation": "《子平真诠·用神与相神》，bazi-skill@112a5d84（MIT）",
                    "text": "十神以日干为主。",
                }],
            }],
        }
        request = web._make_report_request(
            "test-model", {"topics": []}, ["/systems/bazi/facts/evidence"], ["bazi-foundation"],
            compact=True, system="bazi", rule_profile_id="ziping-month-command-audited-v2",
            knowledge=contract["knowledge"],
        )
        prompt = chr(10).join(message["content"] for message in request["messages"])
        self.assertIn("并集", prompt)

if __name__ == "__main__":
    unittest.main()
