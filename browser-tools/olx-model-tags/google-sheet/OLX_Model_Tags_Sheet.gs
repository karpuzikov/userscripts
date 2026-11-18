// OLX - Model Tags: read-only Google Sheet view of the tag data the userscript keeps on GitHub.
// Paste into the sheet's Extensions → Apps Script, save, reload the sheet, then use the "OLX Model Tags" menu.
// One tab per OLX category (Монітори, Цифрові фотоапарати, ...), one row per ad you tagged, set a model for or marked broken,
// one column per kind of tag.

const OLX_MODEL_TAGS_DATA_URL = 'https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/olx-model-tags/olx-model-tags-data.json';
const OLX_MODEL_TAGS_TAB_PREFIX = 'OLX: ';
const OLX_MODEL_TAGS_NO_CATEGORY_TAB_NAME = 'no category yet';
const OLX_MODEL_TAGS_OLD_TAB_NAMES = ['OLX ads', 'OLX models']; // tabs made by the first version; removed on refresh

// Which column a tag goes to. A tag typed as "Name: value" (e.g. "Lens: 28-80mm") goes to column "Name" instead.
// First matching rule wins; anything else goes to "Other". Add rules here for new kinds of goods.
const OLX_MODEL_TAGS_COLUMN_RULES = [
  ['Size', /^\d+([.,]\d+)?\s*("|''|”|″|дюйм)/i],
  ['Resolution', /^\d{3,5}\s*[x×х]\s*\d{3,5}$/i],
  ['Panel', /^(TN|IPS|S-IPS|AH-IPS|E-IPS|VA|PVA|MVA|PLS|OLED)$/i],
  ['Brightness', /cd\/m|кд\/м|nits?$/i],
  ['Contrast', /^\d+([.,]\d+)?\s*:\s*1$/],
  ['Ports', /^(VGA|D-?SUB|DVI(-[DIA])?|HDMI|DP|mini ?DP|DisplayPort|USB(-?C)?|Thunderbolt|S-Video|Composite)$/i],
  ['Megapixels', /^\d+([.,]\d+)?\s*(MP|Мп|MPix)$/i],
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('OLX Model Tags')
    .addItem('Refresh now', 'refreshOlxModelTagsSheet')
    .addItem('Refresh every hour', 'installHourlyOlxModelTagsRefresh')
    .addToUi();
}

function installHourlyOlxModelTagsRefresh() {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'refreshOlxModelTagsSheet') ScriptApp.deleteTrigger(trigger);
  }
  ScriptApp.newTrigger('refreshOlxModelTagsSheet').timeBased().everyHours(1).create();
  refreshOlxModelTagsSheet();
}

// Same normalization as the userscript (Cyrillic look-alikes → Latin, only [0-9A-Z]); keep both in sync.
function normalizeOlxModelKey(text) {
  const cyrillicLookalikeToLatin = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y', І: 'I' };
  return String(text).toUpperCase().replace(/[АВЕКМНОРСТХУІ]/g, (letter) => cyrillicLookalikeToLatin[letter]).replace(/[^0-9A-Z]/g, '');
}

// OLX ad URLs end in "-ID<ad id in base 62>.html" and redirect to the full URL, so every ad gets a link,
// even ads tagged before the userscript started saving URLs.
function buildOlxAdUrlFromId(adId) {
  const base62Digits = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let remainingId = Number(adId);
  let encodedId = '';
  while (remainingId > 0) {
    encodedId = base62Digits[remainingId % 62] + encodedId;
    remainingId = Math.floor(remainingId / 62);
  }
  return `https://www.olx.ua/d/uk/obyavlenie/-ID${encodedId}.html`;
}

function findOlxTagColumn(tag) {
  const namedTag = tag.match(/^([^\d:][^:]{0,30}):\s+(.+)$/);
  if (namedTag) return { columnName: namedTag[1].trim(), value: namedTag[2].trim() };
  const matchingRule = OLX_MODEL_TAGS_COLUMN_RULES.find(([, pattern]) => pattern.test(tag.trim()));
  return { columnName: matchingRule ? matchingRule[0] : 'Other', value: tag.trim() };
}

function refreshOlxModelTagsSheet() {
  const response = UrlFetchApp.fetch(`${OLX_MODEL_TAGS_DATA_URL}?t=${Date.now()}`, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error(`GitHub data download failed (HTTP ${response.getResponseCode()})`);
  const data = JSON.parse(response.getContentText());

  const adsByCategory = {};
  for (const [adId, ad] of Object.entries(data.ads)) {
    const modelName = ad.model || ad.detectedModel || '';
    const allTags = [...(data.models[normalizeOlxModelKey(modelName)]?.tags || []), ...ad.tags.filter((tag) => tag !== 'broken')];
    const valuesByColumn = {};
    for (const tag of allTags) {
      const { columnName, value } = findOlxTagColumn(tag);
      (valuesByColumn[columnName] ||= []).push(value);
    }
    const category = ad.category || OLX_MODEL_TAGS_NO_CATEGORY_TAB_NAME;
    (adsByCategory[category] ||= []).push({
      adId, modelName, valuesByColumn,
      link: { text: ad.title || `Ad ${adId}`, url: ad.url || buildOlxAdUrlFromId(adId) },
      isBroken: ad.tags.includes('broken') ? '⚠ broken' : '',
    });
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const wantedTabNames = Object.keys(adsByCategory).map((category) => OLX_MODEL_TAGS_TAB_PREFIX + category);
  for (const sheet of spreadsheet.getSheets()) {
    const sheetName = sheet.getName();
    const isOwnStaleTab = (sheetName.startsWith(OLX_MODEL_TAGS_TAB_PREFIX) && !wantedTabNames.includes(sheetName)) || OLX_MODEL_TAGS_OLD_TAB_NAMES.includes(sheetName);
    if (isOwnStaleTab && spreadsheet.getSheets().length > 1) spreadsheet.deleteSheet(sheet);
  }

  for (const [category, ads] of Object.entries(adsByCategory)) {
    const ruleColumnNames = [...OLX_MODEL_TAGS_COLUMN_RULES.map(([columnName]) => columnName), 'Other'];
    const usedColumnNames = new Set(ads.flatMap((ad) => Object.keys(ad.valuesByColumn)));
    const tagColumnNames = [...ruleColumnNames.filter((columnName) => usedColumnNames.has(columnName)),
      ...[...usedColumnNames].filter((columnName) => !ruleColumnNames.includes(columnName)).sort()];
    ads.sort((first, second) => first.modelName.localeCompare(second.modelName) || first.link.text.localeCompare(second.link.text));
    writeOlxModelTagsTable(OLX_MODEL_TAGS_TAB_PREFIX + category, ['Ad', 'Model', ...tagColumnNames, 'Broken', 'Ad ID'],
      ads.map((ad) => [ad.link, ad.modelName, ...tagColumnNames.map((columnName) => (ad.valuesByColumn[columnName] || []).join(', ')), ad.isBroken, ad.adId]));
  }
}

// Cells given as { text, url } become links (rich text, so titles with quotes can't break a formula).
function writeOlxModelTagsTable(sheetName, header, rows) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  sheet.clear();
  const table = [header, ...rows];
  const range = sheet.getRange(1, 1, table.length, header.length);
  range.setRichTextValues(table.map((row) => row.map((cell) => {
    const builder = SpreadsheetApp.newRichTextValue().setText(typeof cell === 'object' ? cell.text : String(cell));
    return (typeof cell === 'object' && cell.url ? builder.setLinkUrl(cell.url) : builder).build();
  })));
  range.setFontFamily('Atkinson Hyperlegible').setFontColor('#EAECEF').setBackground('#0B0E11').setVerticalAlignment('top');
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold').setFontColor('#C6F432').setBackground('#1E2329');
  if (rows.length) sheet.getRange(2, 1, rows.length, 1).setFontColor('#3B82F6').setFontLine('underline'); // links stay visible on the dark fill
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, header.length);
}
