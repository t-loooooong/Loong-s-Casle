$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$ocrAsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Wait-OcrOperation($Operation, [Type]$ResultType) {
  $task = $ocrAsTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language('zh-Hans-CN')))
if ($null -eq $engine) { throw 'Chinese OCR engine unavailable' }
if ($env:GUNPLA_OCR_DIAGNOSE -eq '1') { Write-Output 'Chinese OCR available'; return }
$ocrOutput = $env:GUNPLA_OCR_OUTPUT
if (-not [System.IO.Path]::IsPathRooted($ocrOutput)) { throw 'Absolute OCR output directory required' }
$frames = Get-Content -Raw -LiteralPath (Join-Path $ocrOutput 'frames.json') | ConvertFrom-Json
$results = @()
foreach ($frame in $frames) {
  if ($frame.file -notmatch '^frame-[0-9]{4}\.jpg$') { throw 'Invalid frame identity' }
  # Use ordinary authorized file reads, then decode an in-memory stream. No file broker or permission changes.
  $bytes = [System.IO.File]::ReadAllBytes((Join-Path $ocrOutput ('frames\' + $frame.file)))
  $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $writer = New-Object Windows.Storage.Streams.DataWriter($stream)
  $writer.WriteBytes($bytes)
  $null = Wait-OcrOperation ($writer.StoreAsync()) ([uint32])
  $null = $writer.DetachStream()
  $writer.Dispose()
  $stream.Seek(0)
  try {
    $decoder = Wait-OcrOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Wait-OcrOperation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    try {
      $result = Wait-OcrOperation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      $lines = @($result.Lines | ForEach-Object {
        @{ text=$_.Text; words=@($_.Words | ForEach-Object { @{text=$_.Text;x=$_.BoundingRect.X;y=$_.BoundingRect.Y;width=$_.BoundingRect.Width;height=$_.BoundingRect.Height} }) }
      })
      $results += @{file=$frame.file;seconds=$frame.seconds;width=$frame.width;height=$frame.height;lines=$lines}
    } finally { if ($bitmap) { $bitmap.Dispose() } }
  } finally { $stream.Dispose() }
}
[System.IO.File]::WriteAllText((Join-Path $ocrOutput 'ocr-results.json'),(ConvertTo-Json -InputObject $results -Depth 10),(New-Object System.Text.UTF8Encoding($false)))
Write-Output ('Recognized frames: ' + $results.Count)
