/**
 * RP Explorer - Constants & default data shapes
 *
 * MODULE_NAME must match the third-party extension folder name so that
 * template loading (renderExtensionTemplateAsync) resolves correctly.
 */

export const MODULE_NAME = 'rp-explorer';

// Path used by SillyTavern's template loader for third-party extensions.
export const TEMPLATE_PATH = `third-party/${MODULE_NAME}`;

// Key used to store global settings inside `extension_settings`.
export const SETTINGS_KEY = 'rpExplorer';

// Key used to namespace per-chat data inside `chat_metadata`.
export const METADATA_KEY = 'rpExplorer';

// Identifier used when injecting memory into the generation prompt.
export const EXT_PROMPT_KEY = 'RP_EXPLORER_MEMORY';

// The exact notification text required by the product spec.
export const TOAST_UPDATED = 'Extension data has been successfully updated.';

/**
 * Default global settings. Stored globally (shared across every chat).
 * NOTE: globalCharacters holds only the *base* character data + images,
 * which is intentionally global per the spec. All dynamic / relationship
 * data lives per-chat (see defaultChatData).
 */
export function defaultSettings() {
    return {
        // --- API / model ---
        useCustomApi: false,
        customApiUrl: '',
        customApiKey: '',
        customModel: 'gpt-4o-mini',
        customMaxTokens: 1200,
        customTemperature: 0.4,

        // --- Behaviour ---
        inheritJailbreak: true,
        autoUpdateEnabled: true,
        autoUpdateInterval: 5, // run an update every X messages
        injectMemory: true, // expose memory to the AI during RP

        // --- UI ---
        buttonPosition: { x: null, y: null }, // null => default CSS position
        panelOpen: false,

        // --- Global character base (shared across chats) ---
        // shape: { [charId]: { id, name, age, gender, baseRelationship,
        //                      info, category, images: [url, ...] } }
        globalCharacters: {},
    };
}

/**
 * Default per-chat data. Everything here is isolated to a single chat and
 * lives inside chat_metadata so switching/deleting a chat resets it.
 */
export function defaultChatData() {
    return {
        // Dynamic, chat-specific overlay on top of the global character base.
        // shape: { [charId]: { relationshipStatus, dynamicInfo, notes,
        //                      lastUpdated } }
        gallery: {},

        // Free-form relationship graph entries discovered during RP.
        // shape: [{ from, to, status, note }]
        relationships: [],

        // Rolling context summary maintained by the AI.
        context: {
            summary: '',
            keyEvents: [], // [{ text, at }]
            lastUpdated: 0,
        },

        // STRICTLY user-owned. The AI must NEVER write to this.
        // shape: [{ id, title, body, date }]
        diary: [],

        // Bookkeeping for the auto-update trigger.
        lastUpdateAtMessageCount: 0,
    };
}
