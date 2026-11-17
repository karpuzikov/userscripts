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
