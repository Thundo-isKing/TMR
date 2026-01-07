# Intro feature videos

Put your feature videos in this folder and keep filenames in sync with `intro.html`.

Expected filenames (mp4):
- `calendar.mp4`
- `todos.mp4`
- `meibot.mp4`
- `notes.mp4`
- `themes.mp4`
- `account.mp4`

Mobile tutorial previews (mp4):
- `iphone-tutorial.mp4`
- `android-tutorial.mp4`

Notes:
- Keep videos short (5–12s) and optimized for web.
- `intro.html` uses `autoplay muted loop playsinline` so they behave like inline previews.

## Recommended export settings (important)

Your current files (2K / 60fps and 30–90MB) are *way* heavier than what an intro page can comfortably decode while snap-scrolling.

Good targets for these preview clips:
- Resolution: **1080p** (1920×1080) or **720p** (1280×720) if you want it extra smooth
- Frame rate: **30fps** (or even 24fps)
- Codec: **H.264** (MP4) for maximum compatibility
- Pixel format: **yuv420p** (important for iOS/Safari compatibility)
- Audio: strip it, or AAC 96–128kbps (but muted previews don’t need audio)
- Size goal: typically **2–12MB per clip** (depending on duration/detail)

## ffmpeg (Windows) quick commands

### Install ffmpeg (Windows)

Option A (recommended): install with `winget`:
```powershell
winget install --id Gyan.FFmpeg
```
Close/reopen PowerShell after installing, then verify:
```powershell
ffmpeg -version
```

Option B: if you don’t have `winget`, download an ffmpeg build and add its `bin` folder to your PATH.

If you have `ffmpeg` installed, these are good defaults:

**1080p / 30fps / no audio (recommended):**
```powershell
ffmpeg -y -i input.mp4 -an -vf "scale=-2:1080,fps=30" -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p -preset medium -crf 23 output.mp4
```

**720p / 30fps / no audio (smoothest / smallest):**
```powershell
ffmpeg -y -i input.mp4 -an -vf "scale=-2:720,fps=30" -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p -preset medium -crf 23 output.mp4
```

Tips:
- Lower `crf` = higher quality + larger file. Try `22–26`.
- If the result is still too big, try `-crf 25` or use 720p.

## HandBrake (easy GUI)

Preset: start from **Fast 1080p30** (or **Fast 720p30**), then:
- Video codec: H.264
- Framerate: 30 (constant)
- Quality: RF ~ 22–26
- Audio: remove track (or keep minimal)

After you re-encode, keep the filenames the same as `intro.html` expects.

## Batch convert helper (repo)

There is a helper script in `tools/encode_intro_videos.ps1`.

Usage:
```powershell
cd c:\Users\akenj\TMR_Project\TMR_redo
mkdir assets\intro\raw
# put your big 2K/60fps source clips into assets\intro\raw
.\tools\encode_intro_videos.ps1 -Height 1080 -Fps 30 -Crf 23
```

### Option B (recommended): keep originals + use `encoded/`

Encode into `assets/intro/encoded/` so you can A/B test quality without overwriting:
```powershell
cd c:\Users\akenj\TMR_Project\TMR_redo
mkdir assets\intro\encoded
.\tools\encode_intro_videos.ps1 -InputDir .\assets\intro -OutputDir .\assets\intro\encoded -Height 1080 -Fps 30 -Crf 23
```

`intro.html` can point at either `assets/intro/*.mp4` (originals) or `assets/intro/encoded/*.mp4` (optimized).

If you want smaller/faster:
```powershell
.\tools\encode_intro_videos.ps1 -Height 720 -Fps 30 -Crf 25
```
