# REA findings: DROffline MkII 2.2.3 DR / LUFS / true-peak pipeline vs Audio_Analysis_Suite v0.01.02

Checkpoint: 2026-11-19, Windows 11 x64. Status: investigation evidence. The application is still
**Under construction ⚠️**. Nothing in this folder claims parity for the app.

## 1. What was analysed

| Target | SHA-256 | Result |
|---|---|---|
| `C:\test\test.exe` = **DROffline MkII Setup 2.2.3** (Inno Setup, x86 PE) | `1f1405b3411c8f21a5ffb960cc0c40d916dc3f7c5ef1014c385680932d94997d` | `rea analyze` → `rea/installer_test.exe_rea_analyze.json` (evidence `ev_d1db0368…`). This is the installer stub, so it holds no DSP code. |
| `Targets/DROffline/libMAATDROffline2.dll` (from kit v0.01.01 ZIP) | `0db8fc4a4f709e3f4583276bd1cb08fcf24932b3ab8dc0cb870bb44612266ab5` (matches the kit) | `rea decompile-all`: 3,442 functions written, 0 failed (`ev_4ff42c3e…`) |
| `Targets/DROffline/DROffline MkII.exe` (from kit v0.01.01 ZIP) | `99f4e976d005ea02166903a624ff24ce987e035214c8043b1c645358fb1cc35b` (matches the kit) | `rea decompile-all`: 16,675 functions written, 0 failed (`ev_834912c9…`) |

Tooling: REA CLI 6.9.0 via `npx rea-agents@6.9.0`, Ghidra 12.2, JDK 25.0.5. `rea doctor --provider ghidra` reported
healthy once `GHIDRA_INSTALL_DIR` was set. Running `rea analyze` on the installer, as the original command line did, only
shows the setup stub. The DSP lives in the two installed binaries, so those were analysed.
The decompiled pseudocode of these proprietary binaries is **not** published. This file and
`behavior-contract.json` record addresses, constants and the recovered behaviour. Regenerate it locally with
`rea decompile-all <binary> --provider ghidra --output <dir>`.

## 2. Recovered pipeline (static, confirmed by differential test)

Per file (`DROffline MkII.exe` FUN_140015d80 → FUN_140016400 per chunk → FUN_140016550 finalize):

1. **Rejections**:
   - Applies only to 1 or 2 channels.
   - Bit depth > 32 → `Unsupported bit depth: N`.
   - `frames / sampleRate < 10.0` → `Length is less than … seconds`. Exactly 10.0 s is accepted.
2. **Chunking**:
   - Chunk = DR block = `rint(sr × 132480 / 44100)` frames, rounded half-to-even via the 1.5·2^52 trick. That is 132480 at 44.1 kHz and 144196 at 48 kHz (`DynamicRangeValuesOffline::prepare`, DLL 0x180051c40).
   - The EXE reads that size inline (+0x1c0 + 0x27108); it never calls `getBlockSize`.
   - The same chunk goes to the true-peak detector, `processBlock` and `LUFSProcessor::processOfflineAudio`.
3. **True peak**: `DSP::TruePeakDetector<float>`, which is in the EXE, not the DLL.
   - sr ≤ 48000 → ×4 using the BS.1770 Annex 2 48-tap, 4-phase interpolator (12 taps per phase, FUN_140164b10).
   - 48000 < sr ≤ 96000 → ×2 with a 52-tap half-band filter (26 coefficients stored).
   - sr > 96000 → ×1 (sample peak).
   - Per channel: `max(|min|, |max|)` of the oversampled buffer, then max over chunks.
   - **Max. TPL** = `20·log10(max over channels)`, floor −100. It is **not capped at 0**.
4. **DR** (DLL):
   - Per block and channel: `peak² = max(float32 x²)`. If `peak² > 0.9999` **and exactly two equal repeats followed the running max**, peak² is set to 1.0.
   - Per block and channel: `rms² = 2·Σx² / n`, with n = the actual block length.
   - Each value is put in a histogram bin `trunc(−1000·log10(v))`, clamped to 0…9000 (0.01 dB resolution). Values ≤ 1e‑8 go to bin 9000 (−90 dB).
   - `getDR(c) = −0.01·bin(second-highest block peak) − 10·log10(Σ top-20 % rms² / n20)`.
     - n20 = `trunc(0.2·blocks)`, at least 1.
     - The top 20 % is filled from the loudest bin down; a bin can be partly used.
     - Each bin's value is reconstructed as `10^(−bin/1000)`.
   - `getCompositDR` = arithmetic mean of the channel DRs (unrounded double).
5. **Loudness** (DLL `LUFSProcessor`):
   - K-weighting uses **hard-coded float biquad tables** for 44.1/48/88.2/96/176.4/192/352.8/384 kHz.
     - Any other rate gets the default object FUN_18002a000 (not decoded).
     - The shelf table's 352.8 kHz entry is mistyped as **354800.0**. At 352.8 kHz the shelf therefore falls back to the default, while the high-pass table is correct.
   - 400 ms window, 100 ms hop. Channels are summed with weight 1.
   - Absolute gate `L > −70` (strict) builds the list that sets the relative threshold `Γr = L(mean of that list) − 10`.
   - **Integrated = mean of all windows with `L > Γr`.** The relative gate is applied to all windows and is not combined with the −70 gate.
   - Floor −128.0. Per-channel values add +3 dB, with floor −125.
   - The EXE reads LUFSi as `getCombinedLUFSValue(2)`.
6. **Other per-file values** (FUN_140016550):
   - Per-channel sample peak and RMS from the EXE's own trackers.
   - Per-channel max momentary and short-term LUFS.
   - PSR = `min(TPL, 0) − LUFSi`.
   - LRA, and PLR (min peak-to-loudness, floor 0).
   - Bits used (BitsUsed DLL class), skipped for float sources.
   - Mono files blank the per-channel fields with FLT_MIN.
7. **Album DR** (FUN_1401525c0):
   - Needs ≥ 2 accepted tracks; the single-track branch was not decoded.
   - `getAlbumDR` = arithmetic mean of the **unrounded** composite DRs (record +0x84), then `roundToInt` = round half to even (FUN_140013a90).

**Differential confirmation.** `harness/parity_harness.py` is an independent Python model of points 2–5. It was run on
the 23 accepted reference fixtures and reproduces the original report display strings:

- **Max. TPL: 23/23**
- **LUFSi: 23/23**
- **DR: 23/23**
- **Album DR: 1** (mean 0.9633 → 1)

The model's DR display uses half-to-even rounding of the composite. The corpus has no .5 tie, so that rounding is inferred
from the shared `roundToInt` helper and has not been observed.

## 3. Mismatches: app v0.01.02 vs original (PASS / FAIL / NOT RUN)

Corpus results come from running the app's own `analyze_one` / `dr_folder_report` on the 29 reference fixtures (23 accepted).
"static" means the result is from code comparison only.

| # | Item | Original | App v0.01.02 | Result |
|---|---|---|---|---|
| 1 | Max. TPL values | BS.1770 interpolator (see §2.3) | `scipy.signal.resample_poly` | **FAIL**: 2/23 rows match. Sines show −6.02 instead of −6.01. Noise −2.27 vs −2.75. Peaks −0.08 vs −0.33. Square −3.97 vs −4.02. DC −10.95 vs −11.09. Intersample +1.97 vs +1.93. |
| 2 | Oversampling factor by sample rate | ×4 ≤48k, ×2 ≤96k, ×1 above | ×4 <96k, ×2 <192k, ×1 ≥192k | **FAIL** (static: 88.2k, 176.4k and 64k differ). Numeric: NOT RUN (no accepted fixture at those rates). |
| 3 | TPL floor −100, no cap at 0 | yes | yes | **PASS** (01 Silence −100.00; 21 +1.03) |
| 4 | DR block length | `rint(sr·132480/44100)` = 132480 @44.1k | `int(sr·3)` = 132300 | **FAIL** (static) |
| 5 | DR peak statistic | **second-highest** block peak, 0.01 dB bins | highest peak over all blocks | **FAIL**: 09 Isolated peaks 30 vs 28; 26 Intersample peaks −3 vs −1 |
| 6 | Clip-snap rule (peak² > 0.9999 with exactly 2 repeats → 1.0) | present | absent | **FAIL** (static) |
| 7 | DR top-20 % count | `trunc(0.2·N)`, min 1, partial bins, quantised `10^(−bin/1000)` | `ceil(0.2·N)` exact means | **FAIL** (static) |
| 8 | Silent channel / floor | power ≤1e‑8 → −90 dB in both peak and RMS → channel DR 0 | `db()` floor −100 and constant −3.0103 → −3.01 | **FAIL**: 04 Left channel only shows −2 instead of 0 |
| 9 | Composite and display rounding | mean of channel DRs, round half-even (inferred) | mean, then `floor(x+0.5)` | **FAIL** (static, differs only on .5 ties). Corpus value impact covered by #5 and #8. |
| 10 | Final incomplete block | `processBlock` uses n = chunk length, so a partial chunk is averaged over its own length. Whether the reader delivers the last partial chunk was not traced. | skipped | **NOT RUN**: the corpus does not tell the two apart (model with and without the partial block both give 23/23) |
| 11 | K-weighting coefficients | fixed float tables (§2.5) | pyloudnorm filter design at any rate | **FAIL**: 21/23 rows match. 07 Changing levels −8.51 vs −8.52; 11 DC −35.34 vs −35.35. |
| 12 | Gating | abs `L > −70` (strict); relative gate over all windows | `L ≥ −70`; `L > max(−70, Γr)` | **FAIL** (static). Numeric: NOT RUN (needs a very quiet fixture). |
| 13 | Unsupported rates / 352.8 kHz shelf typo | default filter object (FUN_18002a000, not decoded) | designed filter | **NOT RUN** |
| 14 | Channel limits | DSP arrays hold 2 channels; checks only for 1–2 ch | up to 32 ch with surround weights | **FAIL** (static); the original's message for more than 2 channels is unresolved |
| 15 | Silence LUFS −128.00 | yes | yes | **PASS** |
| 16 | 10 s minimum | `< 10.0` rejected | `< 10` rejected | **PASS** (6 fixtures rejected in both). Message text: **FAIL**, `Length is less than … seconds` vs `DR rejected: shorter than 10 seconds`. |
| 17 | Bit depth > 32 rejection | `Unsupported bit depth: N` | absent | **FAIL** (static) |
| 18 | Report header LUFSi column width | 7 (`  LUFSi`, `-128.00`) | 6 | **FAIL**: 23 data lines plus the header differ |
| 19 | Album label | `Official EP/Album DR: N` | `Experimental EP/Album DR: N` | **FAIL** (deliberate experimental label) |
| 20 | Album DR method | `rint(mean of unrounded composites)`, ≥2 tracks | `floor(mean of rounded ints + 0.5)` | **FAIL** (static). Corpus value: **PASS** (1 = 1) |
| 21 | Trailing bytes | 30 CRLF, no extra empty line | extra final CRLF | **FAIL** (2,428 vs 2,483 bytes before normalising the folder line) |
| 22 | File name, Format, SR, Word Length columns and folder line format | — | — | **PASS** on all 23 rows |
| 23 | PSR, LRA, PLR, per-channel peak/RMS/LUFS (+3 dB, −125 floor), bits used, momentary/short-term max | recovered (§2.6) | not implemented | **NOT RUN** (no original outputs for these columns) |
| 24 | 27-column "All In for Stats Nerds", TSV, metadata | — | — | **NOT RUN** |
| 25 | AudioChecker / auCDtect | — | — | **NOT RUN** (outside this pass) |
| 26 | Native Windows GUI acceptance | — | — | **NOT RUN** |

Raw evidence:
- `parity/harness_rows.json`: per file, the app's values, the model's values and the golden values.
- `parity/parity_summary.json`: the formatted comparison.
- `parity/app_v0.01.02_report_normalized_folder.txt`: the app's report bytes. Only line 2 (the folder path) was replaced with the reference folder, so a byte diff against `Reference/Audio Tests_log.txt` is meaningful.

## 4. Unresolved

- The reader loop that delivers the final partial chunk (item 10).
- `FUN_18002a000`, the default K-filter object for unlisted rates.
- The single-track album branch.
- The exact float formatter for TPL/LUFSi, and DR display rounding at .5 ties.
- The behaviour and message for more than 2 channels.
- The 26-tap ×2 half-band reconstruction. The model's symmetric 52-tap form matched 17 96000Hz (−6.01), but it is not fully decoded.
- The bodies of the LRA/PLR percentile code (10 % and 95 % indices are visible in the DLL's hiResTimerCallback).

## 5. Reproduce

```powershell
$env:GHIDRA_INSTALL_DIR="C:\MySoft\ghidra_12.2_PUBLIC"; $env:JAVA_HOME="<JDK 25>"
npx -y rea-agents@6.9.0 doctor --provider ghidra --json
npx -y rea-agents@6.9.0 decompile-all ".\Targets\DROffline\libMAATDROffline2.dll" --provider ghidra --output dll_c --format json
npx -y rea-agents@6.9.0 decompile-all ".\Targets\DROffline\DROffline MkII.exe" --provider ghidra --output exe_c --format json
python -m venv venv; venv\Scripts\pip install numpy scipy pyloudnorm
venv\Scripts\python -I Findings\harness\parity_harness.py Audio_Analysis_Suite_v0.01.02.pyw "Reference\Audio Tests" Reference\droffline-golden.json "Reference\Audio Tests_log.txt" out
venv\Scripts\python -I Findings\harness\summarize.py out\harness_rows.json out\parity_summary.json
```
FFmpeg must be on PATH. The harness redirects the app's data folder into `out\appdata`.
