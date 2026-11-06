@echo off
setlocal
cd /d "%~dp0"
set "PY=C:\Users\hao\AppData\Local\Temp\python-nuget-3.12.10\tools\python.exe"
if not exist "%PY%" set "PY=python"
set PYTHONIOENCODING=utf-8
set PYTHONPATH=src;.
echo [mingli] serving http://127.0.0.1:8765/  (Ctrl+C to stop)
start "" http://127.0.0.1:8765/
"%PY%" web_tool.py --port 8765
echo.
echo [mingli] server stopped. press any key to close.
pause >nul