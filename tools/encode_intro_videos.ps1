param(
  [Parameter(Mandatory = $false)]
  [string]$InputDir = (Join-Path $PSScriptRoot "..\assets\intro\raw"),

  [Parameter(Mandatory = $false)]
  [string]$OutputDir = (Join-Path $PSScriptRoot "..\assets\intro"),

  [Parameter(Mandatory = $false)]
  [ValidateRange(240, 2160)]
  [int]$Height = 1080,

  [Parameter(Mandatory = $false)]
  [ValidateSet(24, 25, 30, 50, 60)]
  [int]$Fps = 30,

  [Parameter(Mandatory = $false)]
  [ValidateRange(18, 35)]
  [int]$Crf = 23,

  [Parameter(Mandatory = $false)]
  [ValidateSet("ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow")]
  [string]$Preset = "medium",

  [Parameter(Mandatory = $false)]
  [switch]$KeepAudio

  ,
  [Parameter(Mandatory = $false)]
  [switch]$BackupWhenOverwriting
)

$ErrorActionPreference = "Stop"

function Assert-CommandExists([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Missing required command '$Name'. Install ffmpeg and make sure it's on PATH. Try: winget install Gyan.FFmpeg"
  }
}

Assert-CommandExists "ffmpeg"

$inputPath = Resolve-Path -Path $InputDir -ErrorAction SilentlyContinue
if (-not $inputPath) {
  Write-Host "Input folder not found: $InputDir" -ForegroundColor Yellow
  Write-Host "Create it and drop your source .mp4 files in there." -ForegroundColor Yellow
  Write-Host "Example: mkdir '$InputDir'" -ForegroundColor Yellow
  exit 1
}

if (-not (Test-Path -Path $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$inputFiles = Get-ChildItem -Path $inputPath -Filter *.mp4 -File | Sort-Object Name
if ($inputFiles.Count -eq 0) {
  Write-Host "No .mp4 files found in: $inputPath" -ForegroundColor Yellow
  exit 0
}

Write-Host "Encoding $($inputFiles.Count) file(s)" -ForegroundColor Cyan
Write-Host "Input:  $inputPath" -ForegroundColor Cyan
Write-Host "Output: $OutputDir" -ForegroundColor Cyan
Write-Host "Target: ${Height}p @ ${Fps}fps, H.264, CRF $Crf, preset $Preset" -ForegroundColor Cyan

foreach ($file in $inputFiles) {
  $outFile = Join-Path $OutputDir $file.Name

  $inputFull = (Resolve-Path $file.FullName).Path
  $outputFull = $outFile
  try { $outputFull = (Resolve-Path $outFile -ErrorAction Stop).Path } catch { $outputFull = $outFile }

  $writeToTempThenReplace = $false
  $finalOutFile = $outFile
  if ($inputFull -eq $outputFull) {
    $writeToTempThenReplace = $true
    $finalOutFile = Join-Path $OutputDir ("{0}.tmp.mp4" -f [IO.Path]::GetFileNameWithoutExtension($file.Name))
  }

  $audioArgs = @("-an")
  if ($KeepAudio) {
    $audioArgs = @("-c:a", "aac", "-b:a", "128k")
  }

  # scale=-2:HEIGHT keeps aspect ratio and forces even width (required by many encoders)
  $vf = "scale=-2:$Height,fps=$Fps"

  Write-Host "\n$file -> $outFile" -ForegroundColor Green

  & ffmpeg -y -hide_banner -loglevel warning `
    -i $file.FullName `
    @($audioArgs) `
    -vf $vf `
    -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p `
    -preset $Preset -crf $Crf `
    $finalOutFile

  if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg failed on: $($file.FullName)"
  }

  if ($writeToTempThenReplace) {
    if ($BackupWhenOverwriting -and (Test-Path -Path $outFile)) {
      Copy-Item -Path $outFile -Destination ("$outFile.bak") -Force
    }
    Move-Item -Path $finalOutFile -Destination $outFile -Force
  }
}

Write-Host "\nDone." -ForegroundColor Cyan
Write-Host "If scrolling is still heavy, try: -Height 720 -Crf 25" -ForegroundColor Cyan
