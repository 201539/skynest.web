# Import nanjing_uni_3d_grid_new dump (PostGIS-free)
# Run as Administrator NOT required, but needs PostgreSQL running.
#
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   cd pg-server
#   .\import-data.ps1

$ErrorActionPreference = "Stop"

$pgServerDir = $PSScriptRoot
$projectRoot = Split-Path $pgServerDir -Parent
$pgBin       = "C:\Program Files\PostgreSQL\18\bin"
$dumpFile    = Join-Path $projectRoot "nanjing_uni_3d_grid_new.sql"
$importSql   = Join-Path $pgServerDir "import-table.sql"
$logFile     = Join-Path $pgServerDir "import.log"
$envFile     = Join-Path $pgServerDir ".env"

if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
        }
    }
}

$dbHost = if ($env:PG_HOST) { $env:PG_HOST } else { "localhost" }
$dbPort = if ($env:PG_PORT) { $env:PG_PORT } else { "5432" }
$dbUser = if ($env:PG_USER) { $env:PG_USER } else { "postgres" }
$dbName = if ($env:PG_DATABASE) { $env:PG_DATABASE } else { "nanjing_uni_grid_score" }
$env:PGPASSWORD = $env:PG_PASSWORD

Write-Host "=== Import Grid Data ===" -ForegroundColor Cyan
Write-Host "Dump: $dumpFile"
Write-Host "DB:   $dbName"
Write-Host ""

if (-not (Test-Path -LiteralPath $dumpFile)) {
    throw "Dump file not found: $dumpFile"
}

Write-Host "[1/3] Create compatible table schema ..." -ForegroundColor Yellow
& "$pgBin\psql.exe" -h $dbHost -p $dbPort -U $dbUser -d $dbName -f $importSql
if ($LASTEXITCODE -ne 0) { throw "Schema creation failed" }
Write-Host "      OK" -ForegroundColor Green

Write-Host "[2/3] Import data (about 1.3GB, 15-40 min) ..." -ForegroundColor Yellow
Write-Host "      Please wait..." -ForegroundColor Yellow
$dumpResolved = (Resolve-Path -LiteralPath $dumpFile).Path
$restoreOutput = cmd /c "`"$pgBin\pg_restore.exe`" -h $dbHost -p $dbPort -U $dbUser -d $dbName --data-only --no-owner --no-acl --verbose `"$dumpResolved`" 2>&1"
$restoreOutput | Tee-Object -FilePath $logFile
# pg_restore may return non-zero for ignorable index warnings; verify count below

Write-Host "[3/3] Verify row count ..." -ForegroundColor Yellow
$count = & "$pgBin\psql.exe" -h $dbHost -p $dbPort -U $dbUser -d $dbName -tAc "SELECT COUNT(*) FROM nanjing_uni_3d_grid_new"
Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Green
Write-Host "Rows imported: $count"
Write-Host "Log file: $logFile"
Write-Host ""
Write-Host "Next:"
Write-Host "  cd pg-server"
Write-Host "  node setup-db.js"
Write-Host "  node index.js"
