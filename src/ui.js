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
import { logger, runDiagnostics, renderLogsInto } from './logger.js';

let panelEl = null;
let buttonEl = null;
let activeTab = 'gallery';

/* ------------------------------------------------------------------ *
 *  BOOTSTRAP
 * ------------------------------------------------------------------ */

let resizeBound = false;

export async function buildUI() {
    ensureButton();
    installResizeClamp();
    await injectPanel();
    // Re-render the open tab whenever an update lands.
    document.addEventListener('rpExplorer:updated', () => {
        if (panelEl?.classList.contains('rpx-open')) renderActiveTab();
    });
    // Some mobile/theme layouts re-render the body after extensions load,
    // which can drop our button. Re-assert it a few times after startup.
    [400, 1500, 4000].forEach((ms) => setTimeout(ensureButton, ms));
}

/* ------------------------------------------------------------------ *
 *  FLOATING DRAGGABLE BUTTON
 * ------------------------------------------------------------------ */

/**
 * Create the floating button if it is missing. Critical layout styles are
 * applied INLINE (not just via the stylesheet) so the button is guaranteed
 * visible and on top even if the CSS file is overridden by a theme or fails
 * to load. Safe to call repeatedly.
 */
export function ensureButton() {
    if (!document.body) return;
    const existing = document.getElementById('rpx-fab');
    if (existing) {
        // Re-append if it somehow got detached, but keep its position.
        if (!existing.isConnected) document.body.appendChild(existing);
        return;
    }

    buttonEl = document.createElement('div');
    buttonEl.id = 'rpx-fab';
    buttonEl.className = 'rpx-fab';
    buttonEl.title = 'RP Explorer';
    buttonEl.innerHTML = `<i class="fa-solid fa-compass"></i>`;

    // Inline critical styles forced with !important so neither a theme nor a
    // missing stylesheet can hide the button. A solid colour + light ring make
    // it visible even if the icon font fails to load.
    // Visibility-critical props are forced with !important so neither a theme
    // nor a missing stylesheet can hide the button. Position offsets are left
    // as normal inline styles so the drag handler can reposition freely.
    const forced = {
        position: 'fixed',
        'z-index': '2147483647',
        width: '54px',
        height: '54px',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'border-radius': '50%',
        color: '#ffffff',
        'font-size': '22px',
        'font-weight': '700',
        background: '#5b7cfa',
        border: '2px solid rgba(255,255,255,0.85)',
        'box-shadow': '0 4px 16px rgba(0,0,0,0.5)',
        cursor: 'grab',
        'touch-action': 'none',
        'user-select': 'none',
        '-webkit-user-select': 'none',
        visibility: 'visible',
        opacity: '1',
        'pointer-events': 'auto',
    };
    for (const [k, v] of Object.entries(forced)) buttonEl.style.setProperty(k, v, 'important');
    // Default corner position (overridable by drag / restore).
    buttonEl.style.right = '14px';
    buttonEl.style.bottom = '110px';

    document.body.appendChild(buttonEl);

    restoreButtonPosition();
    makeDraggable(buttonEl, () => togglePanel());

    const r = buttonEl.getBoundingClientRect();
    logger.info('Floating button created at', JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }));
}

/** Keep the button fully on-screen when the window/orientation changes. */
function installResizeClamp() {
    if (resizeBound) return;
    resizeBound = true;
    window.addEventListener('resize', () => {
        if (!buttonEl || !buttonEl.isConnected) return;
        const r = buttonEl.getBoundingClientRect();
        const x = Math.min(Math.max(0, r.left), Math.max(0, window.innerWidth - r.width));
        const y = Math.min(Math.max(0, r.top), Math.max(0, window.innerHeight - r.height));
        buttonEl.style.left = `${x}px`;
        buttonEl.style.top = `${y}px`;
        buttonEl.style.right = 'auto';
        buttonEl.style.bottom = 'auto';
    });
}

/** Restore the saved button position (if any), keeping it within the viewport. */
function restoreButtonPosition() {
    const pos = getSettings().buttonPosition;
    if (pos && pos.x != null && pos.y != null) {
        // Clamp so a stale/off-screen saved position can never hide the button.
        const x = Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - 54));
        const y = Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - 54));
        buttonEl.style.left = `${x}px`;
        buttonEl.style.top = `${y}px`;
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
    // Force a very high z-index so the panel can't be buried under theme UI.
    panelEl.style.setProperty('z-index', '2147483646', 'important');
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

/** Show / hide / toggle the full-screen panel. */
export function togglePanel(force) {
    if (!panelEl) return;
    const open = force ?? !panelEl.classList.contains('rpx-open');
    panelEl.classList.toggle('rpx-open', open);
    getSettings().panelOpen = open;
    // Hide the floating button while the full-screen page is open so it
    // doesn't overlap the content; restore it when the page closes.
    if (buttonEl) buttonEl.style.setProperty('display', open ? 'none' : 'flex', 'important');
    if (open) renderActiveTab();
}

function renderActiveTab() {
    const body = panelEl.querySelector('.rpx-tab-body');
    if (!body) return;
    panelEl.querySelectorAll('.rpx-tab').forEach((t) =>
        t.classList.toggle('rpx-active', t.dataset.tab === activeTab));
    if (activeTab === 'gallery') renderGallery(body);
    else if (activeTab === 'diary') renderDiary(body);
    else if (activeTab === 'logs') renderLogsTab(body);
}

/** Render the Logs tab (with diagnostics/refresh/clear controls). */
function renderLogsTab(body) {
    body.innerHTML = `
        <div class="rpx-log-toolbar">
            <button class="rpx-btn rpx-log-diag" type="button"><i class="fa-solid fa-stethoscope"></i> Diagnostics</button>
            <button class="rpx-btn rpx-log-refresh" type="button"><i class="fa-solid fa-rotate"></i> Refresh</button>
            <button class="rpx-btn rpx-log-clear" type="button"><i class="fa-solid fa-trash"></i> Clear</button>
        </div>
        <div class="rpx-log-container"></div>
    `;
    const container = body.querySelector('.rpx-log-container');
    renderLogsInto(container);
    body.querySelector('.rpx-log-diag')?.addEventListener('click', () => { runDiagnostics(); renderLogsInto(container); });
    body.querySelector('.rpx-log-refresh')?.addEventListener('click', () => renderLogsInto(container));
    body.querySelector('.rpx-log-clear')?.addEventListener('click', () => { logger.clear(); renderLogsInto(container); });
}

/** Inline fallback if the HTML template can't be fetched. */
function inlinePanelHtml() {
    return `
    <div id="rpx-panel" class="rpx-panel">
        <div class="rpx-panel-header">
            <span class="rpx-panel-title"><i class="fa-solid fa-compass"></i> RP Explorer</span>
            <div class="rpx-panel-header-actions">
                <button class="rpx-btn rpx-btn-primary rpx-update-now" type="button"><i class="fa-solid fa-rotate"></i> Update</button>
                <button class="rpx-btn rpx-close" type="button"><i class="fa-solid fa-xmark"></i> Close</button>
            </div>
        </div>
        <div class="rpx-tabs">
            <button class="rpx-tab rpx-active" data-tab="gallery" type="button"><i class="fa-solid fa-users"></i> Gallery</button>
            <button class="rpx-tab" data-tab="diary" type="button"><i class="fa-solid fa-book"></i> Diary</button>
            <button class="rpx-tab" data-tab="logs" type="button"><i class="fa-solid fa-terminal"></i> Logs</button>
        </div>
        <div class="rpx-tab-body"></div>
    </div>`;
}
