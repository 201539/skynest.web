# 一键启动（需先启动 PostgreSQL 18）

Write-Host "=== 仙林校区无人机适航评估平台 ===" -ForegroundColor Cyan

# 启动 API
Write-Host "启动 API 服务 (端口 3001)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot\pg-server'; node index.js"

Start-Sleep -Seconds 2

# 启动前端
Write-Host "启动前端 (端口 5173)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot\demo'; npm run dev"

Start-Sleep -Seconds 3
Write-Host ""
Write-Host "平台地址: http://localhost:5173" -ForegroundColor Green
Write-Host "API 地址: http://localhost:3001/api/health" -ForegroundColor Green
Write-Host ""
Write-Host "首次使用请执行数据库索引初始化:" -ForegroundColor Yellow
Write-Host "  cd pg-server && node setup-db.js" -ForegroundColor White
