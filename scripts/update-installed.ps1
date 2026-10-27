param(
  [Parameter(Mandatory=$true)][string]$InstallDirectory,
  [string]$SourceDirectory,
  [string]$BackupDirectory
)
$ErrorActionPreference = 'Stop'
if (-not $SourceDirectory) { $SourceDirectory = Join-Path $PSScriptRoot '..\release\win-unpacked' }
if (-not $BackupDirectory) { $BackupDirectory = Join-Path $PSScriptRoot ('..\..\..\work\installed-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
$installRoot = (Resolve-Path -LiteralPath $InstallDirectory).Path.TrimEnd('\')
$sourceRoot = (Resolve-Path -LiteralPath $SourceDirectory).Path.TrimEnd('\')
$backupRoot = [IO.Path]::GetFullPath($BackupDirectory)
if ($installRoot -eq $sourceRoot) { throw '源目录不能是安装目录' }
function Inside([string]$root, [string]$relative) {
  $target = [IO.Path]::GetFullPath((Join-Path $root $relative))
  if (-not $target.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '文件路径超出目标目录' }
  return $target
}
foreach ($relative in @('QueryDesk.exe','resources\app.asar','resources\runtime\java\bin\java.exe','resources\runtime\jdbc\querydesk-bridge.jar')) {
  if (-not (Test-Path -LiteralPath (Inside $sourceRoot $relative) -PathType Leaf)) { throw "构建文件缺失：$relative。请先运行 npm run pack" }
}
if (-not (Test-Path -LiteralPath (Inside $installRoot 'QueryDesk.exe') -PathType Leaf)) { throw '目标不是 QueryDesk 安装目录' }
$running = Get-CimInstance Win32_Process -Filter "Name = 'QueryDesk.exe'" | Where-Object { $_.ExecutablePath -eq (Join-Path $installRoot 'QueryDesk.exe') }
if ($running) { throw 'QueryDesk 正在运行。请通过界面正常退出并处理未提交事务，然后重新执行更新。不会强制结束进程。' }
# This updater changes app resources only; reject an Electron runtime change.
foreach ($file in (Get-ChildItem -LiteralPath $sourceRoot -File | Where-Object Name -ne 'QueryDesk.exe')) {
  $installed = Inside $installRoot $file.Name
  if (-not (Test-Path -LiteralPath $installed) -or (Get-FileHash -LiteralPath $installed).Hash -ne (Get-FileHash -LiteralPath $file.FullName).Hash) { throw "Electron 运行时文件发生变化：$($file.Name)。请使用完整目录升级。" }
}
$files = @((Get-Item -LiteralPath (Inside $sourceRoot 'QueryDesk.exe')), (Get-Item -LiteralPath (Inside $sourceRoot 'resources\app.asar')))
$files += Get-ChildItem -LiteralPath (Inside $sourceRoot 'resources\runtime') -Recurse -File
$changes = @()
foreach ($file in $files) {
  $relative = $file.FullName.Substring($sourceRoot.Length + 1)
  $target = Inside $installRoot $relative
  $existed = Test-Path -LiteralPath $target -PathType Leaf
  $sha = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  if ($existed -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $sha) { continue }
  $changes += [PSCustomObject]@{relative=$relative;existed=$existed;sha256=$sha}
}
if (-not $changes.Count) { Write-Output '已安装文件与构建一致，无需更新'; exit 0 }
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
foreach ($change in $changes) {
  if ($change.existed) {
    $backup = Inside $backupRoot $change.relative
    New-Item -ItemType Directory -Path (Split-Path $backup) -Force | Out-Null
    Copy-Item -LiteralPath (Inside $installRoot $change.relative) -Destination $backup
  }
}
$record = [PSCustomObject]@{installedAt=(Get-Date -Format o);installation=$installRoot;source=$sourceRoot;backup=$backupRoot;files=$changes}
$record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $backupRoot 'update.json') -Encoding UTF8
$applied = @()
try {
  foreach ($change in $changes) {
    $target = Inside $installRoot $change.relative
    New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
    $applied += $change
    Copy-Item -LiteralPath (Inside $sourceRoot $change.relative) -Destination $target -Force
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $change.sha256) { throw "更新后校验失败：$($change.relative)" }
  }
} catch {
  foreach ($change in $applied) {
    $target = Inside $installRoot $change.relative
    if ($change.existed) { Copy-Item -LiteralPath (Inside $backupRoot $change.relative) -Destination $target -Force }
    elseif (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
  }
  throw
}
Write-Output "更新完成：$($changes.Count) 个文件；原文件备份：$backupRoot。连接配置未修改。"
