// ==UserScript==
// @name         BPTopTracker -> MusicBrainz Importer
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.1.0
// @description  Seed BPTopTracker Beatport release data into the MusicBrainz release editor.
// @author       karpuzikov
// @license      MIT
// @match        https://www.bptoptracker.com/release/*
// @match        https://bptoptracker.com/release/*
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/bptoptracker-musicbrainz-importer/BPTopTracker_MusicBrainz_Importer.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/bptoptracker-musicbrainz-importer/BPTopTracker_MusicBrainz_Importer.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    const MUSICBRAINZ_ADD_RELEASE_URL = 'https://musicbrainz.org/release/add';
    const MUSICBRAINZ_SEARCH_URL = 'https://musicbrainz.org/search';
    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/bptoptracker-musicbrainz-importer/BPTopTracker_MusicBrainz_Importer.user.js';
    const PURCHASE_FOR_DOWNLOAD_LINK_TYPE = '74';

    const normalizeWhitespace = (value) =>
        String(value ?? '').replace(/\s+/g, ' ').trim();

    const absoluteUrl = (value) => {
        try {
            return new URL(value, location.href).href;
        } catch {
            return '';
        }
    };

    function unique(values) {
        return [...new Set(values.filter(Boolean))];
    }

    function defaultJoinPhrase(index, count) {
        if (index >= count - 1) return '';
        return index === count - 2 ? ' & ' : ', ';
    }

    function makeArtistCredit(names) {
        const cleaned = unique(names.map(normalizeWhitespace));
        return cleaned.map((name, index) => ({
            name,
            joinPhrase: defaultJoinPhrase(index, cleaned.length),
        }));
    }

    function artistNamesFrom(container) {
        if (!container) return [];
        return unique(
            [...container.querySelectorAll('a[href*="/artist/"]')]
                .map((link) => normalizeWhitespace(link.textContent))
                .filter(Boolean)
        );
    }

    function normalizeTrackTitle(rawTitle) {
        let title = normalizeWhitespace(rawTitle);

        // MusicBrainz title style keeps extra title information (ETI), while
        // descriptive words such as mix/remix/edit/version are lowercased.
        // Examples:
        //   Ghost Dance (Original Mix) -> Ghost Dance (original mix)
        //   Song (John Doe Remix)      -> Song (John Doe remix)
        title = title.replace(
            /\(([^()]*)\b(Mix|Remix|Edit|Version|Rework|Dub)\)$/i,
            (_, prefix, descriptor) =>
                `(${prefix}${descriptor.toLowerCase()})`
        );

        return normalizeWhitespace(title);
    }

    function findReleaseSection() {
        const beatportLink = document.querySelector(
            'a[href*="beatport.com/release/"]'
        );
        const heading = document.querySelector('h1');

        return (
            beatportLink?.closest('main, article, section, .container, [class*="container"]') ||
            heading?.closest('main, article, section, .container, [class*="container"]') ||
            document.querySelector('main') ||
            document.body ||
            document
        );
    }

    function findIconValue(section, iconClass) {
        const icon = section?.querySelector(`i.${iconClass}`);
        if (!icon) return '';

        const holder = icon.closest('div') || icon.parentElement;
        if (!holder) return '';

        const clone = holder.cloneNode(true);
        clone.querySelectorAll('i').forEach((node) => node.remove());
        return normalizeWhitespace(clone.textContent);
    }

    function parseReleaseDate(section) {
        const calendarIcon = section?.querySelector(
            'i.fa-calendar-check-o, i.fa-calendar'
        );
        const localText =
            calendarIcon?.parentElement?.textContent || section?.textContent || '';

        const match = localText.match(
            /\b(\d{4})-(\d{2})-(\d{2})\b/
        );

        if (!match) return null;

        return {
            year: match[1],
            month: match[2],
            day: match[3],
            text: `${match[1]}-${match[2]}-${match[3]}`,
        };
    }

    function parseTracksFromTable() {
        const table =
            document.querySelector('table.table-tracks') ||
            [...document.querySelectorAll('table')].find((candidate) => {
                const headers = [...candidate.querySelectorAll('th')].map((th) =>
                    normalizeWhitespace(th.textContent).toLowerCase()
                );
                return headers.includes('title') && headers.includes('length');
            });

        if (!table) return [];

        const headers = [...table.querySelectorAll('thead th, tr:first-child th')]
            .map((th) => normalizeWhitespace(th.textContent).toLowerCase());

        const indexOf = (name) => headers.indexOf(name.toLowerCase());

        const titleIndex = indexOf('title');
        const artistsIndex = indexOf('artists');
        const lengthIndex = indexOf('length');

        const rows = [...table.querySelectorAll('tbody tr')];
        const usableRows = rows.length
            ? rows
            : [...table.querySelectorAll('tr')].filter(
                  (row) => row.querySelectorAll('td').length > 0
              );

        return usableRows
            .map((row, rowIndex) => {
                const cells = [...row.querySelectorAll('td')];
                if (!cells.length) return null;

                const position =
                    normalizeWhitespace(
                        row.querySelector('td.position')?.textContent
                    ) || String(rowIndex + 1);

                const titleCell =
                    row.querySelector('td.title') ||
                    (titleIndex >= 0 ? cells[titleIndex] : null);

                const artistsCell =
                    row.querySelector('td.artists') ||
                    (artistsIndex >= 0 ? cells[artistsIndex] : null);

                const lengthCell =
                    lengthIndex >= 0 ? cells[lengthIndex] : null;

                const rawTitle = normalizeWhitespace(
                    titleCell?.querySelector('a')?.textContent ||
                        titleCell?.textContent
                );

                const artists = artistNamesFrom(artistsCell);
                const duration = normalizeWhitespace(lengthCell?.textContent);

                if (!rawTitle) return null;

                return {
                    number: position,
                    title: normalizeTrackTitle(rawTitle),
                    artists,
                    duration: /^\d{1,3}:\d{2}(?::\d{2})?$/.test(duration)
                        ? duration
                        : '',
                };
            })
            .filter(Boolean);
    }

    function parseTracksFromLinks() {
        const links = [...document.querySelectorAll('a[href*="/track/"]')];
        const seen = new Set();
        const tracks = [];

        for (const link of links) {
            const href = absoluteUrl(link.getAttribute('href'));
            if (!href || seen.has(href)) continue;
            seen.add(href);

            const row =
                link.closest(
                    'tr, li, [data-track-id], [data-track], .track, .track-row, .release-track, [class*="track-item"]'
                ) ||
                link.parentElement?.parentElement ||
                link.parentElement;

            if (!row) continue;

            const rawTitle = normalizeWhitespace(link.textContent);
            if (!rawTitle) continue;

            const artists = artistNamesFrom(row);
            const rowText = normalizeWhitespace(row.textContent);
            const duration =
                rowText.match(/\b\d{1,3}:\d{2}(?::\d{2})?\b/)?.[0] || '';

            const explicitNumber = normalizeWhitespace(
                row.querySelector(
                    '.position, .track-position, .track-number, .number, [data-position], [data-track-number]'
                )?.textContent
            );

            tracks.push({
                number:
                    explicitNumber.match(/\b\d+\b/)?.[0] ||
                    String(tracks.length + 1),
                title: normalizeTrackTitle(rawTitle),
                artists,
                duration,
            });
        }

        return tracks;
    }

    function parseTracks() {
        const tableTracks = parseTracksFromTable();
        return tableTracks.length ? tableTracks : parseTracksFromLinks();
    }

    function parsePage() {
        const section = findReleaseSection();

        const title = normalizeWhitespace(
            section.querySelector('h1')?.textContent ||
                document.querySelector('h1')?.textContent
        );

        const heading = section.querySelector('h1') || document.querySelector('h1');
        const artistContainers = [
            section.querySelector('h1 + .g-font-size-18'),
            section.querySelector('.g-font-size-18'),
            heading?.nextElementSibling,
            heading?.parentElement,
        ].filter(Boolean);

        let releaseArtists = [];
        for (const container of artistContainers) {
            const artists = artistNamesFrom(container);
            if (artists.length && artists.length <= 8) {
                releaseArtists = artists;
                break;
            }
        }

        if (!releaseArtists.length) {
            const firstArtist = [...section.querySelectorAll('a[href*="/artist/"]')].find(
                (link) =>
                    !link.closest(
                        'table, [data-track-id], [data-track], .track, .track-row, .release-track'
                    )
            );
            if (firstArtist) {
                releaseArtists = [normalizeWhitespace(firstArtist.textContent)];
            }
        }

        const labelLink = section.querySelector('a[href*="/label/"]');
        const label = normalizeWhitespace(labelLink?.textContent);

        const date = parseReleaseDate(section);

        const catalogNumber =
            findIconValue(section, 'fa-file-o') ||
            findIconValue(section, 'fa-file');

        const beatportLink = section.querySelector(
            'a[href*="beatport.com/release/"]'
        );
        const beatportUrl = absoluteUrl(beatportLink?.getAttribute('href'));

        const tracks = parseTracks();

        return {
            title,
            releaseArtists,
            label,
            date,
            catalogNumber,
            beatportUrl,
            sourceUrl: location.href.split('#')[0],
            tracks,
        };
    }

    function addArtistCredit(params, prefix, credit) {
        credit.forEach((entry, index) => {
            params.set(`${prefix}.names.${index}.name`, entry.name);
            params.set(`${prefix}.names.${index}.artist.name`, entry.name);

            if (entry.joinPhrase) {
                params.set(
                    `${prefix}.names.${index}.join_phrase`,
                    entry.joinPhrase
                );
            }
        });
    }

    function buildSeedParameters(release) {
        const params = new URLSearchParams();

        params.set('name', release.title);
        params.set('status', 'official');
        params.set('packaging', 'None');

        if (release.date) {
            params.set('events.0.date.year', release.date.year);
            params.set('events.0.date.month', release.date.month);
            params.set('events.0.date.day', release.date.day);

            // Deliberately do not seed events.0.country:
            // BPTopTracker does not establish a MusicBrainz release country.
        }

        if (release.label) {
            params.set('labels.0.name', release.label);

            if (release.catalogNumber) {
                params.set('labels.0.catalog_number', release.catalogNumber);
            }
        }

        if (release.releaseArtists.length) {
            addArtistCredit(
                params,
                'artist_credit',
                makeArtistCredit(release.releaseArtists)
            );
        }

        params.set('mediums.0.format', 'Digital Media');

        release.tracks.forEach((track, index) => {
            const prefix = `mediums.0.track.${index}`;

            params.set(`${prefix}.name`, track.title);
            params.set(`${prefix}.number`, track.number);

            if (track.duration) {
                params.set(`${prefix}.length`, track.duration);
            }

            if (track.artists.length) {
                addArtistCredit(
                    params,
                    `${prefix}.artist_credit`,
                    makeArtistCredit(track.artists)
                );
            }
        });

        if (release.beatportUrl) {
            params.set('urls.0.url', release.beatportUrl);
            params.set(
                'urls.0.link_type',
                PURCHASE_FOR_DOWNLOAD_LINK_TYPE
            );
        }

        const note = [
            `Imported from BPTopTracker: ${release.sourceUrl}`,
            release.beatportUrl
                ? `Original Beatport release: ${release.beatportUrl}`
                : '',
            `Script: ${SCRIPT_URL}`,
        ]
            .filter(Boolean)
            .join('\n');

        params.set('edit_note', note);

        // Deliberately not seeded unless BPTopTracker explicitly provides them:
        // - barcode / UPC
        // - release country
        // - language
        // - script
        // - release-group type
        //
        // ISRCs are recording-level identifiers and are not fields supported by
        // MusicBrainz Release Editor seeding.

        return params;
    }

    function submitToMusicBrainz(release) {
        if (!release.title) {
            alert('MusicBrainz import: release title was not found.');
            return;
        }

        if (!release.tracks.length) {
            alert('MusicBrainz import: no tracks were found.');
            return;
        }

        const params = buildSeedParameters(release);
        const form = document.createElement('form');

        form.method = 'POST';
        form.action = MUSICBRAINZ_ADD_RELEASE_URL;
        form.enctype = 'multipart/form-data';
        form.target = '_blank';
        form.style.display = 'none';

        for (const [name, value] of params.entries()) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.value = value;
            form.appendChild(input);
        }

        document.body.appendChild(form);
        form.submit();
        form.remove();
    }

    function searchMusicBrainz(release) {
        const terms = [
            release.title ? `"${release.title}"` : '',
            release.releaseArtists[0] || '',
            release.catalogNumber || '',
        ]
            .filter(Boolean)
            .join(' ');

        const url = new URL(MUSICBRAINZ_SEARCH_URL);
        url.searchParams.set('query', terms);
        url.searchParams.set('type', 'release');
        url.searchParams.set('method', 'indexed');

        window.open(url.href, '_blank', 'noopener');
    }

    function addImporterUI(release) {
        if (!document.querySelector('h1')) return;

        const existing = document.getElementById('bpt-mb-importer');
        if (existing) {
            const importButton = existing.querySelector('button');
            const status = existing.querySelector('span');
            const current = parsePage();
            const ready = Boolean(current.title && current.tracks.length);

            if (importButton) {
                importButton.disabled = !ready;
                importButton.title = ready
                    ? 'Open the MusicBrainz Add Release editor with BPTopTracker data pre-filled'
                    : 'Waiting for BPTopTracker release/track data';
            }

            if (status) {
                const text = current.tracks.length
                    ? `${current.tracks.length} track${current.tracks.length === 1 ? '' : 's'} ready`
                    : 'Waiting for track data...';
                if (status.textContent !== text) status.textContent = text;
            }
            return;
        }

        const beatportButton = document.querySelector(
            'a[href*="beatport.com/release/"]'
        );

        const section = findReleaseSection();
        const host =
            beatportButton?.parentElement ||
            section.querySelector('.col-lg-4') ||
            section.querySelector('h1')?.parentElement ||
            section;

        const wrapper = document.createElement('div');
        wrapper.id = 'bpt-mb-importer';
        wrapper.style.cssText =
            'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center;';

        const importButton = document.createElement('button');
        importButton.type = 'button';
        importButton.className = 'btn u-btn-primary g-ma-2';
        importButton.textContent = 'Import into MusicBrainz';
        importButton.title =
            'Open the MusicBrainz Add Release editor with BPTopTracker data pre-filled';

        const searchButton = document.createElement('button');
        searchButton.type = 'button';
        searchButton.className = 'btn u-btn-outline-primary g-ma-2';
        searchButton.textContent = 'Search MusicBrainz';
        searchButton.title =
            'Search MusicBrainz before adding the release';

        const status = document.createElement('span');
        status.style.cssText =
            'font-size:12px;opacity:.85;margin-left:2px;';
        status.textContent = release.tracks.length
            ? `${release.tracks.length} track${release.tracks.length === 1 ? '' : 's'} ready`
            : 'No tracks found';

        if (!release.title || !release.tracks.length) {
            importButton.disabled = true;
            importButton.title =
                'Cannot import because required release/track data was not found';
        }

        importButton.addEventListener('click', () =>
            submitToMusicBrainz(parsePage())
        );
        searchButton.addEventListener('click', () =>
            searchMusicBrainz(parsePage())
        );

        wrapper.append(importButton, searchButton, status);
        host.appendChild(wrapper);
    }

    let refreshTimer = null;

    function refreshImporter() {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            try {
                const release = parsePage();
                console.info('[BPTopTracker -> MusicBrainz]', release);
                addImporterUI(release);
            } catch (error) {
                console.error('[BPTopTracker -> MusicBrainz] Importer failed:', error);
            }
        }, 100);
    }

    function start() {
        refreshImporter();

        const observer = new MutationObserver(refreshImporter);
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });

        window.addEventListener('load', refreshImporter, { once: true });
        window.addEventListener('popstate', refreshImporter);

        setTimeout(refreshImporter, 1000);
        setTimeout(refreshImporter, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
