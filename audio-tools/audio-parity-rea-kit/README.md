# Audio Analysis Suite v0.01.02 - Under construction ⚠️

**[Download application: Audio_Analysis_Suite_v0.01.02.pyw](Audio_Analysis_Suite_v0.01.02.pyw)**

Current app is a working **experimental Windows Python GUI**, not a verified independent replica of the proprietary programs. **No Windows .exe release is built.**

## What changed in v0.01.02

- Original-style AudioChecker compact per-track log: `NN -=- filename -=- CDDA/MPEG (percentage%)`.
- Actual classification calls the **original auCDtect 0.8.2 Windows engine**, supplied in the user's verified research ZIP. This is a **disclosed compatibility dependency, not an independent detector**. On the first Windows authenticity run the app downloads the pinned 0.1.1 research kit and SHA-256 verifies both kit and executable, extracts the engine under `Documents/Karpuzikov Tools/Audio Analysis Suite/dependencies/` and reuses it on later runs. Requires network access for that first run. Original user audio and original applications are unchanged. Never claim the original AudioChecker GUI decoder/mode parity without tests.
- User-supplied track probabilities can now produce exactly `Summary 87,38% CDDA` using CDDA p, MPEG 100-p, average, half-up rounding to two decimal places, and comma separator.
- DR default-column report now sizes the name column to the longest accepted track and preserves signed -0.00. DR, LUFS and TPL algorithms remain experimental.
- Original reports in the source folders are never overwritten unless an app-generated report has been recognized; repeat runs reuse only owned files.
- A failed auCDtect invocation keeps available DR output and reports an error rather than inventing CDDA/MPEG probabilities.

**Known original-output blocker:** AudioChecker's final 8-digit log verification value is not reproduced (the example ends with `86168036`). Its algorithm is not recovered. The historical GUI's PCM decoder conversion and detection-mode flags also remain unverified. Format similarity is **not byte parity**.

**Known DROffline discrepancies:** See [VULTURES 2 reference comparison](docs/vultures-2-parity.md): 15 accepted tracks, mean absolute TPL difference 0.062 dB, one DR mismatch (`SKY CITY` original 4 vs app 5), slight LUFS rounding differences. Those are original v0.01.01 results. The 16 FLAC source files were not available in this environment for rerunning v0.01.02.

## Usage

Download and double-click the `.pyw` on Windows with Python 3.10+ installed. Missing Python modules and FFmpeg are installed or resolved automatically where supported. Drag album folders or add files, select DR and/or Authenticity, set workers, click Analyze. Reports are saved to the source folder automatically; Export is optional.

- DR report: `<Album Folder>_log.txt`, preserving existing original file under fallback name.
- Authenticity report: `audiochecker.log`, preserving an unowned original report under fallback name.
- Separate diagnostics: `Documents/Karpuzikov Tools/Audio Analysis Suite/logs/`.
- Original media files never altered.

Headless:

```powershell
py Audio_Analysis_Suite_v0.01.02.pyw --headless --dr --auth --workers 4 "D:\\Music\\test.wav"
```

## Testing status

- PASS: compilation, text report/summary/parser regressions with 16 supplied reference observations; signed-zero formatting; safe report collisions.
- PASS: controlled end-to-end real audio -> FFmpeg temporary WAV -> **stub classifier subprocess** -> CDDA/MPEG parser/report; audio file unchanged.
- NOT RUN: actual Windows auCDtect executable invocation and first-run GitHub download, AudioChecker GUI side-by-side outputs, Windows GUI acceptance/screenshots, complete DROffline parity, full original TXT/TSV modes, native packaged .exe.
- No GitHub Actions workflow changes.

[Detailed project continuity](CONTINUITY.md) | [Original REA investigation task](REA_TASK.md) | [Research kit v0.1.1](downloads/Audio_Parity_REA_Kit_v0.01.01.zip)

