@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%USERPROFILE%\AppData\Local\Programs\Python\Python313;%PATH%"
node publisher.mjs --setup
pause
