# ============================================================================
# 通过服务器 API 测试搜索工具
# 直接调用 localhost:3456 上运行的服务器
# ============================================================================

$baseUrl = "http://localhost:3456"

Write-Host "=" * 80
Write-Host "通过服务器 API 测试搜索工具"
Write-Host "=" * 80

# 1. 检查 health
Write-Host "`n[1/4] 健康检查..."
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -Method Get
    Write-Host "  ✓ 服务器运行正常: $($health.status)"
} catch {
    Write-Host "  ✗ 健康检查失败: $($_.Exception.Message)"
}

# 2. 检查 search keys 状态
Write-Host "`n[2/4] 搜索 Key 状态..."
try {
    $keys = Invoke-RestMethod -Uri "$baseUrl/api/search/keys" -Method Get
    foreach ($p in $keys.providers) {
        $status = if ($p.hasKey) { "✓ 已配置" } else { "✗ 未配置" }
        Write-Host "  $($p.provider): $status (updated: $([DateTimeOffset]::FromUnixTimeMilliseconds($p.updatedAt).LocalDateTime))"
    }
} catch {
    Write-Host "  ✗ 获取 Key 状态失败: $($_.Exception.Message)"
}

# 3. 测试各搜索引擎 Key 是否有效
Write-Host "`n[3/4] 测试各搜索引擎 Key 有效性..."

# Bocha
Write-Host "`n  Bocha (网页搜索)..."
try {
    $bochaTest = Invoke-RestMethod -Uri "$baseUrl/api/search/keys/bocha/test" -Method Post -ContentType "application/json" -Body "{}"
    Write-Host "    结果: $($bochaTest | ConvertTo-Json -Depth 5)"
} catch {
    Write-Host "    错误: $($_.Exception.Message)"
    if ($_.ErrorDetails) { Write-Host "    详情: $($_.ErrorDetails.Message)" }
}

# Semantic Scholar
Write-Host "`n  Semantic Scholar (学术搜索)..."
try {
    $s2Test = Invoke-RestMethod -Uri "$baseUrl/api/search/keys/semanticScholar/test" -Method Post -ContentType "application/json" -Body "{}"
    Write-Host "    结果: $($s2Test | ConvertTo-Json -Depth 5)"
} catch {
    Write-Host "    错误: $($_.Exception.Message)"
    if ($_.ErrorDetails) { Write-Host "    详情: $($_.ErrorDetails.Message)" }
}

# GitHub
Write-Host "`n  GitHub..."
try {
    $ghTest = Invoke-RestMethod -Uri "$baseUrl/api/search/keys/github/test" -Method Post -ContentType "application/json" -Body "{}"
    Write-Host "    结果: $($ghTest | ConvertTo-Json -Depth 5)"
} catch {
    Write-Host "    错误: $($_.Exception.Message)"
    if ($_.ErrorDetails) { Write-Host "    详情: $($_.ErrorDetails.Message)" }
}

Write-Host "`n" + "=" * 80
Write-Host "测试完成"
Write-Host "=" * 80
