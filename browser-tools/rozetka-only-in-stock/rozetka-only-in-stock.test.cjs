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
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
    closest: () => null,
    addEventListener: (name, fn) => listeners.set(name, fn),
    click: () => listeners.get('click')?.(),
    append(child) { child.parentElement = this; this.children.push(child); },
    prepend(child) { child.parentElement = this; this.children.unshift(child); },
    before(child) {
      const siblings = this.parentElement.children;
      child.parentElement = this.parentElement;
      siblings.splice(siblings.indexOf(this), 0, child);
    },
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

function start({ remembered = false, tiles = [], extraPages = [], filtersHydrated = true } = {}) {
  const root = makeElement();
  const head = makeElement();
  const filters = makeElement();
  if (!filtersHydrated) filters.setAttribute('ngh', '39');
  const documentListeners = [];
  const clock = { now: 1000 };
  const sidebarContents = makeElement();
  sidebarContents.append(filters);
  const paginator = makeElement();
  const showMore = makeElement();
  const raf = [];
  let observer;
  let moreClicks = 0;
  showMore.click = () => {
    moreClicks++;
    tiles.push(...extraPages.shift());
    observer?.([{ type: 'childList' }]);
  };
  paginator.querySelector = (selector) => selector === '[data-testid="show_more_btn"]' && extraPages.length ? showMore : null;
  const saved = new Map(remembered ? [['rz-only-in-stock-enabled', '1']] : []);
  const location = { href: 'https://hard.rozetka.com.ua/ua/videocards/c80087/' };
  const document = {
    documentElement: root,
    head,
    createElement: () => makeElement(),
    querySelector: (selector) => {
      if (selector === 'nav[data-testid="catalog_sidebar"] rz-filter-stack') return filters;
      if (selector === 'rz-paginator') return paginator;
      return null;
    },
    querySelectorAll: (selector) => selector === 'rz-catalog-tile-placeholder' ? tiles : [],
    getElementById: (id) => [...head.children, ...sidebarContents.children, ...filters.children].find((e) => e.id === id) || null,
    addEventListener: (type, fn) => documentListeners.push({ type, fn }),
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
    setTimeout() { return 1; },
    clearTimeout() {},
    Date: { now: () => clock.now },
    location,
  };

  const source = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
  vm.runInNewContext(source, context, { filename: scriptPath });
  return {
    root, head, filters, sidebarContents, paginator, tiles, saved, location, extraPages,
    moreClicks: () => moreClicks,
    button: () => sidebarContents.children.find((e) => e.id === 'rz-only-in-stock'),
    change: () => { observer?.([{ type: 'childList' }]); while (raf.length) raf.shift()(); },
    userClicksPage: () => documentListeners.filter((l) => l.type === 'pointerdown')
      .forEach((l) => l.fn({ isTrusted: true, target: makeElement() })),
    advanceTime: (ms) => { clock.now += ms; },
  };
}

test('one click filters unavailable product tiles without hiding available ones', () => {
  const out = makeTile({ unavailable: true, status: 'Немає в наявності' });
  const available = makeTile();
  const app = start({ tiles: [out, available] });
  const button = app.button();
  assert.ok(button, 'filter button appears in the sidebar');
  assert.equal(app.filters.children.includes(button), false, 'native Angular filters remain untouched');
  assert.equal(button.textContent, 'Only in stock');
  button.click();
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(out.classList.contains('rz-stock-hidden'), true);
  assert.equal(available.classList.contains('rz-stock-hidden'), false);
  assert.equal(app.saved.get('rz-only-in-stock-enabled'), '1');
  button.click();
  assert.equal(out.classList.contains('rz-stock-hidden'), false);
  assert.equal(button.textContent, 'Only in stock', 'off state restores the original label');
});

test('saved choice applies to newly loaded cards and the button is restored after rerender', () => {
  const out = makeTile({ unavailable: true });
  const tiles = [out];
  const app = start({ remembered: true, tiles });
  assert.equal(out.classList.contains('rz-stock-hidden'), true);
  const added = makeTile({ unavailable: true });
  tiles.push(added);
  app.sidebarContents.children.splice(app.sidebarContents.children.indexOf(app.button()), 1);
  app.change();
  assert.ok(app.button(), 'button is restored after an Angular rerender');
  assert.equal(added.classList.contains('rz-stock-hidden'), true);
  assert.equal(app.button().getAttribute('aria-pressed'), 'true');
});

test('loads all result pages before reporting a complete in-stock listing', () => {
  const tiles = [makeTile({ unavailable: true }), makeTile()];
  const app = start({
    tiles,
    extraPages: [
      [makeTile({ unavailable: true }), makeTile()],
      [makeTile({ unavailable: true })],
      [makeTile({ unavailable: true })],
    ],
  });
  app.button().click();
  app.change();
  assert.equal(app.moreClicks(), 3, 'all remaining native pages were requested');
  assert.equal(tiles.length, 6);
  assert.equal(tiles.filter((tile) => !tile.classList.contains('rz-stock-hidden')).length, 2);
  assert.equal(app.paginator.classList.contains('rz-stock-paginator-hidden'), true);
  app.button().click();
  assert.equal(app.paginator.classList.contains('rz-stock-paginator-hidden'), false);
});

test('unavailable status text is recognized when tile-disabled is missing', () => {
  const out = makeTile({ status: 'Нет в наличии' });
  const available = makeTile({ status: 'Є в наявності' });
  const app = start({ remembered: true, tiles: [out, available] });
  assert.equal(out.classList.contains('rz-stock-hidden'), true);
  assert.equal(available.classList.contains('rz-stock-hidden'), false);
});

test('changing a native filter while enabled restarts stock filtering for the new results', () => {
  const tiles = [makeTile(), makeTile({ unavailable: true })];
  const app = start({ tiles, extraPages: [[makeTile({ unavailable: true })]] });
  app.button().click();
  app.change();
  assert.equal(app.moreClicks(), 1);

  // Rozetka navigates and replaces the catalog after a normal filter change.
  app.location.href += 'brand=asus/';
  tiles.splice(0, tiles.length, makeTile({ unavailable: true }), makeTile());
  app.extraPages.push([makeTile()]);
  app.change();

  assert.equal(app.moreClicks(), 2);
  assert.equal(tiles.filter((tile) => !tile.classList.contains('rz-stock-hidden')).length, 2);
  assert.equal(app.button().getAttribute('aria-pressed'), 'true');
});

test('waits for Angular to hydrate the native filters before inserting the button', () => {
  const app = start({ filtersHydrated: false });
  assert.equal(app.button(), undefined, 'no foreign node inside server-rendered filters');
  app.filters.removeAttribute('ngh');
  app.change();
  assert.ok(app.button());
});

test('automatic show more never cancels a filter the user just clicked', () => {
  const app = start({ tiles: [makeTile()], extraPages: [[makeTile()], [makeTile()]] });
  app.userClicksPage(); // e.g. a brand checkbox: Rozetka's router is now navigating
  app.button().click();
  assert.equal(app.moreClicks(), 0, 'waits while the user navigation is pending');
  app.location.href += 'producer=asus/';
  app.change();
  assert.equal(app.moreClicks(), 0, 'waits for the new listing to render');
  app.advanceTime(1500);
  app.change();
  assert.equal(app.moreClicks(), 2, 'then loads the new listing');
});

test('a filter change after the tile limit loads the new listing instead of staying partial', () => {
  const tiles = Array.from({ length: 1200 }, () => makeTile());
  const app = start({ remembered: true, tiles, extraPages: [[makeTile()]] });
  assert.match(app.button().textContent, /partial/);
  app.location.href += 'producer=asus/'; // the old tiles are still on screen when the URL commits
  app.change();
  tiles.splice(0, tiles.length, makeTile());
  app.change();
  assert.equal(app.moreClicks(), 1);
});
