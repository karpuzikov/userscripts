const assert = require('node:assert/strict');
const { test } = require('node:test');
const olxModelTags = require('./OLX_Model_Tags.user.js');

test('model key ignores case, separators and Cyrillic look-alike letters', () => {
  assert.equal(olxModelTags.normalizeModelKey('P2012Ht'), 'P2012HT');
  assert.equal(olxModelTags.normalizeModelKey('Р 2012-НТ'), 'P2012HT');
});

test('title detection prefers the longest known model and skips short ones', () => {
  const data = olxModelTags.createEmptyOlxModelTagsData();
  for (const modelName of ['P2012H', 'P2012Ht', 'E19']) olxModelTags.applyOlxModelTagsOperation(data, { type: 'addTag', scope: 'model', modelName, tag: 'x' });
  assert.equal(olxModelTags.detectModelKeyInTitle(data, 'Продається монітор Dell P2012Ht'), 'P2012HT');
  assert.equal(olxModelTags.detectModelKeyInTitle(data, 'Dell E19 монітор'), '');
});

test('operations are idempotent and per-ad model overrides the title', () => {
  const data = olxModelTags.createEmptyOlxModelTagsData();
  const operations = [
    { type: 'addTag', scope: 'model', modelName: 'P2012Ht', tag: '20"' },
    { type: 'addTag', scope: 'model', modelName: 'P2012Ht', tag: 'VGA' },
    { type: 'setAdModel', adId: '1', modelName: 'P2012Ht' },
    { type: 'addTag', scope: 'ad', adId: '1', tag: 'broken' },
    { type: 'removeTag', scope: 'model', modelName: 'p2012ht', tag: 'VGA' },
  ];
  for (const operation of [...operations, ...operations]) olxModelTags.applyOlxModelTagsOperation(data, operation);
  const tagging = olxModelTags.resolveAdTagging(data, '1', 'Монітор без моделі');
  assert.deepEqual([tagging.modelName, tagging.modelTags, tagging.adTags], ['P2012Ht', ['20"'], ['broken']]);
  assert.equal(olxModelTags.doesAdMatchActiveFilters(['20"', 'broken'], [], false), false);
  assert.equal(olxModelTags.doesAdMatchActiveFilters(['20"', 'broken'], ['20"'], true), true);
  assert.equal(olxModelTags.doesAdMatchActiveFilters(['20"'], ['20"', 'VGA'], false), false);
});

test('GitHub base64 round-trips UTF-8', () => {
  const text = JSON.stringify({ tag: '250 cd/m² Монітор' });
  assert.equal(olxModelTags.decodeBase64AsUtf8Text(olxModelTags.encodeUtf8TextAsBase64(text)), text);
});

test('tag display modes: Hide meshes, Highlight outlines, Do nothing clears', () => {
  const data = olxModelTags.createEmptyOlxModelTagsData();
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'setTagDisplayMode', tag: 'VGA', displayMode: 'hide' });
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'setTagDisplayMode', tag: 'IPS', displayMode: 'highlight' });
  assert.deepEqual(olxModelTags.resolveAdDisplayEffects(data, ['VGA', 'IPS']), { isMeshed: true, isHighlighted: true });
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'setTagDisplayMode', tag: 'VGA', displayMode: 'nothing' });
  assert.deepEqual(olxModelTags.resolveAdDisplayEffects({ models: {}, ads: {} }, ['VGA']), { isMeshed: false, isHighlighted: false });
  assert.deepEqual(data.tagDisplayModes, { IPS: 'highlight' });
});

test('clearing a mistyped per-ad model drops the unused empty model', () => {
  const data = olxModelTags.createEmptyOlxModelTagsData();
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'setAdModel', adId: '1', modelName: 'VGA' });
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'addTag', scope: 'model', modelName: 'P2012Ht', tag: 'TN' });
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'setAdModel', adId: '2', modelName: 'P2012Ht' });
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'setAdModel', adId: '1', modelName: '' });
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'setAdModel', adId: '2', modelName: '' });
  assert.deepEqual(Object.keys(data.models), ['P2012HT']);
});

test('stop phrases: defaults until edited, case-insensitive match, add/remove', () => {
  const data = olxModelTags.createEmptyOlxModelTagsData();
  assert.equal(olxModelTags.findPhraseInText(data, 'stopPhrases', 'Монітор Dell НА ЗАПЧАСТИНИ'), 'на запчастини');
  for (const phrase of ['на запчастини', 'на запчасти']) olxModelTags.applyOlxModelTagsOperation(data, { type: 'removeStopPhrase', phrase });
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'addStopPhrase', phrase: '  Мертві Пікселі ' });
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'addStopPhrase', phrase: 'мертві пікселі' });
  assert.equal(olxModelTags.findPhraseInText(data, 'stopPhrases', 'Монітор Dell на запчастини'), '');
  assert.equal(olxModelTags.findPhraseInText(data, 'stopPhrases', 'є мертві пікселі'), 'мертві пікселі');
  assert.equal(olxModelTags.getPhraseList(data, 'stopPhrases').filter((phrase) => phrase === 'мертві пікселі').length, 1);
});

test('disliked brands: whole-word match, hide unless shown, old stop-phrase ops still apply', () => {
  const data = olxModelTags.createEmptyOlxModelTagsData();
  for (const phrase of ['LG', 'hp', 'Acer']) olxModelTags.applyOlxModelTagsOperation(data, { type: 'addPhrase', listName: 'dislikedBrands', phrase });
  assert.equal(olxModelTags.findPhraseInText(data, 'dislikedBrands', 'Монітори Acer, Samsung'), 'acer');
  assert.equal(olxModelTags.findPhraseInText(data, 'dislikedBrands', 'Монітор HP2035'), 'hp');
  assert.equal(olxModelTags.findPhraseInText(data, 'dislikedBrands', 'Процесор LGA1151 Dell'), '');
  assert.equal(olxModelTags.doesAdMatchActiveFilters(['disliked brand'], [], false), false);
  assert.equal(olxModelTags.doesAdMatchActiveFilters(['disliked brand'], [], false, true), true);
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'addStopPhrase', phrase: 'мертві пікселі' });
  assert.equal(olxModelTags.findPhraseInText(data, 'stopPhrases', 'Є мертві пікселі'), 'мертві пікселі');
  assert.throws(() => olxModelTags.applyOlxModelTagsOperation(data, { type: 'addPhrase', listName: 'nope', phrase: 'x' }));
});

test('setAdInfo stores URL, title and detected model without touching tags', () => {
  const data = olxModelTags.createEmptyOlxModelTagsData();
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'addTag', scope: 'ad', adId: '7', tag: 'broken' });
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'setAdInfo', adId: '7', url: 'https://www.olx.ua/d/uk/obyavlenie/x-IDabc.html', title: 'Dell P2012Ht', detectedModel: 'P2012Ht', category: 'Монітори' });
  assert.deepEqual(data.ads['7'], { model: '', tags: ['broken'], url: 'https://www.olx.ua/d/uk/obyavlenie/x-IDabc.html', title: 'Dell P2012Ht', detectedModel: 'P2012Ht', category: 'Монітори' });
});

test('groups: model group applies to its ads, ad group wins; tags split into property and value', () => {
  const data = olxModelTags.createEmptyOlxModelTagsData();
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'setGroup', scope: 'model', modelName: 'Samsung 204Ts', group: ' Monitors ' });
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'setAdModel', adId: '1', modelName: 'Samsung 204Ts' });
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'setGroup', scope: 'ad', adId: '2', group: 'square-ish objects' });
  assert.equal(olxModelTags.resolveAdTagging(data, '1', '').group, 'Monitors');
  assert.equal(olxModelTags.resolveAdTagging(data, '2', '').group, 'square-ish objects');
  assert.deepEqual(olxModelTags.splitTagIntoPropertyAndValue('Squishiness: very squishy'), { property: 'Squishiness', value: 'very squishy' });
  assert.deepEqual(olxModelTags.splitTagIntoPropertyAndValue('700:1'), { property: '', value: '700:1' });
});

test('catalog and personal data split and join without losing anything', () => {
  const data = olxModelTags.createEmptyOlxModelTagsData();
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'addTag', scope: 'model', modelName: 'P2012Ht', tag: 'Size: 20"' });
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'addTag', scope: 'ad', adId: '1', tag: 'broken' });
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'addPhrase', listName: 'dislikedBrands', phrase: 'Acme' });
  const { catalog, personal } = olxModelTags.splitDataIntoCatalogAndPersonal(data);
  assert.deepEqual(Object.keys(catalog).sort(), ['dislikedBrands', 'models']);
  assert.deepEqual(Object.keys(personal).sort(), ['ads', 'tagDisplayModes']);
  assert.deepEqual(olxModelTags.joinCatalogAndPersonal(catalog, personal), data);
  // A stranger has no personal file: the catalog alone still gives a usable data object.
  assert.deepEqual(olxModelTags.joinCatalogAndPersonal(catalog, {}).ads, {});
});

test('spec-site capture helpers turn page text into tag values', () => {
  assert.equal(olxModelTags.extractYearFromText('2023, June 20'), '2023');
  assert.equal(olxModelTags.extractYearFromText('Released June 2025'), '2025');
  assert.equal(olxModelTags.classifyDisplayType('IPS LCD, 90Hz'), 'IPS');
  assert.equal(olxModelTags.classifyDisplayType('Super AMOLED, 120Hz'), 'OLED');
  assert.equal(olxModelTags.classifyDisplayType('TFT LCD'), 'TFT');
  assert.equal(olxModelTags.extractBatteryCapacity('Li-Po 4500 mAh'), '4500mAh');
  assert.equal(olxModelTags.extractChargerPower(['35W wired, 55% in 30 min (Europe)', ' 22.5W wired (Global)']), '22.5W');
  assert.equal(olxModelTags.extractChargerPower(['67W wired']), '67W');
  assert.equal(olxModelTags.extractNfcSupport('Yes (market/region dependent)'), 'Yes');
  assert.equal(olxModelTags.extractNfcSupport('No'), 'No');
  assert.deepEqual(olxModelTags.parseAnTuTuAnswer('AnTuTu of Honor 90 Lite is 391.900 (v10).'), { property: 'AnTuTu v10', value: '391900' });
});

test('setModelProperty keeps one value per property and fills the group once', () => {
  const data = olxModelTags.createEmptyOlxModelTagsData();
  const setYear = (value) => olxModelTags.applyOlxModelTagsOperation(data, { type: 'setModelProperty', modelName: 'Honor 90 Lite', property: 'Year', value, groupIfEmpty: 'Smartphones' });
  setYear('2022'); setYear('2023'); setYear('2023');
  assert.deepEqual(data.models.HONOR90LITE.tags, ['Year: 2023']);
  assert.equal(data.models.HONOR90LITE.group, 'Smartphones');
  assert.equal(olxModelTags.isModelPropertyAlreadySet(data, 'Honor 90 Lite', 'Year', '2023'), true);
  assert.equal(olxModelTags.isModelPropertyAlreadySet(data, 'Honor 90 Lite', 'Year', '2022'), false);
});

test('source adapters: page chosen by host and path, shipped file only uses known transforms', () => {
  const { sources } = require('./olx-model-tags-sources.json');
  const find = (host, path) => olxModelTags.findSourcePage(sources, host, path);
  assert.equal(find('www.dxomark.com', '/smartphones/Huawei/Pura-80-Ultra').page.rows, undefined);
  assert.equal(find('www.dxomark.com', '/smartphones/').page.rows, '.device-row');
  assert.equal(find('www.kimovil.com', '/en/honor-90-lite/antutu').page.properties[0].transform, 'antutu');
  assert.equal(find('www.example.com', '/'), null);
  for (const source of sources) for (const page of source.pages) for (const property of page.properties) {
    assert.ok(olxModelTags.SOURCE_VALUE_TRANSFORMS[property.transform || 'text'], `unknown transform ${property.transform}`);
  }
});

test('maxWatts picks the highest output of a free-text output block', () => {
  const { maxWatts } = olxModelTags.SOURCE_VALUE_TRANSFORMS;
  assert.equal(maxWatts('USB 1 – 22.5W (for QC), USB 2 / 3 – 5V / 2.1A. Type-C – 20W (for PD). Total output – 5V / 3A.'), '22.5W');
  assert.equal(maxWatts('5V / 3A'), '15W');
  assert.equal(maxWatts('1 × Type-C plug – 5V / 2A.'), '10W');
  assert.equal(maxWatts('Car starter output – 12V, current – 400A. USB-A – 5V / 2.4A – 12W max.'), '12W');
});

test('setModelProperty derives "mAh per g" from Capacity and Weight', () => {
  const data = olxModelTags.createEmptyOlxModelTagsData();
  const set = (property, value) => olxModelTags.applyOlxModelTagsOperation(data, { type: 'setModelProperty', modelName: 'Hoco J94 Overlord', property, value });
  set('Capacity', '75000mAh');
  assert.equal(data.models.HOCOJ94OVERLORD.tags.some((tag) => tag.startsWith('mAh per g')), false);
  set('Weight', '1400g');
  set('Weight', '1400g');
  assert.deepEqual(data.models.HOCOJ94OVERLORD.tags.filter((tag) => tag.startsWith('mAh per g')), ['mAh per g: 53.6']);
});

test('updateDerivedTags adds "mAh per g" to a model saved before the tag existed', () => {
  const data = olxModelTags.createEmptyOlxModelTagsData();
  data.models.HOCOJ94OVERLORD = { name: 'Hoco J94 Overlord', tags: ['Capacity: 75000mAh', 'Weight: 1400g'], group: 'Power banks' };
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'updateDerivedTags', modelName: 'Hoco J94 Overlord' });
  assert.deepEqual(data.models.HOCOJ94OVERLORD.tags.slice(-1), ['mAh per g: 53.6']);
});

test('derived liter tag, dimensions transform, category lookup', () => {
  const { computeDerivedTags, SOURCE_VALUE_TRANSFORMS, findSourceCategory } = olxModelTags;
  assert.deepEqual(computeDerivedTags(['Capacity: 75000mAh', 'Weight: 1400g', 'Dimensions: 157×116×45mm']), ['mAh per g: 53.6', 'mAh per liter: 91515']);
  assert.equal(SOURCE_VALUE_TRANSFORMS.dimensionsMm('157 * 116*45mm'), '157×116×45mm');
  assert.equal(SOURCE_VALUE_TRANSFORMS.dimensionsMm('big'), '');
  const sources = [{ hosts: ['h.com'], category: { path: '^/category/', products: 'li' } }];
  const fakeDocument = { querySelector: () => ({}) };
  assert.ok(findSourceCategory(sources, 'h.com', '/category/x/', fakeDocument));
  assert.equal(findSourceCategory(sources, 'h.com', '/product/x/', fakeDocument), null);
});

test('unifyRawSpecs maps labels and splits a merged last line', () => {
  const { unified, labelCounts } = require('./unify-rawspecs.cjs').unifyRawSpecs({ 'https://x/1': { model: 'M', specs: { Sizes: '157*116*45mm. Weight: 1400g.', Output: '20W', Odd: 'v' } } });
  assert.deepEqual(unified['https://x/1'].specs, { Dimensions: '157*116*45mm.', Weight: '1400g.', Output: '20W', 'UNMAPPED: Odd': 'v' });
  assert.equal(labelCounts.odd.mapped, false);
});
