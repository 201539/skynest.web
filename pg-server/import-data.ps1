# Import nanjing_uni_3d_grid_new dump (PostGIS-free)
# Run as Administrator NOT required, but needs PostgreSQL running.
#
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   & "F:\无人机大创\pg-server\import-data.ps1"

$ErrorActionPreference = "Stop"

$pgBin    = "C:\Program Files\PostgreSQL\18\bin"
$dumpFile = "F:\无人机大创\nanjing_uni_3d_grid_new.sql"
$dbName   = "nanjing_uni_grid_score"
$password = "974853"
$env:PGPASSWORD = $password

Write-Host "=== Import Grid Data ===" -ForegroundColor Cyan
Write-Host "Dump: $dumpFile"
Write-Host "DB:   $dbName"
Write-Host ""

if (-not (Test-Path $dumpFile)) {
    throw "Dump file not found: $dumpFile"
}

Write-Host "[1/3] Create compatible table schema ..." -ForegroundColor Yellow
& "$pgBin\psql.exe" -U postgres -d $dbName -f "F:\无人机大创\pg-server\import-table.sql"
if ($LASTEXITCODE -ne 0) { throw "Schema creation failed" }
Write-Host "      OK" -ForegroundColor Green

Write-Host "[2/3] Import data (about 1.3GB, 15-40 min) ..." -ForegroundColor Yellow
Write-Host "      Please wait..." -ForegroundColor Yellow
$logFile = "F:\无人机大创\pg-server\import.log"
& "$pgBin\pg_restore.exe" -U postgres -d $dbName --data-only --no-owner --no-acl --verbose $dumpFile 2>&1 | Tee-Object -FilePath $logFile
# pg_restore may return non-zero for ignorable index warnings; verify count below

Write-Host "[3/3] Verify row count ..." -ForegroundColor Yellow
$count = & "$pgBin\psql.exe" -U postgres -d $dbName -tAc "SELECT COUNT(*) FROM nanjing_uni_3d_grid_new"
Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Green
Write-Host "Rows imported: $count"
Write-Host "Log file: $logFile"
Write-Host ""
Write-Host "Next:"
Write-Host "  cd F:\无人机大创\pg-server"
Write-Host "  node index.js"
