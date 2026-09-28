// ==UserScript==
// @name         MusicBrainz - Remove All External Links
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.2
// @description  Remove all external links from a MusicBrainz entity in one click.
// @author       karpuzikov
// @license      MIT
// @match        https://musicbrainz.org/*/*/edit
// @match        https://beta.musicbrainz.org/*/*/edit
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/remove-all-external-links/MusicBrainz_Remove_All_External_Links.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/remove-all-external-links/MusicBrainz_Remove_All_External_Links.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const EDITOR_ID = 'external-links-editor';
    const BUTTON_ID = 'mb-remove-all-external-links';
    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/remove-all-external-links/MusicBrainz_Remove_All_External_Links.user.js';

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function fire(element, type) {
        element.dispatchEvent(new Event(type, { bubbles: true }));
    }

    function appendScriptLinkToEditNote() {
        const textarea = document.querySelector('#edit-note-text, textarea.edit-note');
        if (!textarea || textarea.value.includes(SCRIPT_URL)) return;

        const currentNote = textarea.value.trimEnd();
        const newNote = currentNote
            ? `${currentNote}\n\nScript: ${SCRIPT_URL}`
            : `Script: ${SCRIPT_URL}`;

        const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value'
        )?.set;

        if (setter) {
            setter.call(textarea, newNote);
        } else {
            textarea.value = newNote;
        }

        fire(textarea, 'input');
        fire(textarea, 'change');
    }

    function getEditor() {
        return document.getElementById(EDITOR_ID);
    }

    function getActiveRemoveButtons() {
        const editor = getEditor();
        if (!editor) return [];

        return [...editor.querySelectorAll('tr.external-link-item')].flatMap(row => {
            const submittedUrl = row.querySelector('a.url');
            const removeButton = row.querySelector('button.remove-item');

            if (!submittedUrl || !removeButton || removeButton.disabled) return [];
            if (submittedUrl.classList.contains('rel-remove')) return [];

            return [removeButton];
        });
    }

    async function removeAllExternalLinks(button) {
        const oldText = button.textContent;
        const removeButtons = getActiveRemoveButtons();

        button.disabled = true;

        try {
            if (!removeButtons.length) {
                button.textContent = 'No external links';
                await wait(1000);
                return;
            }

            button.textContent = `Removing ${removeButtons.length}...`;

            for (let i = 0; i < removeButtons.length; i++) {
                const removeButton = removeButtons[i];
                if (removeButton.isConnected && !removeButton.disabled) {
                    removeButton.click();
                    await wait(35);
                }
            }

            appendScriptLinkToEditNote();

            button.textContent =
                `Removed ${removeButtons.length} external link${removeButtons.length === 1 ? '' : 's'}`;
            await wait(1000);
        } catch (error) {
            console.error('[MusicBrainz - Remove All External Links]', error);
            alert(error.message || String(error));
        } finally {
            button.disabled = false;
            button.textContent = oldText;
        }
    }

    function addButton() {
        if (document.getElementById(BUTTON_ID)) return;

        const editor = getEditor();
        if (!editor) return;

        const container = editor.closest('.external-links-editor-container') || editor;
        const toolbar = document.createElement('div');
        toolbar.style.margin = '0 0 0.75em';

        const button = document.createElement('button');
        button.type = 'button';
        button.id = BUTTON_ID;
        button.textContent = 'Remove all external links';
        button.addEventListener('click', () => removeAllExternalLinks(button));

        toolbar.appendChild(button);
        container.insertAdjacentElement('beforebegin', toolbar);
    }

    addButton();
    new MutationObserver(addButton).observe(document.body, {
        childList: true,
        subtree: true
    });
})();
