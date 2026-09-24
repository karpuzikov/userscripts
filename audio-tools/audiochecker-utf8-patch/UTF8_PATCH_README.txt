AudioChecker UTF-8 experimental compatibility patch

================================================



What changed

- Added external Windows manifests that force UTF-8 as the active process code page for AudioChecker and every bundled command-line EXE.

- Converted the bundled Russian and Hungarian language files, Hungarian whats-new file, and existing results.log to UTF-8.

- Original executable code was not modified.



Why

AudioChecker v2.0 beta build 457 is an old Delphi/VCL ANSI application. It uses ANSI Win32 APIs such as CreateFileA, FindFirstFileA and GetOpenFileNameA, so characters outside the current Windows ANSI code page can fail in file/folder names.



Requirements

- Windows 10 version 1903 or newer, or Windows 11.



How to test

1. Extract the entire folder.

2. Run achkgui.exe normally.

3. Test an audio file whose full path contains characters that previously failed.



Important

This is an experimental compatibility patch for a closed-source legacy program. The Windows UTF-8 manifest makes ANSI (-A) APIs use UTF-8, but old Delphi/VCL code and old bundled codecs were not designed for Unicode. Some UI drawing or a specific codec may still fail on particular characters.



Rollback

Delete the *.manifest files and restore the original text/language files from the unmodified archive.
