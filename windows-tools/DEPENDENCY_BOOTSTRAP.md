# Windows Dependency Bootstrap and Software Layout Policy

Standalone Windows tools in this repository follow these defaults.

## Dependency bootstrap

1. Check whether WinGet is available before the tool starts.
2. If WinGet is missing, bootstrap the latest WinGet with Microsoft's WinGet repair path, with the App Installer package as a fallback.
3. Check every required external dependency.
4. Install missing dependencies automatically.
5. Check WinGet-managed dependencies for updates and upgrade them when appropriate.
6. Start the tool only after required dependencies are ready.
7. Prefer WinGet; use another reliable automatic installation method when a dependency is unavailable through WinGet.

A first run on a fresh Windows installation may require an internet connection and Windows permission to install software.

## Python rules

- Standalone Python GUI software uses `.pyw` by default.
- Do not ship ordinary standalone GUI utilities as `.py`.
- A `.py` helper is acceptable only when the software itself starts through a BAT and keeping the helper separate is materially better for reliability.
- Provide complete runnable software rather than partial code fragments.
- Keep normal Windows Python and application-specific embedded Python environments separate. Do not modify an unrelated embedded environment such as ComfyUI's `python_embeded` unless that tool explicitly targets it.

## File-count rule

- Use as few files as practical.
- Prefer one self-contained `.bat` or `.pyw`.
- Embed small helper scripts, manifests, configuration, or payloads when doing so remains reliable.
- Remove redundant launchers and helper files.
- If a fresh Windows PC needs Python before a GUI can run, a single BAT may bootstrap Python and run an embedded temporary `.pyw` payload.
- Multiple runtime files are kept only when the host application or software architecture genuinely requires them.

## Host-required exceptions

Some tools execute inside another application and must keep that host's required format:

- Tampermonkey userscripts: `.user.js`
- Adobe Photoshop scripts: `.jsx`
- MusicBrainz Picard plugins: `__init__.py` and plugin metadata files
- MusicBrainz Picard script snippets: text copied into Picard

Where practical, a single Windows downloader/installer prepares the minimum required host-side files.


## Credential storage

Any software that needs authentication data follows one shared Windows credential-storage convention from its first release.

- Resolve the actual Windows Documents known folder dynamically. Never assume `C:\Users\<name>\Documents` because Documents may be moved or redirected.
- Use one common root under Documents:
  `<Documents>\Software Credentials\<App Name>\`
- Reuse the same per-app credential location across future versions so users do not have to enter API keys, tokens, cookies, login/session data, or similar secrets again after an update.
- Protect secrets at rest with Windows DPAPI for the current Windows user whenever practical.
- Treat login-capable session material (for example exported sessions, tokens, cookies, refresh tokens, or API secrets) as credentials and protect it too.
- Migrate known legacy credential locations automatically when possible.
- Migration should be copy/convert-first and only delete the old plaintext secret after the new protected store has been written and verified.
- Preserve backward compatibility with existing credential locations and formats whenever practical.
- Never commit real credentials to GitHub and never write secrets to normal application logs.
- Non-secret settings, caches, logs, and generated data do not belong in the shared credential store.
- Browser userscripts that merely inherit an existing browser/site login must not copy browser cookies or session data into this store unless the script itself explicitly needs to persist credentials.
