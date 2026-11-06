# 输入输出协议

## 输入

协议版本固定为 `1.0`。完整示例见 `examples/`。

关键字段：

- `profile.calendar`：`solar` 或 `lunar`。
- `profile.date`：`YYYY-MM-DD`。农历仍使用数字年月日，由 `is_leap_month` 表示闰月。
- `profile.time.precision`：`minute`、`branch` 或 `unknown`。
- `profile.time.value`：分钟级输入的 `HH:MM`；其他精度必须为 `null`。
- `profile.time.branch`：时辰级输入的十二地支；其他精度必须为 `null`。
- `profile.timezone`：当前只能是 `Asia/Shanghai`。
- `profile.sex_for_calculation`：`male` 或 `female`，仅作为传统大运顺逆规则参数。
- `profile.birthplace.longitude`：可选，经度范围 -180 至 180；与分钟级时间一起用于真太阳时。
- `rules.true_solar_time`：布尔值；启用时必须同时提供分钟级时间和经度。
- `rules.clock_time_is_dst`：布尔值；用户明确说明出生证明记录的是夏令时钟表时间时，校正前先减 60 分钟。
- `options.save_history`：当前必须为 `false`。
- `options.annual_cycles_through`：流年输出截止年份。显式填写可让输出跨时间保持可复现。

## 成功输出

成功响应的 `status` 为 `ok`，主要包含：

- `normalized_input`：实际用于计算的标准化输入。
- `calculation.engine`：引擎、提交和适配器版本。
- `calculation.rule_profile`：已采用的边界规则。
- `calculation.pillars`：年、月、日、时柱；含干支阴阳五行、十神、藏干层级与十二长生；未知时辰的 `hour` 为 `null`。
- `calculation.luck_cycles`：起运和大运。
- `calculation.annual_cycles`：截至指定年份的流年干支。
- `warnings`：稳定 code 加可读 message。
- `provenance`：来源和验证范围。
- `interpretation`：当前恒为 `null`。
- `ai_facts`：`bazi-facts/v1` 确定性事实包，包含指纹、支持范围、禁止推断范围与硬性校验结果。

浏览器同时生成紫微结果时，可以由 `MingliAiContract.build()` 产生 `mingli-ai-input/v1`。该对象只在内存中生成，不会自动上传；包含两个体系的引擎与规则档案、冻结事实、请求解读范围、证据引用协议和模型行为边界。请求未支持范围时抛出 `UNSUPPORTED_AI_SCOPE`。

紫微结构化结果还包含 `dualFourPillars`（节气四柱、农历口径四柱）和事实包中的 `periods.childhood`（首个实际大限前的逐年童限锚点）。十类流派口径当前会完整记录在 `ruleProfile.schoolRules`，尚未开放切换的项目明确标为固定引擎口径。

## 错误输出

错误响应的 `status` 为 `error`，并提供稳定错误码。当前主要错误包括：

`INVALID_JSON`、`INVALID_INPUT`、`INVALID_DATE`、`INVALID_LUNAR_DATE`、`INVALID_TIME`、`UNSUPPORTED_DATE_RANGE`、`UNSUPPORTED_TIMEZONE`、`UNSUPPORTED_RULE`、`UNSUPPORTED_OPTION` 和 `ENGINE_FAILURE`。
