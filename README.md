# 命理工具

一个可复现的命理计算工具。当前网页版本可用同一份出生资料生成八字与紫微斗数结果：八字包含逐柱、大运和流年白话说明，紫微斗数包含基础信息与十二宫可核对排盘。两套结果都由固定版本的确定性引擎完成。微信小程序是目标端；目前 AI 解读可通过本机服务连接 DeepSeek，账号和历史记录尚未实现。

> 本项目仅用于传统文化学习与娱乐参考，不构成医疗、法律、投资或其他现实决策建议。

## 当前能力

- 公历和农历输入
- 年份填满后自动进入月份，月份填满后自动进入日期；支持退格回退与粘贴八位日期
- 出生时间可选填；可使用分钟、仅知道时辰或未知时辰三种精度
- 北京时间 `Asia/Shanghai`
- 四柱、十神、藏干、大运、流年和神煞结构化 JSON
- 紫微斗数默认提供六大生活主题白话解读、盘面依据与自我核对问题，专业十二宫和星曜结果可按需展开
- 八字 v1 AI 事实包冻结四柱、十神、藏干、干支合冲刑害破、五行客观计数、大运/流年关系、结构指纹和硬性校验；未选择规则档案时不会伪造旺衰、格局或用神结论
- 紫微 v4 AI 事实包冻结生年四化、对宫与三合、十二宫宫干飞化、化忌链、自化向心/离心方向、完整大限，以及当前大限、流年、流月、流日、流时的叠宫、四化、流曜、运限飞化、结构指纹和分层校验
- `mingli-ai-input/v1` 统一 AI 输入契约已完成；它只打包通过校验的确定性事实，并会拒绝未实现的解读范围
- `mingli-ai-interpretation/v1` 输出协议、证据路径验证器和本机 DeepSeek 接口已接入；模型输出会在本机再次校验后才展示
- 排盘后按日主、年/月/日/时柱逐项展示传统术语的白话解释；缺失时辰不猜补
- 逐步说明起运、大运排序与流年；按实际干支和日主关系翻译观察主题，不预测具体事件
- 稳定错误码和警告码
- 引擎版本、规则口径和验证范围记录
- 桌面与移动端自适应的网页工作台（用于验证小程序输入流程）
- 可持续访问的静态公网版本
- 服务端版本零运行时第三方依赖

当前仅支持北京时间；填写出生地经度和分钟级时间后可启用统一真太阳时校正，历史夏令时会提醒并只在用户确认后扣除一小时。出生地不是必填，不填则按北京时间排盘。紫微斗数需要出生时辰；未知时间不会生成命盘，仅选择“子时”时会要求补充具体时间以区分跨日边界。八字的旺衰、格局、用神和调候属于解释规则而非排盘原始事实，现阶段明确标记为不支持，AI 不得自行补算。小程序原生界面、用户层和线上正式部署仍待实现。

## 快速开始

需要 Python 3.10 或更高版本。

首次测试 AI 前，在项目根目录的 `.env` 文件中填写 DeepSeek API Key（不要把密钥放到网页代码、聊天或 GitHub）：

```text
DEEPSEEK_API_KEY=粘贴你的DeepSeek_API_Key
DEEPSEEK_MODEL=deepseek-flash
```

`.env` 已加入 Git 忽略规则。本机服务每次请求时读取该文件；保存后无需重启。授权生成解读时，出生日期、时辰、排盘性别和盘面事实会经本机服务发送给 DeepSeek。若不配置密钥，排盘仍可正常使用，AI 功能会提示尚未配置。

启动网页工作台：

```powershell
python web_tool.py
```

然后打开 `http://127.0.0.1:8765`。页面会调用同一套真实排盘引擎，不包含硬编码结果。服务仅监听本机地址 `127.0.0.1`，其他设备无法通过网络访问。

静态构建位于 `dist/`；本机 AI 密钥只用于本机 Python 服务，不应放入静态构建或发布站点。

使用 JSON 命令行：

```powershell
python tool.py bazi calculate --input examples/bazi_known_time.json
python tool.py bazi calculate --input examples/bazi_unknown_time.json --pretty
```

安装后也可以使用命令行入口：

```powershell
python -m pip install -e .
mingli bazi calculate --input examples/bazi_known_time.json --pretty
```

标准输入同样受支持：

```powershell
Get-Content examples/bazi_known_time.json -Raw | python tool.py bazi calculate --input -
```

正常和错误结果都会返回机器可读 JSON。成功退出码为 `0`，输入或规则错误为 `2`，未预期的引擎错误为 `3`。

## 测试

```powershell
python scripts/test_pai_pan.py
python -m unittest discover -s tests -v
```

第一条命令原样运行固定上游的 11 项回归测试；第二条运行本项目适配层测试。验证范围和限制见 [验证记录](docs/verification.md) 与 [已知限制](docs/limitations.md)。

检查公网静态构建：

```powershell
node --check dist/engine-loader.js
node --check dist/app.js
node --check dist/ziwei-facts.js
node tests/date_input.test.cjs
node tests/ziwei_adapter.test.cjs
node tests/ai_contract.test.cjs
node tests/ai_interpretation.test.cjs
```

## 设计原则

数据流为：输入校验 → 规则标准化 → 固定排盘引擎 → 统一结构化结果 → 事实校正与硬性校验 → 独立的展示或解释层。八字模板解释盘面已有的日主、十神、藏干，以及大运/流年天干与日主的传统关系；紫微基础解读把六个关键宫位与十四主星翻译成日常观察问题，同时明确展示盘面依据，不以单颗星预测吉凶或具体事件。未来的模型解读只能读取通过校验且带结构指纹的冻结结果，不能覆盖或重算四柱、十二宫、四化或运限。

详细资料：

- [架构](docs/architecture.md)
- [输入输出协议](docs/input-output.md)
- [计算规则](docs/calculation-rules.md)
- [AI 接入就绪边界](docs/ai-readiness.md)
- [AI 解读输出协议](docs/ai-interpretation-protocol.md)
- [第三方来源](THIRD_PARTY_NOTICES.md)

## 上游来源

八字引擎基于 MIT 许可的 [`jinchenma94/bazi-skill`](https://github.com/jinchenma94/bazi-skill)，固定提交为 `112a5d84cd1a001a0038cafca3be68d93e4c0cc9`。原始算法与回归测试保留在 `scripts/` 中，适配层位于 `src/mingli_tool/`。

紫微斗数网页引擎基于 MIT 许可的 [`SylarLong/iztro`](https://github.com/SylarLong/iztro)，固定为 `2.6.2`。项目通过 `web/ziwei-adapter.js` 转换为自己的稳定结构，不让页面组件直接依赖第三方原始字段。

## 微信小程序原型（design/miniprogram）

`design/miniprogram/` 是可在浏览器里直接跑的十二屏原型（静态 HTML + 原生 JS，无构建步骤），
用来先定交互与信息结构，后续再转成 uni-app / 原生小程序：

| 屏 | 文件 | 说明 |
| --- | --- | --- |
| 今日 | `home.html` | 今日干支、公历农历对、三张盘的快捷入口、最近解读 |
| 出生信息 | `input.html` | 公历/农历、闰月、三种时辰精度、出生地与真太阳时 |
| 八字 | `bazi.html` | 四柱、藏干、纳音、五行、旺衰·格局·调候·用神候选、神煞、大运、流年 |
| 紫微 | `ziwei.html` | 十二宫、中宫、四化、大运、重点宫位；宫格可点进详情 |
| 宫位详情 | `palace.html` | 单宫的主星/辅星/对宫/大限 |
| 年度 | `annual.html` | 流年干支、与四柱关系、十二流月、六主题 |
| 时间坐标 | `cycle.html` | 单步大运 / 单个流月展开，并可出 AI 解读 |
| 今日流日 | `today.html` | 今日与当前档案的十神、地支关系、大运流月坐标，可出 AI 解读 |
| 合盘 | `match.html` | 八字与紫微两套视角的对照，AI 合盘解读 |
| 记录 | `journal.html` | 本机生成的解读报告列表 |
| 解读报告 | `report.html` | 全文、复制、存成长图 |
| 我的 | `me.html` | 档案管理（默认档案 / 删除）、报告数、清除本机数据 |

本地预览：`python design/miniprogram/serve.py 8899`，然后打开 `http://127.0.0.1:8899/input.html`。
页面通过 `127.0.0.1:8765` 调用本机服务，跨域已对 `/api/*` 开放。

## AI 接口

| 端点 | 用途 |
| --- | --- |
| `POST /api/v1/interpret` | 单批主题解读（八字 7 / 紫微 7 / 年度 6 个主题，分批调用） |
| `POST /api/v1/match` | 双盘合盘对照，两份单体系契约分别校验后带 `a:` / `b:` 前缀引用证据 |
| `POST /api/v1/moment` | 流日 / 流月解读，把指定干支放到本命盘上 |

三者都会校验契约事实、证据路径（必须能在契约里解析）与违禁措辞，不通过则退回重试。