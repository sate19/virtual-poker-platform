param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,

  [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not $Force) {
  throw "Restore will overwrite the current database. Rerun with -Force when you are sure."
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $repoRoot

$resolvedBackup = Resolve-Path -LiteralPath $BackupFile
$containerId = docker compose ps -q postgres
if (-not $containerId) {
  throw "PostgreSQL container is not running. Start it with: docker compose up -d postgres"
}

$containerPath = "/tmp/poker-restore.dump"

docker compose stop web server
docker cp $resolvedBackup "${containerId}:$containerPath"
docker compose exec -T postgres pg_restore -U poker -d friends_poker --clean --if-exists --no-owner --no-privileges $containerPath
docker compose exec -T postgres rm -f $containerPath
docker compose up -d server web

Write-Host "Database restored from: $resolvedBackup"
