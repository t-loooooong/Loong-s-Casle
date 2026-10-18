@echo off
setlocal
cd /d "%~dp0"
set "GUNPLA_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%GUNPLA_NODE%" (
  echo Node.js runtime not found. Please contact support.
  pause
  exit /b 1
)
set "PATH=%USERPROFILE%\AppData\Local\Programs\Python\Python313;%PATH%"
"%GUNPLA_NODE%" "%~dp0publisher.mjs" --setup %*
pause
endlocal
