# CI check 脚本（Phase 11.1）
#
# 本地一键模拟 CI 流程：typecheck + lint + test + coverage
#
# 用法：
#   pwsh scripts/ci-check.ps1            # 全套检查
#   pwsh scripts/ci-check.ps1 -SkipLint # 跳过 lint
#   pwsh scripts/ci-check.ps1 -SkipCoverage # 跳过 coverage
#
# 退出码：0 全绿；非 0 表示某步骤失败
[CmdletBinding()]
param(
  [switch]$SkipLint,
  [switch]$SkipCoverage,
  [switch]$SkipTypecheck
)

$ErrorActionPreference = 'Stop'
$step = 0
$totalSteps = 0
$failed = $false

function Invoke-Step([string]$name, [scriptblock]$action) {
  $script:step++
  Write-Host ""
  Write-Host "================================================" -ForegroundColor Cyan
  Write-Host "[$script:step/$script:totalSteps] $name" -ForegroundColor Cyan
  Write-Host "================================================" -ForegroundColor Cyan
  try {
    & $action
    if ($LASTEXITCODE -ne 0) {
      throw "exit code $LASTEXITCODE"
    }
    Write-Host "[OK] $name passed" -ForegroundColor Green
  } catch {
    Write-Host "[FAIL] $name failed: $_" -ForegroundColor Red
    $script:failed = $true
  }
}

# 计算总步骤数
if (-not $SkipTypecheck) { $totalSteps++ }
if (-not $SkipLint) { $totalSteps++ }
$totalSteps++  # test:unit 一定会跑

if (-not $SkipTypecheck) {
  Invoke-Step 'Typecheck' {
    npm run typecheck
  }
}

if (-not $SkipLint) {
  Invoke-Step 'Lint' {
    npm run lint
  }
}

if ($SkipCoverage) {
  Invoke-Step 'Unit tests' {
    npm run test
  }
} else {
  Invoke-Step 'Unit tests + coverage' {
    npm run test:coverage
  }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
if ($failed) {
  Write-Host "[CI FAIL] some steps failed" -ForegroundColor Red
  Write-Host "================================================" -ForegroundColor Cyan
  exit 1
} else {
  Write-Host "[CI PASS] all steps green" -ForegroundColor Green
  Write-Host "================================================" -ForegroundColor Cyan
  exit 0
}
