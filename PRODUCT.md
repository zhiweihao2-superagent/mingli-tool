# Product

<!-- impeccable:product-schema 1 -->

## Platform

当前：响应式网页原型。目标：微信小程序；原生小程序前端与线上计算 API 尚未实现。

## Stack

Inferred after the structured product question timed out: buildless HTML, CSS, and JavaScript served by a Python standard-library HTTP server. This keeps the first interface dependency-free and lets it call the existing Python calculation core directly. Hosting architecture remains an open decision because the current engine is Python and the target static hosting runtime cannot execute it unchanged.

## Users

Primary audience assumption pending confirmation: Chinese-speaking beginners who want to understand a BaZi chart without losing access to the underlying structured fields. Experienced users are secondary and can inspect the complete calculation details.

## Product Purpose

Provide a locally runnable, reproducible Chinese metaphysics tool whose deterministic calculation can be inspected independently from any AI-generated interpretation. One minimal birth profile can produce separate BaZi and Zi Wei Dou Shu results, each with provenance and explicit limits.

## Positioning

The product freezes the calculation engine and rule profile, distinguishes calculation facts from interpretation, and returns explicit warnings instead of silently inventing missing time or unsupported corrections.

## Operating Context

The first interface runs locally from this repository. A user enters birth date, time precision, timezone, and the traditional sex parameter once, then switches between BaZi and Zi Wei Dou Shu results. No account is required and the calculation core does not persist personal data.

## Capabilities and Constraints

- BaZi and a first deterministic Zi Wei Dou Shu chart are implemented in the web prototype.
- Solar and lunar dates are supported for 1900 through 2100.
- Time precision can be minute, branch, or unknown.
- Only `Asia/Shanghai` is supported.
- Optional longitude-based true solar time is supported for minute-level input; historical China DST is detected and only applied after explicit user confirmation.
- The engine is pinned to `jinchenma94/bazi-skill` commit `112a5d84cd1a001a0038cafca3be68d93e4c0cc9`.
- The Zi Wei Dou Shu browser engine is pinned to `SylarLong/iztro` `2.6.2` behind a project-owned adapter and rule profile.
- 当前入门解读使用固定文字模板，把日主、四柱十神、藏干、大运起算和流年天干关系翻译成白话，并说明每个关系能表达什么、不能表达什么；不推断身强弱、格局、吉凶或具体未来事件。
- 紫微斗数默认先展示六大生活主题的基础白话解读、盘面依据与自我核对问题；命宫、身宫、五行局、命主、身主、十二宫和星曜收进可展开的专业盘面。时辰未知时不生成，子时不明确时要求具体时间。
- 八字已生成 v1 AI 事实包，包含四柱、十神、藏干、干支关系、五行客观计数、大运/流年关系、结构指纹和校验；旺衰、格局、用神、调候仍作为未选择规则流派时的禁止推断项。
- 紫微斗数已生成 v4 AI 事实包，包含生年四化、对宫与三合、辅助周期、十二宫宫干飞化、化忌链、自化方向、完整大限，以及当前大限/流年/月/日/时的叠宫、四化、流曜、运限飞化、结构指纹和分层校验。
- 统一 AI 输入契约、越权范围拦截和本地 DeepSeek 网关已实现；追问、账号、支付和历史记录尚未实现。
- AI 解读输出协议与证据路径验证器已实现；用户授权后可生成同时引用八字和紫微事实的白话解读，模型输出必须通过结构、事实路径和安全措辞校验才会展示。
- `ziwei-skill` 仅作为非商业内部研究工具，不进入公开构建；其知识内容如用于商业产品需另行授权。
- 微信小程序是后续目标；输入以“日期 + 明确选择排盘性别”为主，年份和月份填满后自动跳格。出生时间对八字可留空，对紫微斗数为必要资料；大概时辰和闰月按需展开。
- Product name is undecided; the working label is “命理工具”.

## Evidence on Hand

- Real Python calculation engine and structured adapter in `src/mingli_tool/`.
- Eleven upstream regression tests and twelve adapter tests currently pass.
- Runnable example requests in `examples/`.
- No approved logo, brand photography, testimonials, pricing, or production deployment claims exist.

## Product Principles

- Calculation remains deterministic and independent from AI interpretation.
- Unknown data stays unknown; unsupported rules produce explicit errors.
- Results expose provenance, rule profile, and limitations.
- Personal data is minimized and never persisted by default.
- Beginners get progressive explanation without hiding professional fields.

## Accessibility & Inclusion

The interface must support keyboard navigation, visible focus, reduced motion, readable Chinese typography, 44-pixel touch targets, semantic form labels, and error recovery adjacent to the relevant field. Color must not be the only carrier of meaning.
