/**
 * RP Explorer - Memory orchestrator
 *
 * - runUpdate():      the single-API-call update flow (manual or auto).
 * - maybeAutoUpdate(): message-count trigger for automatic updates.
 * - injectMemory():   exposes saved memory to the AI during roleplay so it
 *                     can "read" the memory bank dynamically.
 */

import { getContext } from '../../../../extensions.js';
import {
    getSettings,
    getChatData,
    saveChatData,
    getAllMergedCharacters,
    upsertGlobalCharacter,
    applyChatOverlay,
} from './storage.js';
import { buildUpdatePrompt, parseUpdateResponse } from './prompts.js';
import { requestUpdate } from './api.js';
import { EXT_PROMPT_KEY, TOAST_UPDATED } from './constants.js';

let isUpdating = false;

/** Expose whether an update is currently running (for UI state). */
export function getIsUpdating() {
    return isUpdating;
}

/* ------------------------------------------------------------------ *
 *  THE UPDATE FLOW  (one API call -> merge -> notify)
 * ------------------------------------------------------------------ */

/**
 * Run a full memory update. Batches Gallery + Relationships + Context into a
 * single API request, merges the parsed result into per-chat storage, and
 * fires the required native toast notification.
 *
 * @param {{ silent?: boolean, onState?: (state:string)=>void }} [opts]
 * @returns {Promise<boolean>} success
 */
export async function runUpdate(opts = {}) {
    const { silent = false, onState } = opts;
    if (isUpdating) {
        if (!silent) toastr.info('RP Explorer is already updating…');
        return false;
    }

    const context = getContext();
    if (!context.chat || context.chat.length === 0) {
        if (!silent) toastr.warning('No chat history to summarise yet.');
        return false;
    }

    isUpdating = true;
    onState?.('updating');

    try {
        // 1) Build the single batched prompt.
        const prompt = buildUpdatePrompt();

        // 2) ONE outbound request.
        const raw = await requestUpdate(prompt);

        // 3) Parse the structured response.
        const parsed = parseUpdateResponse(raw);
        if (!parsed) {
            if (!silent) toastr.error('RP Explorer could not parse the AI response.');
            onState?.('error');
            return false;
        }

        // 4) Merge into per-chat storage.
        mergeUpdate(parsed);

        // 5) Refresh the memory injected into future generations.
        injectMemory();

        // 6) Required native notification.
        toastr.success(TOAST_UPDATED);
        onState?.('done');

        // Let the rest of the UI know data changed.
        document.dispatchEvent(new CustomEvent('rpExplorer:updated'));
        return true;
    } catch (err) {
        console.error('[RP Explorer] Update failed:', err);
        if (!silent) toastr.error(`RP Explorer update failed: ${err.message}`);
        onState?.('error');
        return false;
    } finally {
        isUpdating = false;
    }
}

/**
 * Merge a parsed AI response into storage.
 *  - Gallery entries with an existing id -> per-chat overlay only.
 *  - Gallery entries with no id -> create a NEW global base char, then overlay.
 *  - Relationships + context summary -> per-chat.
 *
 * The diary is intentionally untouched here. The AI never writes to it.
 */
function mergeUpdate(parsed) {
    const chatData = getChatData();
    const known = new Map(getAllMergedCharacters().map((c) => [c.id, c]));

    for (const entry of parsed.gallery) {
        let id = entry.id;

        // Resolve by name if the model dropped/garbled the id.
        if (!id || !known.has(id)) {
            const byName = getAllMergedCharacters()
                .find((c) => c.name?.toLowerCase() === String(entry.name || '').toLowerCase());
            id = byName?.id || null;
        }

        if (!id) {
            // Brand-new NPC discovered in RP: seed a global base record
            // (blank base, per spec) then build chat-specific data on top.
            const created = upsertGlobalCharacter({
                name: entry.name || 'Unknown',
                baseRelationship: '',
                info: '',
                category: 'Discovered',
            });
            id = created.id;
        }

        applyChatOverlay(id, {
            relationshipStatus: entry.relationshipStatus ?? '',
            dynamicInfo: entry.dynamicInfo ?? '',
            notes: entry.notes ?? '',
        });
    }

    // Relationship graph (replace with the latest snapshot).
    if (parsed.relationships.length) {
        chatData.relationships = parsed.relationships;
    }

    // Rolling context summary.
    if (parsed.context.summary) {
        chatData.context.summary = parsed.context.summary;
    }
    if (parsed.context.keyEvents?.length) {
        chatData.context.keyEvents = parsed.context.keyEvents.map((text) => ({
            text,
            at: Date.now(),
        }));
    }
    chatData.context.lastUpdated = Date.now();
    chatData.lastUpdateAtMessageCount = (getContext().chat || []).length;

    saveChatData();
}

/* ------------------------------------------------------------------ *
 *  AUTO-UPDATE TRIGGER
 * ------------------------------------------------------------------ */

/**
 * Called on each new message. Triggers a silent update once the configured
 * number of messages has elapsed since the last update.
 */
export async function maybeAutoUpdate() {
    const settings = getSettings();
    if (!settings.autoUpdateEnabled) return;
    if (isUpdating) return;

    const chatLength = (getContext().chat || []).length;
    const chatData = getChatData();
    const elapsed = chatLength - (chatData.lastUpdateAtMessageCount || 0);

    if (elapsed >= Math.max(1, Number(settings.autoUpdateInterval) || 5)) {
        await runUpdate({ silent: false });
    }
}

/* ------------------------------------------------------------------ *
 *  MEMORY INJECTION  (AI reads the memory during RP)
 * ------------------------------------------------------------------ */

/**
 * Inject the current memory bank into the generation prompt so the AI can
 * read it dynamically while roleplaying. Uses setExtensionPrompt at a small
 * depth so it stays near the end of context.
 */
export function injectMemory() {
    const context = getContext();
    const settings = getSettings();
    if (typeof context.setExtensionPrompt !== 'function') return;

    if (!settings.injectMemory) {
        context.setExtensionPrompt(EXT_PROMPT_KEY, '', 1, 4);
        return;
    }

    const text = buildMemoryBlock();
    // position 1 = IN_CHAT, depth 4, scan = true.
    context.setExtensionPrompt(EXT_PROMPT_KEY, text, 1, 4, true);
}

/** Build the human/AI-readable memory block from per-chat storage. */
function buildMemoryBlock() {
    const chatData = getChatData();
    const characters = getAllMergedCharacters();

    const lines = ['[RP Explorer Memory Bank]'];

    if (chatData.context.summary) {
        lines.push(`Summary: ${chatData.context.summary}`);
    }

    const relevant = characters.filter(
        (c) => c.relationshipStatus || c.dynamicInfo || c.notes,
    );
    if (relevant.length) {
        lines.push('Characters & relationships:');
        for (const c of relevant) {
            const bits = [c.name];
            if (c.age) bits.push(`age ${c.age}`);
            if (c.gender) bits.push(c.gender);
            const head = bits.join(', ');
            const rel = c.relationshipStatus ? ` — relationship: ${c.relationshipStatus}` : '';
            const info = c.dynamicInfo ? ` (${c.dynamicInfo})` : '';
            lines.push(`- ${head}${rel}${info}`);
        }
    }

    if (chatData.relationships.length) {
        lines.push('Relationship graph:');
        for (const r of chatData.relationships.slice(0, 20)) {
            lines.push(`- ${r.from} → ${r.to}: ${r.status}${r.note ? ` (${r.note})` : ''}`);
        }
    }

    return lines.length > 1 ? lines.join('\n') : '';
}
