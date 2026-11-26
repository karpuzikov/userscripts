// Unifies the raw page specs saved by the category scan (olx-model-tags-rawspecs.json) into one set of names per product.
// Usage: node unify-rawspecs.cjs   -> writes olx-model-tags-rawspecs-unified.json and prints every label with its count,
// so labels that are still unmapped (UNMAPPED) can be added to LABEL_ALIASES below.
const fs = require('node:fs');
const path = require('node:path');

// lower-case raw label -> unified name
const LABEL_ALIASES = {
  capacity: 'Capacity', 'battery capacity': 'Capacity',
  input: 'Input', output: 'Output',
  sizes: 'Dimensions', size: 'Dimensions', dimensions: 'Dimensions',
  weight: 'Weight', 'net weight': 'Weight',
  material: 'Material', display: 'Indication', indication: 'Indication',
  'fast charge': 'Fast charge', 'fast charging': 'Fast charge',
};

function splitMergedValue(value) {
  // free-text pages put the last items on one line: "157*116*45mm. Weight: 1400g." -> extra spec Weight
  const extras = {};
  const mainValue = value.replace(/\.\s+([A-Z][A-Za-z ]*?):\s*([^]*)$/, (_, label, rest) => { extras[label] = rest.trim(); return '.'; });
  return { mainValue, extras };
}

function unifyRawSpecs(rawSpecs) {
  const labelCounts = {};
  const unified = {};
  for (const [url, { model, specs }] of Object.entries(rawSpecs)) {
    const result = {};
    const add = (label, value) => {
      const key = label.trim().replace(/:$/, '').toLowerCase();
      const name = LABEL_ALIASES[key];
      labelCounts[key] = labelCounts[key] || { count: 0, mapped: Boolean(name) };
      labelCounts[key].count++;
      result[name || `UNMAPPED: ${label.trim()}`] = value.trim();
    };
    for (const [label, value] of Object.entries(specs)) {
      const { mainValue, extras } = splitMergedValue(value);
      add(label, mainValue);
      for (const [extraLabel, extraValue] of Object.entries(extras)) add(extraLabel, extraValue);
    }
    unified[url] = { model, specs: result };
  }
  return { unified, labelCounts };
}

if (require.main === module) {
  const folder = __dirname;
  const rawSpecs = JSON.parse(fs.readFileSync(path.join(folder, 'olx-model-tags-rawspecs.json'), 'utf8'));
  const { unified, labelCounts } = unifyRawSpecs(rawSpecs);
  fs.writeFileSync(path.join(folder, 'olx-model-tags-rawspecs-unified.json'), `${JSON.stringify(unified, null, 1)}\n`);
  for (const [label, { count, mapped }] of Object.entries(labelCounts).sort((a, b) => b[1].count - a[1].count)) console.log(`${String(count).padStart(5)}  ${mapped ? 'ok      ' : 'UNMAPPED'}  ${label}`);
}
module.exports = { unifyRawSpecs };
