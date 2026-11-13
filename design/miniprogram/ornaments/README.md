# 纹样（ornaments）

每张图都是单色描边、120×12 的横条，只给 CSS `mask-image` 用，所以：

- `stroke="#fff"` 是固定的（遮罩只看 alpha，颜色无所谓），不要改成 `currentColor`；
- 一个文件只画一条，不要把几种纹样塞进同一张 sprite——`mask-image` 引用 `#id` 不生效；
- 宽度按 120px 平铺，`background` 给颜色，`opacity` 给浓淡。

| 文件 | 用在哪 |
| --- | --- |
| `cloud.svg` | 宋刻本：首页大图收边的云线 |
| `thunder.svg` | 道观：细雷纹 |
| `mountain.svg` | 青绿绢本：山线 |
