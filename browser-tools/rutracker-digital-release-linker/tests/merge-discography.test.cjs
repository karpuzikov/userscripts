const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'RuTracker_Digital_Release_Linker.user.js');
const script = fs.readFileSync(scriptPath, 'utf8');
const sandbox = {};
const instrumented = script.replace(
    /\n    init\(\);\s*\}\)\(\);\s*$/,
    '\n    globalThis.mergeDiscographyForTest = mergeDiscography;\n})();'
);
assert.notEqual(instrumented, script, 'Test must execute the actual merge function');
vm.runInNewContext(instrumented, sandbox);
const mergeDiscography = sandbox.mergeDiscographyForTest;

const header = (duration) => `[b]Общая продолжительность[/b]: ${duration}\n\n`;
const spoiler = (title, body) => `[spoiler="${title}"]\n${body}\n[/spoiler]`;

test('leading-zero barcode matches the old release and updates only its spoiler identifier', () => {
    const originalTitle = '2006-05-05 - Impossible - Single [602498597736]';
    const updatedTitle = '2006-05-05 - Impossible - Single [00602498597736]';
    const oldBody = '[img=right]https://example.com/old.png[/img]\n[b]Носитель|Источник[/b]: WEB|redacted.ch\n[b]01[/b] Impossible (03:23)';
    const original = header('18:37:46') + spoiler(originalTitle, oldBody);
    const incoming = header('20:49:49') + spoiler(updatedTitle, '[img=right]ссылка[/img]\n[b]01[/b] Modified (03:23)');

    const result = mergeDiscography(original, incoming, new Map());
    const expected = header('20:49:49') + spoiler(updatedTitle, oldBody);

    assert.equal(result.text, expected);
    assert.equal(result.added, 0);
    assert.equal(result.renamedTitles.length, 1);
    assert.equal(result.renamedTitles[0].to, updatedTitle);
    assert.equal(result.absent.length, 0);
    assert.equal((result.text.match(/\[spoiler=/g) || []).length, 1);
    assert.equal(mergeDiscography(result.text, incoming, new Map()).text, expected);
});

test('matching barcodes update only the identifier, preserving original date, title and order', () => {
    const original = header('01:00:00') +
        spoiler('2024-02-10 - Vultures 1 [801867240222]', 'Old tracklist') + '\n\n' +
        spoiler('2024-08-03 - Vultures 2 [748777756774]', 'Second old tracklist');
    const updated = header('01:00:00') +
        spoiler('2023-12-12 - Vultures 1 [000801867240222]', 'New tracklist') + '\n\n' +
        spoiler('2024-08-03 - Vultures 2 [748777756774]', 'Another tracklist');

    const result = mergeDiscography(original, updated, new Map());

    assert.match(result.text, /2024-02-10 - Vultures 1 \[000801867240222\]/);
    assert.match(result.text, /Old tracklist/);
    assert.doesNotMatch(result.text, /New tracklist/);
    assert.equal(result.added, 0);
    assert.equal(result.absent.length, 0);
});

test('leading zeros in nonnumeric catalog identifiers are not stripped', () => {
    const original = header('01:00:00') + spoiler('2006-05-05 - Album [0ABC123]', 'Original');
    const updated = header('01:00:00') + spoiler('2006-05-05 - Album [ABC123]', 'Incoming');

    const result = mergeDiscography(original, updated, new Map());

    assert.equal(result.added, 1);
    assert.equal((result.text.match(/\[spoiler=/g) || []).length, 2);
});

test('a genuinely different numeric barcode is still inserted as a new release', () => {
    const original = header('01:00:00') + spoiler('2006-05-05 - Impossible - Single [602498597736]', 'Original');
    const updated = header('01:03:23') +
        spoiler('2006-05-05 - Impossible - Single [00602498597737]', 'Different barcode');

    const result = mergeDiscography(original, updated, new Map());

    assert.equal(result.added, 1);
    assert.equal(result.renamedTitles.length, 0);
    assert.equal((result.text.match(/\[spoiler=/g) || []).length, 2);
});
