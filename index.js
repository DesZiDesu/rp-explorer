/**
 * RP Explorer — a dynamic roleplay memory extension for SillyTavern.
 *
 * Entry point: wires settings, UI, SillyTavern events, and the memory engine.
 *
 *   • Mobile-first draggable UI            -> src/ui.js
 *   • Single-API-call memory updates       -> src/memory.js + src/api.js
 *   • Native toast on success              -> src/memory.js (TOAST_UPDATED)
 *   • Per-chat isolation / global base data -> src/storage.js
 *   • Gallery + Relationships (Tab 1)      -> src/gallery.js
 *   • User-only Diary (Tab 2)              -> src/diary.js
 */

import { getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

import { TEMPLATE_PATH } from './src/constants.js';
import { initSettings, getSettings, saveSettings, getChatData } from './src/storage.js';
import { buildUI, togglePanel } from './src/ui.js';
import { runUpdate, maybeAutoUpdate, injectMemory } from './src/memory.js';

/* ------------------------------------------------------------------ *
 *  SETTINGS PANEL (native SillyTavern extension drawer)
 * ------------------------------------------------------------------ */

async function injectSettings() {
    let html = '';
    try {
        html = await renderExtensionTemplateAsync(TEMPLATE_PATH, 'templates/settings');
    } catch (err) {
        console.warn('[RP Explorer] settings template load failed', err);
        return;
    }
    const container = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    if (!container) return;
    container.insertAdjacentHTML('beforeend', html);
    wireSettings();
}

function wireSettings() {
    const s = getSettings();

    const bind = (id, key, { checkbox = false, number = false } = {}) => {
        const el = document.getElementById(id);
        if (!el) return;
        // Initialise from stored value.
        if (checkbox) el.checked = !!s[key];
        else el.value = s[key] ?? '';
        // Persist on change.
        el.addEventListener('change', () => {
            if (checkbox) s[key] = el.checked;
            else if (number) s[key] = Number(el.value);
            else s[key] = el.value;
            saveSettings();
            // Re-inject memory if the toggle affects it.
            if (key === 'injectMemory') injectMemory();
        });
    };

    bind('rpx-use-custom-api', 'useCustomApi', { checkbox: true });
    bind('rpx-custom-url', 'customApiUrl');
    bind('rpx-custom-key', 'customApiKey');
    bind('rpx-custom-model', 'customModel');
    bind('rpx-custom-maxtokens', 'customMaxTokens', { number: true });
    bind('rpx-custom-temp', 'customTemperature', { number: true });
    bind('rpx-inherit-jb', 'inheritJailbreak', { checkbox: true });
    bind('rpx-auto-enabled', 'autoUpdateEnabled', { checkbox: true });
    bind('rpx-auto-interval', 'autoUpdateInterval', { number: true });
    bind('rpx-inject-memory', 'injectMemory', { checkbox: true });

    document.getElementById('rpx-open-panel')?.addEventListener('click', () => togglePanel(true));
    document.getElementById('rpx-update-now-settings')?.addEventListener('click', () => runUpdate());
}

/* ------------------------------------------------------------------ *
 *  WAND / QUICK-ACTION MENU BUTTON
 * ------------------------------------------------------------------ */

function injectWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('rpx-wand-button')) return;

    const item = document.createElement('div');
    item.id = 'rpx-wand-button';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = `<i class="fa-solid fa-compass"></i><span>RP Explorer</span>`;
    item.addEventListener('click', () => togglePanel(true));
    menu.appendChild(item);
}

/* ------------------------------------------------------------------ *
 *  SILLYTAVERN EVENT WIRING
 * ------------------------------------------------------------------ */

function wireEvents() {
    // New chat (or chat switch / delete) -> reset per-chat view & memory.
    eventSource.on(event_types.CHAT_CHANGED, () => {
        // Touch chat data so defaults are created for the new chat.
        getChatData();
        injectMemory();
        document.dispatchEvent(new CustomEvent('rpExplorer:updated'));
    });

    // After each AI message, consider an auto-update.
    const onNewMessage = () => maybeAutoUpdate();
    eventSource.on(event_types.MESSAGE_RECEIVED, onNewMessage);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
        // Keep the injected memory fresh as the chat grows.
        injectMemory();
    });
}

/* ------------------------------------------------------------------ *
 *  INIT
 * ------------------------------------------------------------------ */

(async function init() {
    try {
        initSettings();
        await buildUI();
        await injectSettings();
        injectWandButton();
        wireEvents();

        // Seed memory injection for the currently loaded chat.
        injectMemory();

        console.log('[RP Explorer] loaded.');
    } catch (err) {
        console.error('[RP Explorer] failed to initialise:', err);
    }
})();
