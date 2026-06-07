param(
  [string]$OutputDir = "backups"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $repoRoot

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$containerId = docker compose ps -q postgres
if (-not $containerId) {
  throw "PostgreSQL container is not running. Start it with: docker compose up -d postgres"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$fileName = "friends_poker-$timestamp.dump"
$containerPath = "/tmp/$fileName"
$hostPath = Join-Path $OutputDir $fileName

docker compose exec -T postgres pg_dump -U poker -d friends_poker -Fc -f $containerPath
docker cp "${containerId}:$containerPath" $hostPath
docker compose exec -T postgres rm -f $containerPath

Write-Host "Database backup created: $hostPath"
