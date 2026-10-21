# Audio Analysis Suite v0.01.00 - Under construction ⚠️

## Application source

[**Download Audio_Analysis_Suite_v0.01.00.pyw**](Audio_Analysis_Suite_v0.01.00.pyw)

This is an **operational, independent, experimental Python application**, not a completed DROffline or AudioChecker replacement.

- Dark PySide6 desktop UI; add files/folders or drag files/folders.
- Concurrent analysis with selectable worker count; Stop requests cancellation and terminates active FFmpeg decoders.
- Peak Music Foundation-style **experimental DR estimate** (not yet MAAT parity); BS.1770-weighted/gated integrated loudness; oversampled true peak.
- **Experimental spectral screen**: identifies known lossy codecs, possible lowpass signatures, or indeterminate cases. **NOT auCDtect**, and not proof of losslessness.
- TXT and TSV results, one per-run diagnostic log, remembered settings, no modification to source audio.
- Supports WAV, FLAC, AIFF, MP3, AAC/M4A, Opus and other audio formats accepted by the active FFmpeg decoder. Tested formats are listed below.

Python 3.10+ is required. On Windows, double-click the `.pyw`; it attempts to install missing Python packages automatically, uses FFmpeg already installed or tries `winget` first and then a bundled FFmpeg fallback. **Native Windows execution and GUI visual QA have not been run.** Do not represent it as a tested Windows `.exe`.

Headless example:

```powershell
py Audio_Analysis_Suite_v0.01.00.pyw --headless --dr --auth --workers 4 "D:\\Music\\test.wav" --output "D:\\Music\\analysis.tsv"
```

## Validation

- PASS: Python compilation; synthetic 12-second PCM stereo/mono sine, silence, square-wave, DC tests; basic expected DR/loudness/true-peak values; TSV export.
- PASS: independent test files encoded as FLAC, MP3, Opus, AAC/M4A, AIFF and 5.1 WAV; sub-10-second DR-only rejection; CLI smoke report.
- NOT RUN: Windows GUI visual/interaction tests, native exe packaging, target-application full-column reports, auCDtect comparison, original-program differential numerical parity.
- Known mismatch: synthetic square-wave loudness differs from the prior original report (-2.23 versus -3.04 LUFS). A successful few-metric comparison is **not** original parity.

Tests: [tests/test_app_v0.01.00.py](tests/test_app_v0.01.00.py).

## Investigation kit (separate)

[Audio_Parity_REA_Kit_v0.01.01.zip](downloads/Audio_Parity_REA_Kit_v0.01.01.zip) contains original reference targets, 29 fixtures and 23 original rows. It is a research/test asset, **not an app download**.

See [REA_TASK.md](REA_TASK.md), [CONTINUITY.md](CONTINUITY.md) and [docs/behavior-spec.md](docs/behavior-spec.md) for the remaining true-parity requirements. No GitHub Actions workflow was modified.
