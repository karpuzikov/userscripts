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
  olxModelTags.applyOlxModelTagsOperation(data, { type: 'setAdInfo', adId: '7', url: 'https://www.olx.ua/d/uk/obyavlenie/x-IDabc.html', title: 'Dell P2012Ht', detectedModel: 'P2012Ht' });
  assert.deepEqual(data.ads['7'], { model: '', tags: ['broken'], url: 'https://www.olx.ua/d/uk/obyavlenie/x-IDabc.html', title: 'Dell P2012Ht', detectedModel: 'P2012Ht' });
});
