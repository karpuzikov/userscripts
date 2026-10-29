const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const scriptPath = path.join(__dirname, 'YYYY-MM-DD_for_All.user.js');

async function withYouTubePage(markup, callback) {
    const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, {
        url: 'https://www.youtube.com/watch?v=cTeYUVLlI5M&t=3s',
        runScripts: 'outside-only'
    });
    try {
        dom.window.eval(fs.readFileSync(scriptPath, 'utf8'));
        await callback(dom.window.document);
    } finally {
        dom.window.close();
    }
}

test('formats the video publish date in the watch metadata and expanded description', async () => {
    await withYouTubePage(`
        <ytd-watch-metadata>
            <div id="info"><span>436K views</span><span id="published">Jun 7, 2025</span></div>
            <ytd-video-description-header-renderer>
                <span id="expanded-date">Jun 7, 2025</span>
            </ytd-video-description-header-renderer>
        </ytd-watch-metadata>
        <ytd-comments><span id="comment">Jun 7, 2025</span></ytd-comments>
    `, async document => {
        assert.equal(document.querySelector('#published').textContent, '2025-06-07');
        assert.equal(document.querySelector('#expanded-date').textContent, '2025-06-07');
        assert.equal(document.querySelector('#comment').textContent, 'Jun 7, 2025');
    });
});

test('formats dates inserted during YouTube single-page navigation', async () => {
    await withYouTubePage('<ytd-watch-metadata id="watch"></ytd-watch-metadata>', async document => {
        document.querySelector('#watch').innerHTML = '<div id="info"><span id="later">Jun 7, 2025</span></div>';
        await Promise.resolve();
        assert.equal(document.querySelector('#later').textContent, '2025-06-07');
    });
});

test('formats text-node changes without touching unrelated YouTube text', async () => {
    await withYouTubePage(`
        <ytd-watch-metadata><div id="info"><span id="changed">2025-06-07</span></div></ytd-watch-metadata>
        <span id="unrelated">Jun 7, 2025</span>
    `, async document => {
        document.querySelector('#changed').firstChild.nodeValue = 'Jun 7, 2025';
        await Promise.resolve();
        assert.equal(document.querySelector('#changed').textContent, '2025-06-07');
        assert.equal(document.querySelector('#unrelated').textContent, 'Jun 7, 2025');
    });
});

test('preserves dates in creator-authored video descriptions', async () => {
    await withYouTubePage(`
        <ytd-watch-metadata>
            <div id="info"><span id="publish-date">Jun 7, 2025</span></div>
            <div id="description"><p id="creator-text">My next live show: Jun 8, 2025</p></div>
        </ytd-watch-metadata>
    `, async document => {
        assert.equal(document.querySelector('#publish-date').textContent, '2025-06-07');
        assert.equal(document.querySelector('#creator-text').textContent, 'My next live show: Jun 8, 2025');
    });
});

test('preserves date-like video titles in legacy YouTube metadata', async () => {
    await withYouTubePage(`
        <ytd-video-primary-info-renderer>
            <h1 id="video-title">Concert on Jun 8, 2025</h1>
            <div id="date"><span id="legacy-date">Jun 7, 2025</span></div>
        </ytd-video-primary-info-renderer>
    `, async document => {
        assert.equal(document.querySelector('#legacy-date').textContent, '2025-06-07');
        assert.equal(document.querySelector('#video-title').textContent, 'Concert on Jun 8, 2025');
    });
});
