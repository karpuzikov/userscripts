# VULTURES 2 reference measurements and report parity

Date: 2026-10-21. Source: user-provided original AudioChecker 2.0 beta build 457 and DROffline MkII 2.2.3 reports, compared with Audio Analysis Suite v0.01.01. **These are recorded text observations; the 16 source FLAC files were not provided to this environment.**

Reference folder: `2024-08-03T00_00_00Z - VULTURES 2`.

| Track | Original AudioChecker | Original TPL | v0.01.01 TPL | Original LUFSi | v0.01.01 LUFSi | Original DR | v0.01.01 DR |
|---|---|---:|---:|---:|---:|---:|---:|
| 01 SLIDE | CDDA (100%) | +0.23 | +0.09 | -9.21 | -9.21 | 4 | 4 |
| 02 TIME MOVING SLOW | CDDA (100%) | +0.05 | +0.04 | -6.99 | -6.98 | 2 | 2 |
| 03 FIELD TRIP | CDDA (100%) | +0.09 | +0.07 | -6.15 | -6.14 | 2 | 2 |
| 04 FRIED | CDDA (100%) | +0.23 | +0.11 | -6.62 | -6.61 | 4 | 4 |
| 05 ISABELLA | MPEG (95%) | Rejected | Rejected | — | — | — | — |
| 06 PROMOTION | CDDA (100%) | +0.18 | +0.06 | -8.19 | -8.18 | 3 | 3 |
| 07 530 | MPEG (100%) | -0.01 | -0.02 | -10.45 | -10.45 | 8 | 8 |
| 08 DEAD | CDDA (99%) | +0.15 | +0.22 | -6.04 | -6.03 | 0 | 0 |
| 09 FOREVER ROLLING | CDDA (100%) | +0.08 | +0.01 | -7.61 | -7.61 | 4 | 4 |
| 10 BOMB | CDDA (100%) | +0.03 | +0.02 | -8.50 | -8.49 | 4 | 4 |
| 11 RIVER | CDDA (100%) | +0.15 | +0.07 | -9.40 | -9.40 | 4 | 4 |
| 12 FOREVER | CDDA (100%) | -0.00 | -0.02 | -10.96 | -10.96 | 9 | 9 |
| 13 HUSBAND | CDDA (94%) | -0.01 | -0.03 | -8.40 | -8.39 | 4 | 4 |
| 14 LIFESTYLE | CDDA (100%) | +0.06 | +0.04 | -6.97 | -6.97 | 4 | 4 |
| 15 SKY CITY | CDDA (100%) | +0.19 | +0.04 | -9.25 | -9.25 | 4 | 5 |
| 16 MY SOUL | CDDA (100%) | +0.08 | +0.01 | -6.96 | -6.95 | 3 | 3 |

- AudioChecker original report ends `Summary 87,38% CDDA`, then an eight-digit log verification value `86168036`. The v0.01.01 spectral-screen implementation produced `Indeterminate` for all 16 tracks. The v0.01.02 compatibility backend has not been run on these original FLAC inputs.
- Verified mathematical composition from the supplied percentages: CDDA contributes p; MPEG contributes 100-p. Total CDDA-equivalent score = 1398 out of 16 × 100, or 87.375%; rounded half up to two decimal places gives 87.38% (comma decimal separator in the supplied report).
- The last numeric log entry is an AudioChecker verification/checksum field. Algorithm **not recovered**, and the new app must never copy `86168036` for other files.
- Original DROffline accepts 15 tracks (rejects short `05 ISABELLA`), and reports Official EP/Album DR 4.
- Among 15 accepted tracks, experimental DR differs on `15 SKY CITY`: original 4, experimental 5.
- True-peak absolute error averages **0.062 dB** across those 15 tracks, maximum **0.15 dB**. Not parity. Integrated loudness average absolute displayed error: **0.00533 LUFS**. Rounding/engine effects unresolved.
- The original DR report's file-name column is as wide as the longest accepted filename. The v0.01.01 report used a fixed 26-character minimum, causing misalignment. v0.01.02 adjusts the field width.
- `-0.00` is a legitimate signed printed value; preserve negative zero when available.
- Original report shows `Official EP/Album DR: 4`; because algorithm equivalence is unverified, the replacement retains an experimental qualifier rather than pretending to be an official value.
- No real v0.01.02 AudioChecker percentages have been measured on this album here. Auto-install/download of auCDtect has not been executed on Windows.
