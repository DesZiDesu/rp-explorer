/**
 * RP Explorer - Tab 1: Character Media Gallery & Relationship Tracker
 *
 * The user supplies base characters (name/age/gender/relationship/info + images,
 * stored GLOBALLY). The AI maintains a PER-CHAT overlay (relationship status,
 * evolving info). This module renders both and exposes CRUD for the base data.
 */

import {
    getAllMergedCharacters,
    upsertGlobalCharacter,
    deleteGlobalCharacter,
    getChatData,
} from './storage.js';

/** HTML-escape helper. */
function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/** Render the whole gallery tab into its container. */
export function renderGallery(root) {
    if (!root) return;
    const characters = getAllMergedCharacters();

    // Group by category for clean management.
    const groups = {};
    for (const c of characters) {
        const cat = c.category || 'Uncategorized';
        (groups[cat] ||= []).push(c);
    }

    let html = `
        <div class="rpx-gallery-toolbar">
            <button class="rpx-btn rpx-btn-primary rpx-add-char" type="button">
                <i class="fa-solid fa-user-plus"></i> Add Character
            </button>
        </div>
    `;

    if (characters.length === 0) {
        html += `<div class="rpx-empty">No characters yet. Add one to start building your gallery.</div>`;
    }

    for (const [category, list] of Object.entries(groups)) {
        html += `<div class="rpx-category"><div class="rpx-category-title">${esc(category)}</div>`;
        for (const c of list) {
            html += renderCard(c);
        }
        html += `</div>`;
    }

    // Relationship graph section (per-chat).
    const rels = getChatData().relationships;
    html += `<div class="rpx-category"><div class="rpx-category-title">Relationship Graph (this chat)</div>`;
    if (rels.length === 0) {
        html += `<div class="rpx-empty">The AI will populate relationships as the roleplay develops.</div>`;
    } else {
        html += `<div class="rpx-rel-list">`;
        for (const r of rels) {
            html += `<div class="rpx-rel-item"><b>${esc(r.from)}</b> → <b>${esc(r.to)}</b>: ${esc(r.status)}${r.note ? ` <span class="rpx-muted">(${esc(r.note)})</span>` : ''}</div>`;
        }
        html += `</div>`;
    }
    html += `</div>`;

    root.innerHTML = html;
    wireGallery(root);
}

/** Render a single character card. */
function renderCard(c) {
    const imgs = (c.images || []).slice(0, 6);
    const imgHtml = imgs.length
        ? `<div class="rpx-card-images">${imgs.map((src) => `<img src="${esc(src)}" loading="lazy" alt="${esc(c.name)}">`).join('')}</div>`
        : `<div class="rpx-card-images rpx-no-image"><i class="fa-solid fa-image"></i></div>`;

    return `
        <div class="rpx-card" data-id="${esc(c.id)}">
            ${imgHtml}
            <div class="rpx-card-body">
                <div class="rpx-card-head">
                    <span class="rpx-card-name">${esc(c.name)}</span>
                    <span class="rpx-card-meta">${esc(c.age)}${c.age && c.gender ? ' · ' : ''}${esc(c.gender)}</span>
                </div>
                ${c.relationshipStatus ? `<div class="rpx-card-rel"><i class="fa-solid fa-heart"></i> ${esc(c.relationshipStatus)}</div>` : ''}
                ${c.info ? `<div class="rpx-card-info">${esc(c.info)}</div>` : ''}
                ${c.dynamicInfo ? `<div class="rpx-card-dynamic"><i class="fa-solid fa-wand-magic-sparkles"></i> ${esc(c.dynamicInfo)}</div>` : ''}
                <div class="rpx-card-actions">
                    <button class="rpx-icon-btn rpx-edit-char" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button class="rpx-icon-btn rpx-del-char" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        </div>
    `;
}

/** Attach event handlers for the gallery tab. */
function wireGallery(root) {
    root.querySelector('.rpx-add-char')?.addEventListener('click', () => openEditor(root, null));

    root.querySelectorAll('.rpx-card').forEach((card) => {
        const id = card.dataset.id;
        card.querySelector('.rpx-edit-char')?.addEventListener('click', () => openEditor(root, id));
        card.querySelector('.rpx-del-char')?.addEventListener('click', () => {
            if (confirm('Delete this character (and its data in this chat)?')) {
                deleteGlobalCharacter(id);
                renderGallery(root);
            }
        });
    });
}

/** Open the add/edit form for a base character. */
function openEditor(root, id) {
    const existing = id ? getAllMergedCharacters().find((c) => c.id === id) : null;
    const c = existing || { name: '', age: '', gender: '', baseRelationship: '', info: '', category: '', images: [] };

    const overlay = document.createElement('div');
    overlay.className = 'rpx-modal-overlay';
    overlay.innerHTML = `
        <div class="rpx-modal">
            <div class="rpx-modal-title">${id ? 'Edit' : 'Add'} Character</div>
            <label class="rpx-field"><span>Name</span><input class="rpx-input" data-f="name" value="${esc(c.name)}"></label>
            <div class="rpx-row">
                <label class="rpx-field"><span>Age</span><input class="rpx-input" data-f="age" value="${esc(c.age)}"></label>
                <label class="rpx-field"><span>Gender</span><input class="rpx-input" data-f="gender" value="${esc(c.gender)}"></label>
            </div>
            <label class="rpx-field"><span>Category</span><input class="rpx-input" data-f="category" placeholder="e.g. Allies, Family" value="${esc(c.category)}"></label>
            <label class="rpx-field"><span>Base relationship</span><input class="rpx-input" data-f="baseRelationship" value="${esc(c.baseRelationship)}"></label>
            <label class="rpx-field"><span>Brief info</span><textarea class="rpx-input" data-f="info" rows="3">${esc(c.info)}</textarea></label>
            <label class="rpx-field"><span>Image URLs (one per line)</span><textarea class="rpx-input" data-f="images" rows="3" placeholder="https://...">${esc((c.images || []).join('\n'))}</textarea></label>
            <div class="rpx-field">
                <span>Or upload images</span>
                <input type="file" class="rpx-file" accept="image/*" multiple>
                <div class="rpx-muted rpx-upload-hint">Uploaded images are stored inline with this character.</div>
            </div>
            <div class="rpx-modal-actions">
                <button class="rpx-btn rpx-cancel" type="button">Cancel</button>
                <button class="rpx-btn rpx-btn-primary rpx-save" type="button">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Hold uploaded (data-URL) images alongside the textarea URLs.
    const uploaded = [];
    overlay.querySelector('.rpx-file')?.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        for (const file of files) {
            const dataUrl = await fileToDataUrl(file);
            uploaded.push(dataUrl);
        }
        toastr.info(`${files.length} image(s) ready to save.`);
    });

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.rpx-cancel')?.addEventListener('click', close);

    overlay.querySelector('.rpx-save')?.addEventListener('click', () => {
        const get = (f) => overlay.querySelector(`[data-f="${f}"]`)?.value ?? '';
        const urlImages = get('images').split('\n').map((s) => s.trim()).filter(Boolean);
        upsertGlobalCharacter({
            id: id || undefined,
            name: get('name').trim() || 'Unnamed',
            age: get('age').trim(),
            gender: get('gender').trim(),
            category: get('category').trim() || 'Uncategorized',
            baseRelationship: get('baseRelationship').trim(),
            info: get('info').trim(),
            images: [...urlImages, ...uploaded],
        });
        close();
        renderGallery(root);
        toastr.success('Character saved.');
    });
}

/** Convert a File to a data URL for inline storage. */
function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
