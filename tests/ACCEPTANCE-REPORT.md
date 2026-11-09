# 验收执行报告（自动生成）

由 `python scripts/verify_acceptance.py` 生成，请勿手改。

## 结论：15 条全部通过，整体回归通过

| 标准 | 内容 | 结果 | 证据 |
| --- | --- | --- | --- |
| AC01 | 12 个月且索引恰为 1..12（全范围） | **PASS** | test_ac01_twelve_months_cover_index_1_to_12_for_supported_years、test_ac01_every_supported_year_has_twelve_ordered_months |
| AC02 | 相邻相接、start<end、边界来源与时区 | **PASS** | test_ac02_boundaries_are_contiguous_ordered_and_labelled、test_ac02_every_supported_year_is_contiguous_and_self_consistent、test_ac02b_every_jie_lands_in_its_calendar_window |
| AC03 | 边界两侧分属不同干支柱 | **PASS** | test_ac03_boundary_instants_fall_into_different_months、test_ac03b_month_ganzhi_matches_engine_at_midpoint、test_ac03c_lichun_switches_year_pillar 等 20 项 |
| AC04 | 关系参与者可解析、成化候选字段齐全 | **PASS** | test_ac04_relation_participants_and_transformation_fields、test_ac04b_split_segments_keep_relations_and_scope_is_honest、test_ac04c_missing_qiyun_is_unavailable_not_zero 等 20 项 |
| AC05 | 紫微字段校验失败时不得标 validated | **PASS** | tests/acceptance_frontend.test.cjs::PASS AC5 |
| AC06 | 上下半年各 6 月、JSON Pointer 可解析 | **PASS** | test_ac06_half_years_and_every_pointer_resolves、test_ac06c_pointer_resolver_rejects_malformed_forms、test_ac06b_every_supported_year_has_resolvable_pointers |
| AC07 | 年柱取自目标年份、不依赖数组顺序 | **PASS** | test_ac07_package_year_binding_is_independent_of_array_order、test_ac07b_every_supported_year_uses_its_own_annual_pillar |
| AC08 | annual-timeline.js 的引入顺序与 defer | **PASS** | tests/acceptance_frontend.test.cjs::PASS AC8 |
| AC09 | 12 条月份记录含节气/干支/关系数/大运 | **PASS** | tests/acceptance_frontend.test.cjs::PASS AC9 |
| AC10 | 声明指纹、复算指纹与 match 可读 | **PASS** | tests/acceptance_frontend.test.cjs::PASS AC10 |
| AC11 | 未知时辰不建紫微流月 | **PASS** | tests/acceptance_frontend.test.cjs::PASS AC11 |
| AC12 | 四态展示与非空原因 | **PASS** | tests/acceptance_frontend.test.cjs::PASS AC12 |
| AC13 | 不触碰既有 20/6 主题报告与缓存 | **PASS** | tests/acceptance_frontend.test.cjs::PASS AC13 |
| AC14 | 提交失败/新提交清空旧时间轴 | **PASS** | tests/acceptance_frontend.test.cjs::PASS AC14 |
| AC15 | 回归测试存在且被记录 | **PASS** | tests/acceptance_frontend.test.cjs::PASS AC15 |

## 套件执行结果

| 套件 | 退出码 |
| --- | --- |
| `tests.test_acceptance_backend` | 0 |
| `tests.test_monthly_invariants` | 0 |
| `tests.test_monthly_determinism` | 0 |
| `tests.test_monthly_schema` | 0 |
| `tests.test_bazi_months` | 0 |
| `tests.test_bazi_adapter` | 0 |
| `tests.test_web_monthly_e2e` | 0 |
| `tests.test_web_server` | 0 |
| `tests.test_bazi_hidden_combine` | 0 |
| `tests.test_bazi_half_combines` | 0 |
| `tests.test_ziwei_segments` | 0 |
| `tests.test_interpretability` | 0 |
| `tests.test_shensha_rules` | 0 |
| `tests.test_ai_split_systems` | 0 |
| `tests.test_bazi_input_shapes` | 0 |
| `tests.test_bazi_report` | 0 |
| `tests/acceptance_frontend.test.cjs` | 0 |
| `tests/annual_timeline_dom.test.cjs` | 0 |
| `tests/annual_timeline_real.test.cjs` | 0 |
| `tests/annual_timeline.test.cjs` | 0 |
| `tests/annual_timeline_view.test.cjs` | 0 |
| `tests/annual_month_facts.test.cjs` | 0 |
| `tests/bazi_monthly_facts.test.cjs` | 0 |
| `tests/date_input.test.cjs` | 0 |
| `tests/interpretation.test.cjs` | 0 |
| `tests/ziwei_interpretation.test.cjs` | 0 |
| `tests/ai_contract.test.cjs` | 0 |
| `tests/ai_interpretation.test.cjs` | 0 |
| `tests/ziwei_adapter.test.cjs` | 0 |
| `tests/ziwei_brightness.test.cjs` | 0 |
| `tests/chartinfo_adapter.test.cjs` | 0 |
| `tests/report_archive.test.cjs` | 0 |
| `tests/overview.test.cjs` | 0 |
| `tests/home.test.cjs` | 0 |
| `tests/skill_context.test.cjs` | 0 |
| `tests/section16_gate.test.cjs` | 0 |
| `tests/decadal_annual_facts.test.cjs` | 0 |
| `tests/yingqi_ladder.test.cjs` | 0 |
| `tests/report_render.test.cjs` | 0 |
| `tests/specialty_rules.test.cjs` | 0 |
| `tests/section16_steps.test.cjs` | 0 |
| `tests/knowledge_compose.test.cjs` | 0 |
| `tests/ziwei_knowledge_digest.test.cjs` | 0 |
| `tests/bazi_knowledge.test.cjs` | 0 |
| `tests/report_export.test.cjs` | 0 |
| `tests/report_image.test.cjs` | 0 |
| `scripts/test_pai_pan.py` | 0 |

## 计划交付物

- 计划点名的文件：26 个，存在 26，缺失 0
  - 全部存在。

## 改动边界

- 未提供 `PAIR_ORIGIN_DIR`，跳过改动边界审计。

## 说明

- 后端 AC 的判定是「测试套件整体退出码为 0」＋「unittest 加载器里确实存在对应测试 id」。
  不用「源码里搜测试名」——那连注释掉或用例名出现在文档里都会算命中。
- 前端 AC 的判定是「套件退出码为 0」＋「输出里出现对应 `PASS ACn` 标签」。
- 加载器共枚举到 294 个后端测试 id。
- 引擎自测：Ran 11 tests
