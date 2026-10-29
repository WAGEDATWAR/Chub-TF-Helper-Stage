# Generates a local HTTPS cert for the dev/staging server and trusts it for the
# current user. Chrome/Edge/Opera use the Windows trust store, so the staging
# iframe loads without a cert warning. Idempotent: re-run after the SAN changes
# (e.g. your LAN IP moved) to regenerate.
#
#   powershell -ExecutionPolicy Bypass -File tools/make-cert.ps1
#
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$certs = Join-Path $root "certs"
New-Item -ItemType Directory -Force -Path $certs | Out-Null
$key = Join-Path $certs "key.pem"
$crt = Join-Path $certs "cert.pem"

$openssl = @(
  "C:\Program Files\Git\usr\bin\openssl.exe",
  "C:\Program Files\Git\mingw64\bin\openssl.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $openssl) { throw "openssl not found. Install Git for Windows (which ships it)." }

# include the Wi-Fi LAN IP too, so a phone on the same network can use https
$lan = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.InterfaceAlias -eq 'Wi-Fi' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -First 1).IPAddress
$san = "DNS:localhost,IP:127.0.0.1"
if ($lan) { $san += ",IP:$lan" }

if (-not (Test-Path $key) -or -not (Test-Path $crt)) {
  Write-Host "Generating self-signed cert in certs/ ..."
  & $openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes `
    -keyout $key -out $crt `
    -subj "/CN=localhost/O=Chrysalis Dev" `
    -addext "subjectAltName=$san" `
    -addext "basicConstraints=critical,CA:TRUE" `
    -addext "keyUsage=critical,digitalSignature,keyCertSign" `
    -addext "extendedKeyUsage=serverAuth"
}

Write-Host "Trusting cert for the current user..."
certutil -user -addstore -f Root $crt | Out-Null
Write-Host "Done. Cert: $crt  (SAN: $san)"
