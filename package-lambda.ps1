# One build/verification workflow. No AWS changes or database operations.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$requiredFiles = @("server.js", "services", "views", "public", "package.json", "package-lock.json", "node_modules", "global-bundle.pem")
Push-Location -LiteralPath $root
try {
    foreach ($name in $requiredFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $name))) { throw "Missing deployment item: $name" }
    }
    & node (Join-Path $root "scripts/smoke-lambda.js") $root --validate-only
    if ($LASTEXITCODE -ne 0) { throw "Dependency or CA validation failed. Run npm ci and check global-bundle.pem." }

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $output = Join-Path $root "artifacts"
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    $zipPath = Join-Path $output "ryde-lambda.zip"
    # Preserve any previous ZIP rather than overwrite it.
    if (Test-Path -LiteralPath $zipPath) {
        $previous = Join-Path $output ("ryde-lambda-previous-" + [Guid]::NewGuid().ToString("N") + ".zip")
        Move-Item -LiteralPath $zipPath -Destination $previous
    }
    $files = foreach ($name in $requiredFiles) {
        $target = Get-Item -LiteralPath (Join-Path $root $name)
        if ($target.PSIsContainer) { Get-ChildItem -LiteralPath $target.FullName -Recurse -File -Force }
        else { $target }
    }
    $entries = foreach ($file in $files) {
        $relative = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
        if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $relative -match '(^|/)(\.env($|\.)|\.git($|/))' -or
            ($relative -match '\.(pem|key|p12|pfx|crt|cer)$' -and $relative -ne 'global-bundle.pem') -or
            $relative -match '\.node$') { throw "Unexpected credential, link or native binary: $relative" }
        [PSCustomObject]@{ Path = $relative; File = $file.FullName; Bytes = $file.Length }
    }
    if (($entries | Measure-Object -Property Bytes -Sum).Sum -ge 250MB) { throw "Uncompressed package exceeds Lambda limit." }
    $stream = [IO.File]::Open($zipPath, [IO.FileMode]::CreateNew)
    try {
        $archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
        try {
            foreach ($item in ($entries | Sort-Object Path)) {
                $entry = $archive.CreateEntry($item.Path, [IO.Compression.CompressionLevel]::Optimal)
                $entry.ExternalAttributes = 420 -shl 16 # Linux 0644 file permissions
                $sourceStream = [IO.File]::OpenRead($item.File)
                $entryStream = $entry.Open()
                try { $sourceStream.CopyTo($entryStream) }
                finally { $entryStream.Dispose(); $sourceStream.Dispose() }
            }
        } finally { $archive.Dispose() }
    } finally { $stream.Dispose() }
    if ((Get-Item -LiteralPath $zipPath).Length -ge 50MB) { throw "ZIP exceeds Lambda console upload limit." }

    # Verify the exact ZIP in a fresh temporary directory; remove only this run's extraction.
    $reviewPath = [IO.Path]::GetFullPath((Join-Path $output ("lambda-check-" + [Guid]::NewGuid().ToString("N"))))
    [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $reviewPath)
    & node (Join-Path $root "scripts/smoke-lambda.js") $reviewPath
    if ($LASTEXITCODE -ne 0) { throw "Extracted Lambda verification failed; retained at $reviewPath" }
    $resolvedOutput = [IO.Path]::GetFullPath($output).TrimEnd('\') + '\'
    if (-not $reviewPath.StartsWith($resolvedOutput, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $reviewPath) -notmatch '^lambda-check-[a-f0-9]{32}$') { throw "Unexpected extraction cleanup path." }
    Remove-Item -LiteralPath $reviewPath -Recurse -Force
    Write-Host "Verified upload: $zipPath"
    Write-Host "SHA256: $((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant())"
    Write-Host "Nothing deployed."
} finally { Pop-Location }
