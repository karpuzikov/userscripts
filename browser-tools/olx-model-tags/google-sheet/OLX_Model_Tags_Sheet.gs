// OLX - Model Tags: read-only Google Sheet view of the tag data the userscript keeps on GitHub.
// Paste into the sheet's Extensions → Apps Script, save, reload the sheet, then use the "OLX Model Tags" menu.
// Lists every ad you tagged, set a model for, or marked broken (URL is saved from userscript 0.6.0 on).

const OLX_MODEL_TAGS_DATA_URL = 'https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/olx-model-tags/olx-model-tags-data.json';
const OLX_MODEL_TAGS_ADS_SHEET_NAME = 'OLX ads';
const OLX_MODEL_TAGS_MODELS_SHEET_NAME = 'OLX models';

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

function refreshOlxModelTagsSheet() {
  const response = UrlFetchApp.fetch(`${OLX_MODEL_TAGS_DATA_URL}?t=${Date.now()}`, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error(`GitHub data download failed (HTTP ${response.getResponseCode()})`);
  const data = JSON.parse(response.getContentText());

  const adRows = Object.entries(data.ads).map(([adId, ad]) => {
    const modelName = ad.model || ad.detectedModel || '';
    const modelTags = data.models[normalizeOlxModelKey(modelName)]?.tags || [];
    const adTags = ad.tags.filter((tag) => tag !== 'broken');
    return { adId, link: { text: ad.title || `Ad ${adId} (open it once to save its link)`, url: ad.url || '' }, modelName, modelTags: modelTags.join(', '), adTags: adTags.join(', '), isBroken: ad.tags.includes('broken') ? '⚠ broken' : '' };
  }).sort((first, second) => first.modelName.localeCompare(second.modelName) || first.link.text.localeCompare(second.link.text));

  writeOlxModelTagsTable(OLX_MODEL_TAGS_ADS_SHEET_NAME, ['Ad', 'Model', 'Model tags', 'Ad tags', 'Broken', 'Ad ID'],
    adRows.map((row) => [row.link, row.modelName, row.modelTags, row.adTags, row.isBroken, row.adId]));

  const adCountByModelKey = {};
  for (const row of adRows) if (row.modelName) adCountByModelKey[normalizeOlxModelKey(row.modelName)] = (adCountByModelKey[normalizeOlxModelKey(row.modelName)] || 0) + 1;
  writeOlxModelTagsTable(OLX_MODEL_TAGS_MODELS_SHEET_NAME, ['Model', 'Tags', 'Ads'],
    Object.entries(data.models).map(([modelKey, model]) => [model.name, model.tags.join(', '), adCountByModelKey[modelKey] || 0])
      .sort((first, second) => first[0].localeCompare(second[0])));
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
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, header.length);
}
