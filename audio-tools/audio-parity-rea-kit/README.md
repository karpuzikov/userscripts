# Audio parity REA kit v0.1.1 - Under construction

The combined DROffline MkII / AudioChecker application is not implemented.
This is the complete investigation checkpoint for continuing that work.

1. Open the extracted folder in local Codex with REA and Ghidra available.
2. Send: `Read CONTINUITY.md and REA_TASK.md, then continue the investigation.`

The kit includes the original analysis targets, 29 unchanged generated audio
fixtures, the user's existing 23-row DROffline report, parsed golden values,
current rules, evidence and the proposed UI/behavior contract.

Run `python verify_kit.py` to verify retained hashes. Those checks do not
prove replacement parity. Native measurement, full-report compatibility and
Windows GUI acceptance remain NOT RUN.

For runtime reference measurements use the installed original applications.
The copied DROffline files are static analysis targets, not a portable setup.

Version 0.1.1 replaces a later-discovered truncated 0.1.0 ZIP. See CONTINUITY.md
and evidence/archive-recovery.json. No application version was changed.

Canonical GitHub checkpoint:
https://github.com/karpuzikov/userscripts/tree/main/audio-tools/audio-parity-rea-kit

Upstream sources checked on 2026-10-21:
- https://github.com/morluto/rea
- https://github.com/morluto/rea/blob/main/docs/cli.md
- https://github.com/morluto/rea/blob/main/docs/windows-ghidra-p0.md
- https://www.maat.digital/dro2/

## Download complete kit

[Audio_Parity_REA_Kit_v0.01.01.zip](downloads/Audio_Parity_REA_Kit_v0.01.01.zip)

The full ZIP contains all analysis targets and generated audio fixtures.
The documents and reference metadata are also browsable in this folder.

[Copy-ready handoff](HANDOFF.md) | [Detailed checkpoint](CONTINUITY.md)

Do not use the older truncated v0.01.00 ZIP.
