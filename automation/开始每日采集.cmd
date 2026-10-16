@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%USERPROFILE%\AppData\Local\Programs\Python\Python313;%PATH%"
echo 请在 Edge 的 SubBatch 中打开“每日自动采集”页并保持打开。
node publisher.mjs
pause
