@echo off
REM 一键启动本地服务（双击即可）。日志写在 .pair\server.out.log / server.err.log
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONPATH=src;.
"C:\Users\hao\AppData\Local\Temp\python-nuget-3.12.10\tools\python.exe" web_tool.py --port 8765 1>>"%~dp0..\.pair\server.out.log" 2>>"%~dp0..\.pair\server.err.log"
