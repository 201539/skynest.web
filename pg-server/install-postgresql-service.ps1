# Run as Administrator:
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   & "F:\无人机大创\pg-server\install-postgresql-service.ps1"

$ErrorActionPreference = "Stop"

$pgRoot   = "C:\Program Files\PostgreSQL\18"
$pgBin    = Join-Path $pgRoot "bin"
$dataDir  = "C:\PostgreSQL\18\data"
$service  = "postgresql-x64-18"
$password = "974853"
$dbName   = "nanjing_uni_grid_score"

Write-Host "=== PostgreSQL 18 Setup ===" -ForegroundColor Cyan
Write-Host "Bin:     $pgBin"
Write-Host "Data:    $dataDir"
Write-Host "Service: $service"
Write-Host ""

if (-not (Test-Path "$pgBin\initdb.exe")) {
    throw "PostgreSQL 18 not found. Install with: winget install PostgreSQL.PostgreSQL.18"
}

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$hasCluster = Test-Path (Join-Path $dataDir "PG_VERSION")
if (-not $hasCluster) {
    Write-Host "[1/4] initdb ..." -ForegroundColor Yellow
    $pwFile = Join-Path $env:TEMP "pg_init_pw.txt"
    Set-Content -Path $pwFile -Value $password -NoNewline -Encoding ascii
    & "$pgBin\initdb.exe" -D $dataDir -U postgres -A scram-sha-256 -E UTF8 --locale=C --pwfile=$pwFile
    if ($LASTEXITCODE -ne 0) { throw "initdb failed (exit $LASTEXITCODE)" }
    Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
    Write-Host "      OK" -ForegroundColor Green
} else {
    Write-Host "[1/4] cluster exists, skip initdb" -ForegroundColor Green
}

$svc = Get-Service -Name $service -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "[2/4] register service ..." -ForegroundColor Yellow
    & "$pgBin\pg_ctl.exe" register -N $service -D $dataDir -S auto
    if ($LASTEXITCODE -ne 0) { throw "pg_ctl register failed (exit $LASTEXITCODE)" }
    Write-Host "      OK" -ForegroundColor Green
} else {
    Write-Host "[2/4] service already registered" -ForegroundColor Green
}

Write-Host "[3/4] start service ..." -ForegroundColor Yellow
Set-Service $service -StartupType Automatic -ErrorAction SilentlyContinue
Start-Service $service
Start-Sleep -Seconds 3
$svc = Get-Service $service
if ($svc.Status -ne "Running") { throw "Service not running: $($svc.Status)" }
Write-Host "      OK ($($svc.Status))" -ForegroundColor Green

Write-Host "[4/4] create database ..." -ForegroundColor Yellow
$env:PGPASSWORD = $password
& "$pgBin\psql.exe" -U postgres -h localhost -p 5432 -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='$dbName'" | Out-Null
$exists = & "$pgBin\psql.exe" -U postgres -h localhost -p 5432 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'"
if ($exists -ne "1") {
    & "$pgBin\createdb.exe" -U postgres -h localhost -p 5432 $dbName
    if ($LASTEXITCODE -ne 0) { throw "createdb failed" }
    Write-Host "      created $dbName" -ForegroundColor Green
} else {
    Write-Host "      $dbName already exists" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Green
Write-Host "Host:     localhost"
Write-Host "Port:     5432"
Write-Host "User:     postgres"
Write-Host "Password: $password"
Write-Host "Database: $dbName"
Write-Host ""
Write-Host "Next:"
Write-Host "  cd F:\无人机大创\pg-server"
Write-Host "  node setup-db.js"
Write-Host "  node index.js"
