const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

const scriptPath = `${__dirname}/Rozetka_Only_in_Stock.user.js`;

function makeElement() {
  const classes = new Set();
  const attrs = new Map();
  const listeners = new Map();
  return {
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle(name, force) {
        if (force === undefined ? !classes.has(name) : force) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute: (name, value) => attrs.set(name, String(value)),
    getAttribute: (name) => attrs.get(name),
    addEventListener: (name, fn) => listeners.set(name, fn),
    click: () => listeners.get('click')?.(),
    append(child) { this.children.push(child); },
    prepend(child) { this.children.unshift(child); },
    children: [],
    dataset: {},
    textContent: '',
  };
}

function makeTile({ unavailable = false, status = '' } = {}) {
  const tile = makeElement();
  const product = makeElement();
  if (unavailable) product.classList.add('tile-disabled');
  tile.querySelector = (selector) => {
    if (selector === 'rz-product-tile') return product;
    if (selector === 'rz-tile-sell-status') return status ? { textContent: status } : null;
    return null;
  };
  return tile;
}

function start({ remembered = false, tiles = [] } = {}) {
  const root = makeElement();
  const head = makeElement();
  const filters = makeElement();
  const raf = [];
  let observer;
  const saved = new Map(remembered ? [['rz-only-in-stock-enabled', '1']] : []);
  const document = {
    documentElement: root,
    head,
    createElement: () => makeElement(),
    querySelector: (selector) => selector === 'nav[data-testid="catalog_sidebar"] rz-filter-stack' ? filters : null,
    querySelectorAll: (selector) => selector === 'rz-catalog-tile-placeholder' ? tiles : [],
    getElementById: (id) => [...head.children, ...filters.children].find((e) => e.id === id) || null,
  };
  const context = {
    document,
    localStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    },
    MutationObserver: class {
      constructor(callback) { observer = callback; }
      observe() {}
    },
    requestAnimationFrame(callback) { raf.push(callback); },
  };

  const source = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
  vm.runInNewContext(source, context, { filename: scriptPath });
  return {
    root, head, filters, tiles, saved,
    button: () => filters.children.find((e) => e.id === 'rz-only-in-stock'),
    change: () => { observer?.([{ type: 'childList' }]); while (raf.length) raf.shift()(); },
  };
}

test('one click filters unavailable product tiles without hiding available ones', () => {
  const out = makeTile({ unavailable: true, status: 'Немає в наявності' });
  const available = makeTile();
  const app = start({ tiles: [out, available] });
  const button = app.button();
  assert.ok(button, 'filter button appears in the sidebar');
  assert.equal(button.textContent, 'Only in stock');
  button.click();
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(out.classList.contains('rz-stock-hidden'), true);
  assert.equal(available.classList.contains('rz-stock-hidden'), false);
  assert.equal(app.saved.get('rz-only-in-stock-enabled'), '1');
  button.click();
  assert.equal(out.classList.contains('rz-stock-hidden'), false);
});

test('saved choice applies to newly loaded cards and the button is restored after rerender', () => {
  const out = makeTile({ unavailable: true });
  const tiles = [out];
  const app = start({ remembered: true, tiles });
  assert.equal(out.classList.contains('rz-stock-hidden'), true);
  const added = makeTile({ unavailable: true });
  tiles.push(added);
  app.filters.children.length = 0;
  app.change();
  assert.ok(app.button(), 'button is restored after an Angular rerender');
  assert.equal(added.classList.contains('rz-stock-hidden'), true);
  assert.equal(app.button().getAttribute('aria-pressed'), 'true');
});

test('unavailable status text is recognized when tile-disabled is missing', () => {
  const out = makeTile({ status: 'Нет в наличии' });
  const available = makeTile({ status: 'Є в наявності' });
  const app = start({ remembered: true, tiles: [out, available] });
  assert.equal(out.classList.contains('rz-stock-hidden'), true);
  assert.equal(available.classList.contains('rz-stock-hidden'), false);
});
