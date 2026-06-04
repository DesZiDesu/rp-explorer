/**
 * RP Explorer - Tab 2: Personal Diary / Journal
 *
 * STRICT RULE: This is a manual, user-only area. Nothing in the update flow
 * (memory.js / api.js) ever reads from or writes to chatData.diary, so the AI
 * can never modify, overwrite, or even see these entries. This module is the
 * ONLY writer of the diary.
 *
 * Storage scope: per-chat (lives in chat_metadata), per the isolation spec.
 */

import { getChatData, saveChatData } from './storage.js';

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/** Render the diary tab. */
export function renderDiary(root) {
    if (!root) return;
    const entries = getChatData().diary;

    let html = `
        <div class="rpx-diary-note">
            <i class="fa-solid fa-lock"></i> Private journal — the AI never reads or edits this.
        </div>
        <div class="rpx-diary-compose">
            <input class="rpx-input rpx-diary-title" placeholder="Entry title">
            <textarea class="rpx-input rpx-diary-body" rows="3" placeholder="Write your private note…"></textarea>
            <button class="rpx-btn rpx-btn-primary rpx-diary-add" type="button">
                <i class="fa-solid fa-plus"></i> Add Entry
            </button>
        </div>
    `;

    if (entries.length === 0) {
        html += `<div class="rpx-empty">No journal entries yet.</div>`;
    } else {
        html += `<div class="rpx-diary-list">`;
        // Newest first.
        for (const entry of [...entries].reverse()) {
            html += `
                <div class="rpx-diary-entry" data-id="${esc(entry.id)}">
                    <div class="rpx-diary-entry-head">
                        <span class="rpx-diary-entry-title">${esc(entry.title) || '(untitled)'}</span>
                        <div class="rpx-diary-entry-actions">
                            <span class="rpx-diary-entry-date">${esc(entry.date)}</span>
                            <button class="rpx-icon-btn rpx-diary-edit" title="Edit"><i class="fa-solid fa-pen"></i></button>
                            <button class="rpx-icon-btn rpx-diary-del" title="Delete"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="rpx-diary-entry-body">${esc(entry.body)}</div>
                </div>
            `;
        }
        html += `</div>`;
    }

    root.innerHTML = html;
    wireDiary(root);
}

function wireDiary(root) {
    root.querySelector('.rpx-diary-add')?.addEventListener('click', () => {
        const title = root.querySelector('.rpx-diary-title')?.value.trim() ?? '';
        const body = root.querySelector('.rpx-diary-body')?.value.trim() ?? '';
        if (!title && !body) {
            toastr.info('Nothing to add — write something first.');
            return;
        }
        const data = getChatData();
        data.diary.push({
            id: `d_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
            title,
            body,
            date: new Date().toLocaleString(),
        });
        saveChatData();
        renderDiary(root);
        toastr.success('Journal entry added.');
    });

    root.querySelectorAll('.rpx-diary-entry').forEach((el) => {
        const id = el.dataset.id;
        el.querySelector('.rpx-diary-del')?.addEventListener('click', () => {
            if (!confirm('Delete this journal entry?')) return;
            const data = getChatData();
            data.diary = data.diary.filter((e) => e.id !== id);
            saveChatData();
            renderDiary(root);
        });
        el.querySelector('.rpx-diary-edit')?.addEventListener('click', () => editEntry(root, id));
    });
}

/** Inline edit an existing entry. */
function editEntry(root, id) {
    const data = getChatData();
    const entry = data.diary.find((e) => e.id === id);
    if (!entry) return;
    const el = root.querySelector(`.rpx-diary-entry[data-id="${id}"]`);
    if (!el) return;

    el.innerHTML = `
        <input class="rpx-input rpx-edit-title" value="${esc(entry.title)}">
        <textarea class="rpx-input rpx-edit-body" rows="3">${esc(entry.body)}</textarea>
        <div class="rpx-modal-actions">
            <button class="rpx-btn rpx-edit-cancel" type="button">Cancel</button>
            <button class="rpx-btn rpx-btn-primary rpx-edit-save" type="button">Save</button>
        </div>
    `;
    el.querySelector('.rpx-edit-cancel')?.addEventListener('click', () => renderDiary(root));
    el.querySelector('.rpx-edit-save')?.addEventListener('click', () => {
        entry.title = el.querySelector('.rpx-edit-title')?.value.trim() ?? '';
        entry.body = el.querySelector('.rpx-edit-body')?.value.trim() ?? '';
        saveChatData();
        renderDiary(root);
        toastr.success('Entry updated.');
    });
}
