# 第三方来源

## jinchenma94 bazi skill

- 仓库：https://github.com/jinchenma94/bazi-skill
- 固定提交：`112a5d84cd1a001a0038cafca3be68d93e4c0cc9`
- 许可证：MIT
- 用途：八字历法、四柱、大运、流年与神煞计算；上游回归测试
- 保留位置：`scripts/pai_pan.py`、`scripts/test_pai_pan.py`、`references/`、`SKILL.md`
- 原始版权：Copyright (c) 2025 jinchenma94

项目保留了上游 MIT 许可证全文。适配层没有把参考资料中的经典摘要作为自动解读语料；未来若启用模型解读，需要另行审阅每项资料的来源、准确性和可再分发范围。

## SylarLong iztro

- 仓库：https://github.com/SylarLong/iztro
- 固定版本：`2.6.2`
- 浏览器文件 SHA-256：`1A3C2E19E266FEAC498982423636131B7AE24226FC1BC7BF5E3A25286A78C5FB`
- 许可证：MIT
- 用途：紫微斗数十二宫、星曜、四化基础字段和大限数据的确定性计算
- 保留位置：`web/vendor/iztro-v2.6.2.min.js`、`dist/vendor/iztro-v2.6.2.min.js`
- 原始版权：Copyright (c) 2023 All Contributors

`ziwei-skill` 已安装为开发环境中的内部研究工具，但其知识内容采用 CC BY-NC-SA 4.0，本仓库与公开构建没有复制、打包或运行其中的解读材料。商业产品如需采用该知识内容，必须另行取得授权。

## Renhuai123 ziwei-doushu

- 仓库：https://github.com/Renhuai123/ziwei-doushu
- 审计提交：`e478393ad6c865ad6270e978a3164d2f2cb5315b`
- 许可证：MIT
- 用途：紫微排盘能力清单、真太阳时流程、中国大陆历史夏令时日期表、13 主题标签及公开格局识别规则的对照与适配实现
- 适配代码：`web/vendor/renhuai-patterns.js`（由 `lib/ziwei/patterns.ts` 浏览器化编译，文件头保留来源）
- 原始版权：Copyright (c) 2026 紫微研究

项目没有嵌入其整站代码。公开的格局识别器依据 MIT 许可适配；13 个公开主题标签用于报告目录。上游未开源的 14 主星详细论断库没有被复制、推测或冒充。

## qilaidev metaphysics-engine

- 仓库：https://github.com/qilaidev/metaphysics-engine
- 固定提交：`7631af8ddcd8bf2941fc00006c724c3b5de28fba`
- 许可证：MIT
- 用途：八字藏干归一权重、月令倍数、旺衰阈值、严格从格/专旺格判据、子平月令取格顺序，以及十日干×十二月支调候速查表
- 适配代码：`src/mingli_tool/bazi_rules.py`、`src/mingli_tool/bazi.py`
- 原始版权：Copyright (c) 2024-2026 tytsxai

项目只适配确定性规则与机器可读表，不复制其服务端或前端。调候表按上游声明作为《穷通宝鉴》通行简表使用，不冒充唯一刊本或经典逐字原文。

上述适配部分适用的 MIT 许可：允许使用、复制、修改、合并、发布、分发、再许可和销售，但须保留版权与许可声明；软件按原样提供，不附带任何明示或默示担保。完整许可原文见上游仓库 `LICENSE`，其版权声明为 Copyright (c) 2026 紫微研究。
