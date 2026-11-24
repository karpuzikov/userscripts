# OLX - Model Tags

One userscript (`OLX_Model_Tags.user.js`) and three kinds of data in this folder. Nothing is hard-coded per website except where tags are shown (olx.ua).

| Cluster | File | Who writes it |
| --- | --- | --- |
| Data: models, groups, specs, stop phrases, brands | `olx-model-tags-catalog.json` | The owner (token). Everyone else reads it with no key and suggests changes through GitHub issues (`Suggest model` button). |
| Sources: websites the specs are captured from | `olx-model-tags-sources.json` | The owner. Everyone else submits a new site as an issue (below). |
| Personal: your ads, broken marks, filters | your browser (the owner's also `olx-model-tags-data.json`, read by the private Google Sheet) | You. |

The script only reads the page you already have open and contacts only GitHub.

## Add a website as a source

1. Save the page as HTML (Ctrl+S, "Webpage, HTML only"). Save one page per kind of page you want read (a product page, a ranking list).
2. Give your AI bot the HTML file(s) and this prompt:

> Write an adapter for the attached HTML page for the "OLX - Model Tags" script. Follow the format in `browser-tools/olx-model-tags/README.md` of github.com/karpuzikov/userscripts. Use only CSS selectors that exist in the attached HTML, one `pages` entry per kind of page, and one value per property. Property names: Year, Display, Battery, Charger, NFC, Memory, or a short new name. Reply with the JSON of the `sources` entry only, plus the site's host for the `@match` line.

3. Open an issue at <https://github.com/karpuzikov/userscripts/issues/new?title=Add+source:+> and paste the AI's reply. The owner checks the selectors against the page, adds the entry to `olx-model-tags-sources.json` and one `@match` line to the script header.

## Adapter format

```json
{ "name": "Site", "hosts": ["www.site.com"], "group": "Smartphones",
  "pages": [ {
    "path": "^/phones/[^/]+/?$",
    "model": { "selector": "h1" },
    "properties": [ { "name": "Year", "selector": ".released", "transform": "year" } ]
  } ] }
```

- `path`: regular expression tested on the URL path (optional).
- `rows` (optional): one entry per matching element, e.g. a ranking table. `model` and `properties` are then read inside each row.
- `model` / property reading, pick one: `selector` (CSS), `fromTitle` (regex on the tab title, first group), `afterLabel` (regex of a label text, reads the element after it; `labels` = CSS for the label elements), `column` (with page-level `columns`: `headers` CSS, `cells` CSS, `cellValue` CSS; `column` is a text found in the header's class).
- Optional: `attribute` (read this attribute instead of the text), `ignoreRegex` (skip the model when it matches).
- `transform`: `text` (default), `year`, `digits`, `displayType`, `batteryMah`, `yesNo`, `unknownIfEmpty`, `chargerPower`, `antutu` (gives its own property name, e.g. `AnTuTu v10`). Nothing else is accepted; no code comes from this file.

Values are saved as `Name: value` tags of the model named on the page, one value per name.
