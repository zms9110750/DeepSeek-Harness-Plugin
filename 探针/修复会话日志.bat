@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title Repair DSH session logs

set "NODE=B:\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"
set "SCRIPT=%~dp0repair-session-log.mjs"
set "ROOT=%USERPROFILE%\.dsh\sessions"

if not exist "%SCRIPT%" (
  echo [ERROR] repair script not found: %SCRIPT%
  pause
  exit /b 1
)
if not exist "%ROOT%" (
  echo [ERROR] session root not found: %ROOT%
  pause
  exit /b 1
)

set /a CLEAN=0, FIXED=0, LOCKED=0, FAILED=0
echo Session root: %ROOT%
echo Only unknown, non-ignorable events are rewritten; every other frame keeps its bytes.
echo Logs held open by Harness are skipped.
echo ------------------------------------------------------------

for /d %%P in ("%ROOT%\*") do (
  for /d %%S in ("%%~fP\*") do (
    if exist "%%~fS\session.v4.jsonl.zstd" call :one "%%~fS\session.v4.jsonl.zstd"
  )
)

echo ------------------------------------------------------------
echo Done: repaired !FIXED!, clean !CLEAN!, in-use !LOCKED!, failed !FAILED!.
if !LOCKED! GTR 0 echo Note: in-use logs were skipped. Close that tab or exit Harness, then run again.
pause
exit /b 0

:one
set "F=%~1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$s=[IO.File]::Open('%F%','Open','ReadWrite','None');$s.Close();exit 0}catch{exit 1}" >nul 2>nul
if errorlevel 1 (
  echo [busy] %F%
  set /a LOCKED+=1
  exit /b
)
"%NODE%" "%SCRIPT%" "%F%"
set "RC=!errorlevel!"
if "!RC!"=="10" (
  set /a FIXED+=1
) else if "!RC!"=="0" (
  set /a CLEAN+=1
) else (
  echo [failed] exit code !RC!
  set /a FAILED+=1
)
exit /b