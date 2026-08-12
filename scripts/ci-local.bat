@echo off
REM ============================================================================
REM Phase 11.1.3 — CI 本地一键脚本
REM ============================================================================
REM 用途：lint + typecheck + unit + integration + e2e + coverage 一键全跑
REM 用法：双击或在终端执行 scripts\ci-local.bat
REM 退出码：0 全绿；非 0 表示某步骤失败
REM ============================================================================

setlocal enabledelayedexpansion
set FAILED=0
set STEP=0
set /a TOTAL=5

echo.
echo ================================================================
echo  Phase 11 CI Local Check
echo  Steps: typecheck + lint + unit + integration + e2e
echo ================================================================

REM Step 1: Typecheck
set /a STEP+=1
echo.
echo [%STEP%/%TOTAL%] Typecheck ...
call npm run typecheck
if !ERRORLEVEL! neq 0 (
  echo [FAIL] Typecheck failed
  set FAILED=1
  goto :summary
)
echo [OK] Typecheck passed

REM Step 2: Lint
set /a STEP+=1
echo.
echo [%STEP%/%TOTAL%] Lint ...
call npm run lint
if !ERRORLEVEL! neq 0 (
  echo [FAIL] Lint failed
  set FAILED=1
  goto :summary
)
echo [OK] Lint passed

REM Step 3: Unit tests + coverage
set /a STEP+=1
echo.
echo [%STEP%/%TOTAL%] Unit tests + coverage ...
call npm run test:coverage
if !ERRORLEVEL! neq 0 (
  echo [FAIL] Unit tests failed
  set FAILED=1
  goto :summary
)
echo [OK] Unit tests passed

REM Step 4: Integration tests
set /a STEP+=1
echo.
echo [%STEP%/%TOTAL%] Integration tests ...
call npm run test:integration
if !ERRORLEVEL! neq 0 (
  echo [FAIL] Integration tests failed
  set FAILED=1
  goto :summary
)
echo [OK] Integration tests passed

REM Step 5: E2E tests
set /a STEP+=1
echo.
echo [%STEP%/%TOTAL%] E2E tests (dev server) ...
call npm run test:e2e
if !ERRORLEVEL! neq 0 (
  echo [FAIL] E2E tests failed
  set FAILED=1
  goto :summary
)
echo [OK] E2E tests passed

:summary
echo.
echo ================================================================
if !FAILED! equ 0 (
  echo  [CI PASS] all steps green
  echo ================================================================
  exit /b 0
) else (
  echo  [CI FAIL] some steps failed
  echo ================================================================
  exit /b 1
)
