/**
 * RP Explorer - Storage layer
 *
 * Two scopes:
 *   1. GLOBAL  -> extension_settings[SETTINGS_KEY]      (shared across chats)
 *   2. PER-CHAT-> chat_metadata[METADATA_KEY]           (isolated per chat)
 *
 * The only "global" RP data is the Media Gallery's BASE character info +
 * images (settings.globalCharacters). Every dynamic value the AI generates
 * (relationships, context, chat-specific gallery overlay, diary) is per-chat.
 */

import { extension_settings, getContext } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import {
    SETTINGS_KEY,
    METADATA_KEY,
    defaultSettings,
    defaultChatData,
} from './constants.js';

/* ------------------------------------------------------------------ *
 *  GLOBAL SETTINGS
 * ------------------------------------------------------------------ */

/** Ensure the global settings object exists & has every default key. */
export function initSettings() {
    if (!extension_settings[SETTINGS_KEY]) {
        extension_settings[SETTINGS_KEY] = {};
    }
    const defaults = defaultSettings();
    const store = extension_settings[SETTINGS_KEY];
    for (const [key, value] of Object.entries(defaults)) {
        if (store[key] === undefined) {
            store[key] = value;
        }
    }
    return store;
}

/** Get the live global settings object. */
export function getSettings() {
    return initSettings();
}

/** Persist global settings (debounced by SillyTavern). */
export function saveSettings() {
    saveSettingsDebounced();
}

/* ------------------------------------------------------------------ *
 *  PER-CHAT DATA
 * ------------------------------------------------------------------ */

/**
 * Get the live per-chat data object, creating defaults on first access.
 * Reads from chat_metadata via the SillyTavern context so it always tracks
 * the *currently active* chat. When the user switches/deletes a chat this
 * automatically points at the new chat's metadata.
 */
export function getChatData() {
    const context = getContext();
    const metadata = context.chatMetadata ?? context.chat_metadata ?? {};

    if (!metadata[METADATA_KEY]) {
        metadata[METADATA_KEY] = defaultChatData();
    } else {
        // Backfill any newly added default keys without clobbering data.
        const defaults = defaultChatData();
        for (const [key, value] of Object.entries(defaults)) {
            if (metadata[METADATA_KEY][key] === undefined) {
                metadata[METADATA_KEY][key] = value;
            }
        }
    }
    return metadata[METADATA_KEY];
}

/** Persist per-chat data into the active chat file (debounced). */
export function saveChatData() {
    const context = getContext();
    if (typeof context.saveMetadata === 'function') {
        // saveMetadata persists chat_metadata for the active chat.
        context.saveMetadata();
    } else if (typeof context.saveChat === 'function') {
        context.saveChat();
    }
}

/* ------------------------------------------------------------------ *
 *  GLOBAL CHARACTER BASE  (shared media gallery base data)
 * ------------------------------------------------------------------ */

/** Return the global base-character map (shared across all chats). */
export function getGlobalCharacters() {
    return getSettings().globalCharacters;
}

/** Create / update a global base character. */
export function upsertGlobalCharacter(character) {
    const chars = getGlobalCharacters();
    const id = character.id || `char_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
    chars[id] = {
        id,
        name: character.name ?? '',
        age: character.age ?? '',
        gender: character.gender ?? '',
        baseRelationship: character.baseRelationship ?? '',
        info: character.info ?? '',
        category: character.category ?? 'Uncategorized',
        images: Array.isArray(character.images) ? character.images : [],
        ...character,
        id, // keep id authoritative
    };
    saveSettings();
    return chars[id];
}

/** Delete a global base character and its per-chat overlay (current chat). */
export function deleteGlobalCharacter(id) {
    const chars = getGlobalCharacters();
    delete chars[id];
    saveSettings();

    const chatData = getChatData();
    if (chatData.gallery[id]) {
        delete chatData.gallery[id];
        saveChatData();
    }
}

/**
 * Merge a global base character with its per-chat dynamic overlay so the UI
 * (and the AI) can read a single, complete view.
 *
 * Per spec: when a character is pulled into a new chat it starts from the
 * BASE data and then builds chat-specific relationships on top.
 */
export function getMergedCharacter(id) {
    const base = getGlobalCharacters()[id];
    if (!base) return null;
    const overlay = getChatData().gallery[id] || {};
    return {
        ...base,
        relationshipStatus: overlay.relationshipStatus ?? base.baseRelationship ?? '',
        dynamicInfo: overlay.dynamicInfo ?? '',
        notes: overlay.notes ?? '',
        lastUpdated: overlay.lastUpdated ?? 0,
    };
}

/** Return every character merged with the current chat's overlay. */
export function getAllMergedCharacters() {
    return Object.keys(getGlobalCharacters()).map(getMergedCharacter).filter(Boolean);
}

/**
 * Apply an AI-generated overlay onto the current chat for a character.
 * This only ever writes to the PER-CHAT store, never the global base.
 */
export function applyChatOverlay(id, overlay) {
    const chatData = getChatData();
    if (!chatData.gallery[id]) chatData.gallery[id] = {};
    Object.assign(chatData.gallery[id], overlay, { lastUpdated: Date.now() });
}
