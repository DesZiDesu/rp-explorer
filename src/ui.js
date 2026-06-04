/**
 * RP Explorer - UI shell
 *
 * Builds the mobile-first floating button (draggable by touch & mouse) and
 * the slide-in panel with tabs. Delegates tab content to gallery.js / diary.js
 * and the Update action to memory.js.
 */

import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { TEMPLATE_PATH } from './constants.js';
import { getSettings, saveSettings } from './storage.js';
import { renderGallery } from './gallery.js';
import { renderDiary } from './diary.js';
import { runUpdate, getIsUpdating } from './memory.js';

let panelEl = null;
let buttonEl = null;
let activeTab = 'gallery';

/* ------------------------------------------------------------------ *
 *  BOOTSTRAP
 * ------------------------------------------------------------------ */

export async function buildUI() {
    await injectButton();
    await injectPanel();
    // Re-render the open tab whenever an update lands.
    document.addEventListener('rpExplorer:updated', () => {
        if (panelEl?.classList.contains('rpx-open')) renderActiveTab();
    });
}

/* ------------------------------------------------------------------ *
 *  FLOATING DRAGGABLE BUTTON
 * ------------------------------------------------------------------ */

async function injectButton() {
    if (document.getElementById('rpx-fab')) return;

    buttonEl = document.createElement('div');
    buttonEl.id = 'rpx-fab';
    buttonEl.className = 'rpx-fab';
    buttonEl.title = 'RP Explorer';
    buttonEl.innerHTML = `<i class="fa-solid fa-compass"></i>`;
    document.body.appendChild(buttonEl);

    restoreButtonPosition();
    makeDraggable(buttonEl, () => togglePanel());
}

/** Restore the saved button position (if any). */
function restoreButtonPosition() {
    const pos = getSettings().buttonPosition;
    if (pos && pos.x != null && pos.y != null) {
        buttonEl.style.left = `${pos.x}px`;
        buttonEl.style.top = `${pos.y}px`;
        buttonEl.style.right = 'auto';
        buttonEl.style.bottom = 'auto';
    }
}

/**
 * Make an element draggable with both pointer (mouse) and touch events.
 * Calls `onClick` if the gesture was a tap rather than a drag.
 */
function makeDraggable(el, onClick) {
    let startX = 0, startY = 0, originX = 0, originY = 0;
    let dragging = false, moved = false;

    const onDown = (clientX, clientY) => {
        dragging = true;
        moved = false;
        const rect = el.getBoundingClientRect();
        startX = clientX;
        startY = clientY;
        originX = rect.left;
        originY = rect.top;
        el.classList.add('rpx-dragging');
    };

    const onMove = (clientX, clientY) => {
        if (!dragging) return;
        const dx = clientX - startX;
        const dy = clientY - startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;

        // Clamp inside the viewport.
        const w = el.offsetWidth, h = el.offsetHeight;
        let nx = Math.min(Math.max(0, originX + dx), window.innerWidth - w);
        let ny = Math.min(Math.max(0, originY + dy), window.innerHeight - h);

        el.style.left = `${nx}px`;
        el.style.top = `${ny}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    };

    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('rpx-dragging');
        if (moved) {
            const rect = el.getBoundingClientRect();
            const settings = getSettings();
            settings.buttonPosition = { x: Math.round(rect.left), y: Math.round(rect.top) };
            saveSettings();
        } else {
            onClick?.();
        }
    };

    // Mouse
    el.addEventListener('mousedown', (e) => { e.preventDefault(); onDown(e.clientX, e.clientY); });
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onUp);

    // Touch
    el.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        onDown(t.clientX, t.clientY);
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
        const t = e.touches[0];
        onMove(t.clientX, t.clientY);
        if (dragging) e.preventDefault(); // stop page scroll while dragging
    }, { passive: false });
    el.addEventListener('touchend', onUp);
}

/* ------------------------------------------------------------------ *
 *  PANEL
 * ------------------------------------------------------------------ */

async function injectPanel() {
    if (document.getElementById('rpx-panel')) return;

    let html = '';
    try {
        html = await renderExtensionTemplateAsync(TEMPLATE_PATH, 'templates/panel');
    } catch (err) {
        console.warn('[RP Explorer] template load failed, using inline fallback', err);
        html = inlinePanelHtml();
    }

    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    panelEl = wrap.firstElementChild;
    document.body.appendChild(panelEl);

    wirePanel();
}

function wirePanel() {
    panelEl.querySelector('.rpx-close')?.addEventListener('click', () => togglePanel(false));

    panelEl.querySelectorAll('.rpx-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            activeTab = tab.dataset.tab;
            panelEl.querySelectorAll('.rpx-tab').forEach((t) => t.classList.toggle('rpx-active', t === tab));
            renderActiveTab();
        });
    });

    panelEl.querySelector('.rpx-update-now')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (getIsUpdating()) return;
        setUpdateButton(btn, true);
        await runUpdate({
            onState: () => {},
        });
        setUpdateButton(btn, false);
    });
}

function setUpdateButton(btn, busy) {
    btn.disabled = busy;
    btn.innerHTML = busy
        ? `<i class="fa-solid fa-spinner fa-spin"></i> Updating…`
        : `<i class="fa-solid fa-rotate"></i> Update`;
}

/** Show / hide / toggle the panel. */
export function togglePanel(force) {
    if (!panelEl) return;
    const open = force ?? !panelEl.classList.contains('rpx-open');
    panelEl.classList.toggle('rpx-open', open);
    getSettings().panelOpen = open;
    if (open) renderActiveTab();
}

function renderActiveTab() {
    const body = panelEl.querySelector('.rpx-tab-body');
    if (!body) return;
    panelEl.querySelectorAll('.rpx-tab').forEach((t) =>
        t.classList.toggle('rpx-active', t.dataset.tab === activeTab));
    if (activeTab === 'gallery') renderGallery(body);
    else if (activeTab === 'diary') renderDiary(body);
}

/** Inline fallback if the HTML template can't be fetched. */
function inlinePanelHtml() {
    return `
    <div id="rpx-panel" class="rpx-panel">
        <div class="rpx-panel-header">
            <span class="rpx-panel-title"><i class="fa-solid fa-compass"></i> RP Explorer</span>
            <div class="rpx-panel-header-actions">
                <button class="rpx-btn rpx-btn-primary rpx-update-now" type="button"><i class="fa-solid fa-rotate"></i> Update</button>
                <button class="rpx-icon-btn rpx-close" type="button"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>
        <div class="rpx-tabs">
            <button class="rpx-tab rpx-active" data-tab="gallery" type="button"><i class="fa-solid fa-users"></i> Gallery</button>
            <button class="rpx-tab" data-tab="diary" type="button"><i class="fa-solid fa-book"></i> Diary</button>
        </div>
        <div class="rpx-tab-body"></div>
    </div>`;
}
