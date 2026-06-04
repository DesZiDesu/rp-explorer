/**
 * RP Explorer - Prompt construction & response parsing
 *
 * Everything here exists to support the "SINGLE API call" requirement:
 * one prompt batches the three tasks (Gallery overlay, Relationships,
 * Context summary) and asks for ONE structured JSON object back.
 */

import { getContext } from '../../../../extensions.js';
import { getAllMergedCharacters, getChatData } from './storage.js';

/* ------------------------------------------------------------------ *
 *  CONTEXT GATHERING (Persona + Character + Chat history)
 * ------------------------------------------------------------------ */

/** Collect the user's persona block. */
function gatherPersona(context) {
    const name = context.name1 || 'User';
    let description = '';
    try {
        // power_user.persona_description holds the active persona text.
        description = context.powerUserSettings?.persona_description
            || context.power_user?.persona_description
            || '';
    } catch { /* ignore */ }
    return { name, description };
}

/** Collect the active character's description / personality / scenario. */
function gatherCharacter(context) {
    const id = context.characterId ?? context.this_chid;
    const char = (context.characters || [])[id];
    if (!char) return { name: context.name2 || 'Character', description: '' };
    const parts = [char.description, char.personality, char.scenario]
        .filter(Boolean)
        .join('\n');
    return { name: char.name || context.name2 || 'Character', description: parts };
}

/**
 * Collect chat history. To respect quota we cap the history that is sent.
 * The full history is *available* (spec), but we send a recent window plus
 * the rolling summary so the model still has long-term awareness.
 */
function gatherHistory(context, maxMessages = 40) {
    const chat = context.chat || [];
    const recent = chat.slice(-maxMessages);
    return recent
        .filter((m) => !m.is_system)
        .map((m) => `${m.name || (m.is_user ? 'User' : 'Char')}: ${m.mes}`)
        .join('\n');
}

/* ------------------------------------------------------------------ *
 *  THE BATCHED INSTRUCTION PROMPT
 * ------------------------------------------------------------------ */

/**
 * Build the single batched user prompt that asks the model to update all
 * three subsystems at once and return a single JSON object.
 *
 * @returns {{ system: string, user: string }}
 */
export function buildUpdatePrompt() {
    const context = getContext();
    const persona = gatherPersona(context);
    const character = gatherCharacter(context);
    const history = gatherHistory(context);
    const chatData = getChatData();
    const characters = getAllMergedCharacters();

    const knownCharacters = characters.map((c) => ({
        id: c.id,
        name: c.name,
        currentRelationship: c.relationshipStatus || c.baseRelationship || 'unknown',
        notes: c.notes || '',
    }));

    const system = [
        'You are RP Explorer, a silent background memory engine for a roleplay session.',
        'Your job is to read the roleplay context and UPDATE three data systems in ONE response.',
        'You never speak to the user and never roleplay. You only output structured data.',
        'Output MUST be a single valid JSON object and nothing else (no markdown, no prose).',
    ].join(' ');

    const schema = {
        gallery: [
            {
                id: '<existing character id or null for a new one>',
                name: '<character name>',
                relationshipStatus: '<current relationship toward the user, updated from the chat>',
                dynamicInfo: '<short evolving facts learned this chat>',
                notes: '<optional extra notes>',
            },
        ],
        relationships: [
            { from: '<name>', to: '<name>', status: '<relationship>', note: '<why>' },
        ],
        context: {
            summary: '<concise running summary of the roleplay so far>',
            keyEvents: ['<important event>', '<important event>'],
        },
    };

    const user = [
        '### USER PERSONA',
        `Name: ${persona.name}`,
        persona.description || '(no persona description)',
        '',
        '### ACTIVE CHARACTER',
        `Name: ${character.name}`,
        character.description || '(no character description)',
        '',
        '### KNOWN CHARACTERS (gallery base + current per-chat state)',
        knownCharacters.length ? JSON.stringify(knownCharacters, null, 2) : '(none yet)',
        '',
        '### PREVIOUS SUMMARY',
        chatData.context.summary || '(none yet)',
        '',
        '### RECENT CHAT HISTORY',
        history || '(empty)',
        '',
        '### TASK',
        'Update the gallery (relationship + evolving info for each relevant character),',
        'the relationship graph, and the running context summary based on the chat above.',
        'For characters already in KNOWN CHARACTERS keep their "id". For brand-new NPCs use id: null.',
        'Only include characters that actually appear or are referenced. Be concise.',
        '',
        '### REQUIRED OUTPUT FORMAT (return exactly this JSON shape, filled in):',
        JSON.stringify(schema, null, 2),
    ].join('\n');

    return { system, user };
}

/* ------------------------------------------------------------------ *
 *  RESPONSE PARSING
 * ------------------------------------------------------------------ */

/**
 * Extract a JSON object from an LLM response that may be wrapped in code
 * fences or contain leading/trailing prose.
 */
export function parseUpdateResponse(raw) {
    if (!raw || typeof raw !== 'string') return null;

    let text = raw.trim();

    // Strip ```json ... ``` / ``` ... ``` fences.
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = fence[1].trim();

    // Fall back to the outermost {...} block.
    if (!text.startsWith('{')) {
        const first = text.indexOf('{');
        const last = text.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
            text = text.slice(first, last + 1);
        }
    }

    try {
        const data = JSON.parse(text);
        return {
            gallery: Array.isArray(data.gallery) ? data.gallery : [],
            relationships: Array.isArray(data.relationships) ? data.relationships : [],
            context: {
                summary: data.context?.summary ?? '',
                keyEvents: Array.isArray(data.context?.keyEvents) ? data.context.keyEvents : [],
            },
        };
    } catch (err) {
        console.error('[RP Explorer] Failed to parse update response:', err, raw);
        return null;
    }
}
