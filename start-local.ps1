$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot

function Stop-OldServices {
  $portOwners = Get-NetTCPConnection -LocalPort 65354 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($owner in $portOwners) {
    Write-Host "Stopping old service PID $owner"
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
  }
  $root = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
  $processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine -like "*$root*" -and
      ($_.CommandLine -match 'src[\\/]cli\.mjs[" ]+preview' -or $_.CommandLine -match 'src[\\/]cli\.mjs[" ]+cms')
    }
  foreach ($process in $processes) {
    Write-Host "Stopping old service PID $($process.ProcessId)"
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

Stop-OldServices
$port = 65354
$cms = Start-Process -FilePath 'node.exe' -WorkingDirectory $ProjectRoot -WindowStyle Hidden `
  -ArgumentList @('src/cli.mjs', 'cms', "$port") -PassThru

$config = Get-Content -LiteralPath (Join-Path $ProjectRoot 'config.json') -Raw | ConvertFrom-Json
$basePath = ([Uri]$config.site.url).AbsolutePath.TrimEnd('/')
if ($basePath -eq '/') { $basePath = '' }
$previewUrl = "http://127.0.0.1:$port/"
$cmsUrl = "http://127.0.0.1:$port/cms/"

Start-Sleep -Milliseconds 800
Start-Process $previewUrl
Start-Process $cmsUrl
Write-Host "Frontend preview: $previewUrl"
Write-Host "CMS: $cmsUrl"
Write-Host 'Services keep running after closing this window. Run this script again to restart them.'
Write-Host 'Press Enter to close this window.'
[void](Read-Host)
