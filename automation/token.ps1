param([ValidateSet('save','read')] [string]$Mode)
$ErrorActionPreference = 'Stop'
$tokenPath = Join-Path $PSScriptRoot 'state\github-token.dpapi'
if ($Mode -eq 'save') {
    Write-Host 'Only t-loooooong/Loong-s-Casle. Fine-grained token. Contents: Read and write. Do not send to chat.'
    $secureValue = Read-Host 'Paste token locally (hidden)' -AsSecureString
    if ($secureValue.Length -lt 30) { throw 'Token too short; not saved' }
    New-Item -ItemType Directory -Force -Path (Split-Path $tokenPath) | Out-Null
    $secureValue | ConvertFrom-SecureString | Set-Content -LiteralPath $tokenPath -Encoding UTF8
} else {
    if (-not (Test-Path -LiteralPath $tokenPath)) { exit 2 }
    $secureValue = Get-Content -LiteralPath $tokenPath -Raw | ConvertTo-SecureString
    $valuePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($valuePointer)) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($valuePointer) }
}
