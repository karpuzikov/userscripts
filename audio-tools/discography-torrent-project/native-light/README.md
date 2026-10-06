# Duplicate Edition Analyzer Native Light Test

Status: **Under construction ⚠️**

Branch: `dea-native-light-test`

This is a ground-up native Windows rewrite created specifically to test a much lighter/faster architecture without changing the current stable DEA implementation.

## Architecture

- C++20 + raw Win32/Common Controls.
- One native x64 EXE.
- Static MSVC runtime.
- No Python runtime.
- No PySide6.
- No Qt.
- No Chromium / Qt WebEngine.
- WinGet is the primary dependency install/update channel. FFmpeg/FFprobe use `Gyan.FFmpeg`; direct downloading is fallback-only. Chromaprint is attempted through WinGet first and falls back to the official app-local build when no usable WinGet package is available.
- Persistent data lives under `Documents\Karpuzikov Tools\Duplicate Edition Analyzer Native Test\`.

The branch build has a hard **15 MB EXE size gate**. Runtime audio helper binaries are intentionally kept outside the executable in the program-owned `dependencies` directory so the UI/application binary stays genuinely small.

## Rule implementation

This rewrite is driven by the repository-wide `SOFTWARE_RULES.md` plus the DEA project rules. The explicit request for this branch overrides the old DEA-specific requirement that the active UI use PySide6/Qt WebEngine; the existing main application is untouched.

Implemented in this test:

- dark UI using the established DEA typography hierarchy;
- filesystem-path opener immediately before every visible editable/read-only path;
- folder paths open directly; file paths are selected in Explorer when possible;
- Existing discography remains optional;
- New / update releases is required;
- Save Remixes and Save Live recordings are direct global switches;
- **no Live/remix phrase review exists**;
- Unusual track pattern review is reserved for genuinely unknown version-like descriptors;
- Personal Picks persist separately and do not override disabled Remix/Live categories;
- progress stage + measurable count/rate + activity log;
- long audio work runs outside the UI thread;
- keyboard-focusable native controls and native accessibility semantics;
- destructive file application requires an explicit confirmation;
- Undo last run;
- Release Map stays planning-only until Apply file changes;
- ignored releases remain inspectable and restorable;
- track Ignore is exact-instance only;
- Initial vs Result counters are retained in Release Map;
- exact audio identity remains Chromaprint-based;
- no external database recording identifiers;
- duration is candidate routing only, not duplicate identity;
- fingerprint failures remain conservative unique recordings;
- Explicit supersedes corresponding Clean before fingerprint grouping;
- Remix and Live are separate unique recording roots;
- base Extended Version / Extended Mix is a unique recording root;
- Instrumental, Acapella/A Cappella and Acoustic are unique recording roots;
- Radio/Edit-style variants remain acoustically comparable to their base/root;
- parent-root precedence keeps Edit/Extended forms inside an existing Remix/Live/Acoustic/etc. root;
- every album family must be represented by a maximum-completeness edition;
- strict same-album wanted-content supersets dominate subsets before global optimization;
- outside singles/EPs cannot make a less-complete album edition represent the album;
- after album/wanted coverage, minimize total retained tracks first;
- then minimize retained releases;
- source/rip quality and Existing/Incoming are later tie-breaks;
- DR/mastering analysis is delayed until final interchangeable ties;
- CUE image rips are recognized as virtual tracks when multiple AUDIO tracks reference the same image;
- dependency checks are centralized and app-local.

## Native dependency strategy

The EXE checks/repairs WinGet first. Then:

- FFmpeg / FFprobe: install or upgrade through WinGet package `Gyan.FFmpeg`; direct app-local download only if WinGet cannot provide a working install.
- Chromaprint / fpcalc: try WinGet first; if no usable package is available, use the official app-local fallback.

Dependencies are stored under:

`Documents\Karpuzikov Tools\Duplicate Edition Analyzer Native Test\dependencies\`

No Qt/Python runtime is downloaded.

## Current test scope

This branch is intentionally separate from the production DEA and must not replace it until real-folder comparison logs confirm behavioral parity.

The release gate runs:

1. native compile with warnings enabled;
2. rule-regression self-tests;
3. EXE size check;
4. SHA-256 generation;
5. branch-only GitHub prerelease.


## 0.1.1

- Dependency policy is now WinGet-first.
- FFmpeg is installed/updated through `Gyan.FFmpeg` when WinGet is available.
- Built-in FFmpeg download is fallback-only.
- Chromaprint attempts WinGet first and falls back only when necessary.
- Fallback download progress uses human-readable B / KB / MB / GB units instead of raw byte counts.
