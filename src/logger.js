/**
 * RP Explorer - Logger & on-device diagnostics
 *
 * A tiny ring-buffer logger that mirrors to localStorage (so logs survive a
 * reload and capture init-time problems), captures global errors, and powers
 * the Logs tab / log modal. Also provides runDiagnostics(), which inspects why
 * the floating button might not be visible — invaluable when there's no easy
 * access to the browser console (e.g. mobile).
 */

const STORAGE_KEY = 'rpExplorer_logs';
const MAX_ENTRIES = 250;

let buffer = load();
const listeners = new Set();

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function persist() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer.slice(-MAX_ENTRIES)));
    } catch { /* storage may be full/unavailable */ }
}

function stringify(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
    try { return JSON.stringify(value); } catch { return String(value); }
}

function add(level, args) {
    const entry = {
        t: Date.now(),
        level,
        msg: args.map(stringify).join(' '),
    };
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
    persist();
    listeners.forEach((fn) => { try { fn(entry); } catch { /* ignore */ } });
}

export const logger = {
    log: (...a) => { console.log('[RP Explorer]', ...a); add('info', a); },
    info: (...a) => { console.info('[RP Explorer]', ...a); add('info', a); },
    warn: (...a) => { console.warn('[RP Explorer]', ...a); add('warn', a); },
    error: (...a) => { console.error('[RP Explorer]', ...a); add('error', a); },
    getLogs: () => buffer.slice(),
    clear: () => { buffer = []; persist(); listeners.forEach((fn) => { try { fn(null); } catch { /* ignore */ } }); },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
};

/** Capture uncaught errors that originate from this extension. */
export function installGlobalHandlers() {
    window.addEventListener('error', (e) => {
        const f = e.filename || '';
        const fromUs = f.includes('rp-explorer') || String(e.error?.stack || '').includes('rp-explorer');
        if (fromUs) {
            add('error', [`Uncaught: ${e.message} @ ${f}:${e.lineno}:${e.colno}`]);
        }
    });
    window.addEventListener('unhandledrejection', (e) => {
        const s = stringify(e.reason);
        if (s.includes('rp-explorer') || s.includes('RP Explorer')) {
            add('error', [`Unhandled promise rejection: ${s}`]);
        }
    });
}

/* ------------------------------------------------------------------ *
 *  DIAGNOSTICS
 * ------------------------------------------------------------------ */

function describe(el) {
    if (!el) return 'null';
    const cls = (typeof el.className === 'string' && el.className)
        ? '.' + el.className.trim().split(/\s+/).join('.')
        : '';
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls}`;
}

/**
 * Inspect the floating button and report (into the log) exactly why it may not
 * be visible: missing, off-screen, transparent, or covered by another element.
 */
export function runDiagnostics() {
    logger.info('=== RP Explorer diagnostics ===');
    logger.info('UA:', navigator.userAgent);
    logger.info('viewport:', `${window.innerWidth}x${window.innerHeight}`, 'dpr:', window.devicePixelRatio);
    logger.info('settings drawer present:', !!document.getElementById('rpx-use-custom-api'));
    logger.info('panel present:', !!document.getElementById('rpx-panel'));

    const fab = document.getElementById('rpx-fab');
    if (!fab) {
        logger.warn('FAB (#rpx-fab) is NOT in the DOM. document.body present:', !!document.body);
        logger.info('=== end diagnostics ===');
        return;
    }

    logger.info('FAB present. connected:', fab.isConnected, 'parent:', describe(fab.parentElement));

    const cs = getComputedStyle(fab);
    logger.info('FAB computed style:', JSON.stringify({
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
        position: cs.position, zIndex: cs.zIndex,
        top: cs.top, left: cs.left, right: cs.right, bottom: cs.bottom,
        width: cs.width, height: cs.height, background: cs.backgroundColor,
        transform: cs.transform, pointerEvents: cs.pointerEvents,
    }));

    const r = fab.getBoundingClientRect();
    logger.info('FAB rect:', JSON.stringify({
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    }));

    const onScreen = r.width > 0 && r.height > 0
        && r.right > 0 && r.bottom > 0
        && r.left < window.innerWidth && r.top < window.innerHeight;
    if (!onScreen) {
        logger.warn('FAB is OFF-SCREEN or has zero size.');
    }

    // What is actually painted at the button's center?
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    if (cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight) {
        const top = document.elementFromPoint(cx, cy);
        const covered = top && !fab.contains(top) && top !== fab;
        logger.info('Element at FAB center:', describe(top), '— is FAB/child:', !covered);
        if (covered) {
            const tcs = getComputedStyle(top);
            logger.warn('FAB is COVERED by:', describe(top), 'z-index:', tcs.zIndex, 'pos:', tcs.position);
        }
    }

    // Ancestors that create a containing block for fixed elements (transform/
    // filter/perspective/will-change/contain) — these can clip/move the FAB.
    let el = fab.parentElement;
    const offenders = [];
    while (el && el !== document.documentElement) {
        const s = getComputedStyle(el);
        if (s.transform !== 'none' || s.filter !== 'none' || s.perspective !== 'none'
            || (s.willChange && s.willChange !== 'auto') || (s.contain && s.contain !== 'none')) {
            offenders.push(`${describe(el)}{transform:${s.transform},filter:${s.filter},contain:${s.contain}}`);
        }
        el = el.parentElement;
    }
    if (offenders.length) {
        logger.warn('Ancestor(s) creating a fixed-positioning containing block:', offenders.join(' | '));
    } else {
        logger.info('No problematic ancestor transform/filter found.');
    }

    logger.info('=== end diagnostics ===');
}

/* ------------------------------------------------------------------ *
 *  LOG RENDERING (shared by the panel tab and the standalone modal)
 * ------------------------------------------------------------------ */

const LEVEL_COLOR = { info: 'var(--rpx-fg, #ddd)', warn: '#e0b020', error: '#ff6b6b' };

export function renderLogsInto(container) {
    if (!container) return;
    const logs = logger.getLogs();
    if (logs.length === 0) {
        container.innerHTML = '<div class="rpx-empty">No logs yet. Tap “Run Diagnostics”.</div>';
        return;
    }
    const rows = logs.slice().reverse().map((e) => {
        const time = new Date(e.t).toLocaleTimeString();
        const color = LEVEL_COLOR[e.level] || LEVEL_COLOR.info;
        const msg = String(e.msg).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
        return `<div class="rpx-log-row" style="color:${color}"><span class="rpx-log-time">${time}</span><span class="rpx-log-lvl">${e.level.toUpperCase()}</span><span class="rpx-log-msg">${msg}</span></div>`;
    }).join('');
    container.innerHTML = `<div class="rpx-log-list">${rows}</div>`;
}

/** Build the full log text for copying. */
export function logsToText() {
    return logger.getLogs()
        .map((e) => `${new Date(e.t).toISOString()} [${e.level}] ${e.msg}`)
        .join('\n');
}

/* ------------------------------------------------------------------ *
 *  STANDALONE LOG MODAL (works even if the floating button is broken)
 * ------------------------------------------------------------------ */

function setImportant(el, styles) {
    for (const [k, v] of Object.entries(styles)) {
        el.style.setProperty(k, v, 'important');
    }
}

/** Open a self-contained, high-z-index log/diagnostics viewer. */
export function showLogModal() {
    document.getElementById('rpx-log-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'rpx-log-modal';
    setImportant(overlay, {
        position: 'fixed', inset: '0', 'z-index': '2147483647',
        background: 'rgba(0,0,0,0.88)', display: 'flex',
        'flex-direction': 'column', color: '#eee', padding: '12px',
        'box-sizing': 'border-box', font: '14px/1.4 system-ui, sans-serif',
    });
    overlay.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap">
            <b style="font-size:16px">RP Explorer — Logs</b>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button id="rpx-log-diag" style="min-height:40px;padding:0 12px">Run Diagnostics</button>
                <button id="rpx-log-refresh" style="min-height:40px;padding:0 12px">Refresh</button>
                <button id="rpx-log-copy" style="min-height:40px;padding:0 12px">Copy</button>
                <button id="rpx-log-clear" style="min-height:40px;padding:0 12px">Clear</button>
                <button id="rpx-log-close" style="min-height:40px;padding:0 12px">Close</button>
            </div>
        </div>
        <div id="rpx-log-body" style="flex:1;overflow:auto;-webkit-overflow-scrolling:touch;background:rgba(255,255,255,0.05);border-radius:8px;padding:8px;white-space:pre-wrap;word-break:break-word"></div>
    `;
    document.body.appendChild(overlay);

    const body = overlay.querySelector('#rpx-log-body');
    const refresh = () => renderLogsInto(body);

    overlay.querySelector('#rpx-log-diag')?.addEventListener('click', () => { runDiagnostics(); refresh(); });
    overlay.querySelector('#rpx-log-refresh')?.addEventListener('click', refresh);
    overlay.querySelector('#rpx-log-clear')?.addEventListener('click', () => { logger.clear(); refresh(); });
    overlay.querySelector('#rpx-log-close')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#rpx-log-copy')?.addEventListener('click', async () => {
        const text = logsToText();
        try {
            await navigator.clipboard.writeText(text);
            if (typeof toastr !== 'undefined') toastr.success('Logs copied to clipboard.');
        } catch {
            // Fallback: select into a temporary textarea.
            const ta = document.createElement('textarea');
            ta.value = text;
            overlay.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch { /* ignore */ }
            ta.remove();
            if (typeof toastr !== 'undefined') toastr.info('Logs selected — long-press to copy.');
        }
    });

    refresh();
}
