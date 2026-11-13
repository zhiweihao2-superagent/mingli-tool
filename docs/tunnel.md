# 临时公网链接（给别人看）

本机工具默认只在自己电脑上跑。要发给别人看，用 Cloudflare 的临时隧道，不注册、不花钱。

## 当前这一条（随时会变）

| 用途 | 地址 |
| --- | --- |
| 手机小程序版 | <https://core-smilies-influences-floppy.trycloudflare.com/mp/> |
| 电脑版工作台 | <https://core-smilies-influences-floppy.trycloudflare.com/> |

2026-11-10 记录。旧域名 `income-affiliation-should-acm` 已被 Cloudflare 回收
（日志里 `ERR Register tunnel error … Unauthorized: Tunnel not found`，访问表现为 502），
按下面「起隧道」重起就会换一个新域名，**以 `.pair\cloudflared.out.log` 最后一条为准**。

重起后先自检，别直接发出去：

```powershell
cd D:\deepseek-harness\workspace\mingli-tool
& "C:\Users\hao\AppData\Local\Temp\python-nuget-3.12.10\tools\python.exe" .pair\mp_pub_check.py
```

脚本里 `BASE` 要改成当前域名。它用无头 Edge 抓 5 页真实 DOM，四类判据：DOM 长度下限、
页面关键词、`#empty`/`#error` 是否仍 hidden、有没有出现「请求失败 / Failed to fetch /
Bad gateway / 502」。全过打印 `失败页数: 0 / 5` 且 exit 0。

## 两条地址

| 想给谁看什么 | 地址 |
| --- | --- |
| 电脑版工作台（排盘、报告库、AI） | `https://<随机>.trycloudflare.com/` |
| 手机小程序版（13 屏设计稿） | `https://<随机>.trycloudflare.com/mp/` |

`<随机>` 是每次起隧道时 Cloudflare 现给的域名，**关掉要重新生成**，不会重复。

## 起隧道

```powershell
# 1) 后端绑所有网卡（原来是 127.0.0.1，只有本机能连）
cd D:\deepseek-harness\workspace\mingli-tool
#    用 pythonw.exe（无控制台）+ -u：控制台版 python.exe 会在工具会话收尾时收到 ^C 一起死
$py = "C:\Users\hao\AppData\Local\Temp\python-nuget-3.12.10\tools\pythonw.exe"
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=
  "cmd.exe /c set PYTHONIOENCODING=utf-8&& set PYTHONPATH=src;.&& cd /d D:\deepseek-harness\workspace\mingli-tool && `"$py`" -u web_tool.py --host 0.0.0.0 --port 8765 1>>.pair\server.out.log 2>>.pair\server.err.log"}
#    起来后确认（Get-NetTCPConnection 有时返回空，以 netstat 为准）
netstat -ano | Select-String ":8765.*LISTENING"

# 2) 隧道（另一个进程）
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=
  "cmd.exe /c cd /d D:\deepseek-harness\workspace\tools && cloudflared.exe tunnel --url http://127.0.0.1:8765 --no-autoupdate 1>>D:\deepseek-harness\workspace\mingli-tool\.pair\cloudflared.out.log 2>&1"}

# 3) 取地址
Select-String -Path .pair\cloudflared.out.log -Pattern "trycloudflare.com" | Select-Object -Last 1
```

WMI 起的是**非子进程**，工具会话结束不会把它带走。用 `Start-Process` 或 `cmd /c` 直接起则会被一起杀掉。

## 关隧道

```powershell
Stop-Process -Name cloudflared -Force
# 后端随后可以改回只绑本机：
#   web_tool.py --host 127.0.0.1 --port 8765
```

## 隧道掉了怎么办

现象：链接一直转圈或直接 502。看日志：

```powershell
Get-Content .pair\cloudflared.out.log -Tail 12
```

出现 `Unauthorized: Tunnel not found` 就是 quick tunnel 被 Cloudflare 回收了（免费临时隧道
没有保证，几小时到几天不等）。处理是重起，**域名会换**：

```powershell
Stop-Process -Name cloudflared -Force
Move-Item .pair\cloudflared.out.log .pair\cloudflared.prev.log -Force
# 再按上面第 2 步起一次，然后取新地址
```

## AI 保护（默认就开着）

公网链接**不开放 AI 解读**。`src/mingli_tool/web.py` 里的 `_ai_public_guard()` 会看 `Host` 头：
非 `127.0.0.1` / `localhost` 的请求打到 `/api/v1/interpret`、`/match`、`/moment` 一律返
503 `AI_PUBLIC_DISABLED`，避免陌生人拿本机 key 刷额度。

排盘（`/api/v1/bazi/calculate`）、知识包、页面本身**不受影响**，别人能正常看盘，只是点「生成解读」会被拦。

真要开：

```powershell
$env:AI_PUBLIC_ENABLED = "1"   # 设在不被服务读到的地方没用，要设进服务的启动环境
```

**不建议开。** 开了等于把 key 交给任何拿到链接的人。

## 手机界面为什么在电脑上也是一格手机

`design/miniprogram/frame.css` 只在 `@media (min-width: 520px)` 生效：把 `body` 收成 390px 居中、
给底栏和固定弹层做同样的收窄，外面铺一层深一点的纸色。手机上看（< 520px）这条规则完全不生效，
所以发给别人用手机打开就是正常满屏的小程序界面，用电脑打开则是一格手机。

因为它是靠 `@media` 收窄而不是套 iframe，`:active`、滚动、吸顶都还是真的。
