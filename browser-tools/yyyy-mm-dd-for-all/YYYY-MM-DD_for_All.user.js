// ==UserScript==
// @name         YYYY-MM-DD for All
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
// @description  Converts dates to YYYY-MM-DD on supported websites. Built to make adding more websites easy.
// @match        https://www.cdjapan.co.jp/*
// @match        http://www.cdjapan.co.jp/*
// @match        https://www.iafd.com/title.rme/*
// @match        https://www.setlist.fm/*
// @match        https://www.blu-ray.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const MONTHS = Object.freeze({
        january: '01', jan: '01',
        february: '02', feb: '02',
        march: '03', mar: '03',
        april: '04', apr: '04',
        may: '05',
        june: '06', jun: '06',
        july: '07', jul: '07',
        august: '08', aug: '08',
        september: '09', sep: '09', sept: '09',
        october: '10', oct: '10',
        november: '11', nov: '11',
        december: '12', dec: '12'
    });

    function toISODate(text) {
        if (!text) return null;

        const match = text.trim().match(
            /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/
        );
        if (!match) return null;

        const month = MONTHS[match[1].toLowerCase()];
        if (!month) return null;

        const dayNumber = Number(match[2]);
        if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) {
            return null;
        }

        return `${match[3]}-${month}-${String(dayNumber).padStart(2, '0')}`;
    }

    function replaceMonthDateText(text) {
        if (!text) return text;

        return text.replace(
            /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\b/g,
            (full, monthName, day, year) => {
                const month = MONTHS[monthName.toLowerCase()];
                const dayNumber = Number(day);
                if (!month || dayNumber < 1 || dayNumber > 31) return full;
                return `${year}-${month}-${String(dayNumber).padStart(2, '0')}`;
            }
        );
    }

    function queryWithin(root, selector) {
        const elements = [];
        if (root instanceof Element && root.matches(selector)) elements.push(root);
        if (root.querySelectorAll) elements.push(...root.querySelectorAll(selector));
        return elements;
    }

    const adapters = [
        {
            name: 'CDJapan',
            matches: () => /(^|\.)cdjapan\.co\.jp$/i.test(location.hostname),
            run(root) {
                for (const element of queryWithin(root, 'span[itemprop="releaseDate"]')) {
                    const iso = toISODate(element.textContent);
                    if (iso) element.textContent = iso;
                }
            }
        },
        {
            name: 'IAFD',
            matches: () => /(^|\.)iafd\.com$/i.test(location.hostname) && /\/title\.rme\//i.test(location.pathname),
            run(root) {
                let releaseDate = null;

                for (const heading of queryWithin(root, 'p.bioheading')) {
                    const label = heading.textContent.trim();
                    if (label !== 'Release Date' && label !== 'Date Added to IAFD') continue;

                    const data = heading.nextElementSibling;
                    if (!data) continue;

                    const iso = toISODate(data.textContent);
                    if (!iso) continue;

                    data.textContent = iso;
                    if (label === 'Release Date') releaseDate = iso;
                }

                if (!releaseDate) {
                    for (const heading of document.querySelectorAll('p.bioheading')) {
                        if (heading.textContent.trim() !== 'Release Date') continue;
                        const data = heading.nextElementSibling;
                        if (!data) continue;
                        const text = data.textContent.trim();
                        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) releaseDate = text;
                    }
                }

                if (!releaseDate) return;

                const h1 = document.querySelector('h1');
                if (!h1) return;

                const current = h1.textContent.trim();
                const withoutExistingISO = current.replace(/^\d{4}-\d{2}-\d{2}\s+-\s+/, '');
                const titleText = withoutExistingISO.replace(/\(\d{4}\)/, '').trim();
                const newTitle = `${releaseDate} - ${titleText}`;

                if (h1.textContent.trim() !== newTitle) h1.textContent = newTitle;
                if (document.title !== newTitle) document.title = newTitle;
            }
        },
        {
            name: 'setlist.fm',
            matches: () => /(^|\.)setlist\.fm$/i.test(location.hostname),
            run(root) {
                for (const block of queryWithin(root, '.dateBlock')) {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(block.textContent.trim())) continue;

                    const monthName = block.querySelector('.month')?.textContent.trim();
                    const day = block.querySelector('.day')?.textContent.trim();
                    const year = block.querySelector('.year')?.textContent.trim();
                    const month = MONTHS[monthName?.toLowerCase()];

                    if (!month || !/^\d{1,2}$/.test(day || '') || !/^\d{4}$/.test(year || '')) continue;
                    block.textContent = `${year}-${month}-${day.padStart(2, '0')}`;
                }
            }
        },
        {
            name: 'Blu-ray.com',
            matches: () => /(^|\.)blu-ray\.com$/i.test(location.hostname),
            run(root) {
                const processTextNode = node => {
                    if (node.nodeType !== Node.TEXT_NODE) return;
                    if (node.parentElement?.closest('script, style, textarea, input, select, option')) return;

                    const replacement = replaceMonthDateText(node.nodeValue);
                    if (replacement !== node.nodeValue) node.nodeValue = replacement;
                };

                if (root.nodeType === Node.TEXT_NODE) {
                    processTextNode(root);
                    return;
                }

                const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                const nodes = [];
                let node;
                while ((node = walker.nextNode())) nodes.push(node);
                nodes.forEach(processTextNode);
            }
        }
    ];

    const activeAdapters = adapters.filter(adapter => adapter.matches());
    if (!activeAdapters.length) return;

    function run(root = document) {
        for (const adapter of activeAdapters) adapter.run(root);
    }

    run();

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
                    run(node);
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();