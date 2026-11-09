$ErrorActionPreference = "Stop"
$requiredFiles = @("server.js", "package.json", "node_modules", "global-bundle.pem")
foreach ($name in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name))) {
        throw "Required deployment item is missing: $name"
    }
}

$items = $requiredFiles | ForEach-Object { Join-Path $PSScriptRoot $_ }
$zipPath = Join-Path $PSScriptRoot "ryde-lambda.zip"
Compress-Archive -Path $items -DestinationPath $zipPath -Force
Write-Host "Created $zipPath (the local .env file is not included)."
