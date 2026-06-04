/**
 * RP Explorer - API layer
 *
 * Responsible for the ONE outbound request per update. Two modes:
 *
 *   1. Custom endpoint  -> a direct OpenAI-compatible /chat/completions call
 *      using the user-supplied URL + key + model.
 *   2. Default (inherit)-> SillyTavern's currently active connection via
 *      context.generateQuietPrompt (one background generation).
 *
 * Jailbreak inheritance: when enabled we pull the user's current jailbreak /
 * post-history instructions and fold them into the system prompt so the
 * extension's request behaves consistently with the main chat.
 */

import { getContext } from '../../../../extensions.js';
import { getSettings } from './storage.js';

/* ------------------------------------------------------------------ *
 *  JAILBREAK INHERITANCE
 * ------------------------------------------------------------------ */

/**
 * Best-effort gathering of the user's active jailbreak text from whatever
 * SillyTavern surface is available (character card post-history instructions,
 * Chat Completion jailbreak prompt, or instruct mode last-output sequence).
 * All look-ups are defensive because availability varies by ST version/API.
 */
export function gatherJailbreak() {
    const context = getContext();
    const fragments = [];

    try {
        // Character-card jailbreak (a.k.a. post-history instructions).
        const id = context.characterId ?? context.this_chid;
        const char = (context.characters || [])[id];
        const cardJb = char?.data?.post_history_instructions || char?.post_history_instructions;
        if (cardJb) fragments.push(cardJb);
    } catch { /* ignore */ }

    try {
        // Chat Completion preset jailbreak prompt, if exposed.
        const oai = context.chatCompletionSettings || context.oai_settings;
        if (oai?.jailbreak_prompt) fragments.push(oai.jailbreak_prompt);
        else if (oai?.jailbreak_system) fragments.push(oai.jailbreak_system);
    } catch { /* ignore */ }

    try {
        // Substitute {{user}}/{{char}} macros if the helper exists.
        const text = fragments.join('\n\n');
        return typeof context.substituteParams === 'function'
            ? context.substituteParams(text)
            : text;
    } catch {
        return fragments.join('\n\n');
    }
}

/* ------------------------------------------------------------------ *
 *  THE SINGLE REQUEST
 * ------------------------------------------------------------------ */

/**
 * Perform exactly one generation request and return the raw text.
 *
 * @param {{system: string, user: string}} prompt
 * @returns {Promise<string>}
 */
export async function requestUpdate(prompt) {
    const settings = getSettings();

    // Compose the system prompt, optionally prepending the inherited jailbreak.
    let systemPrompt = prompt.system;
    if (settings.inheritJailbreak) {
        const jb = gatherJailbreak();
        if (jb) systemPrompt = `${jb}\n\n${systemPrompt}`;
    }

    if (settings.useCustomApi && settings.customApiUrl) {
        try {
            return await requestCustomEndpoint(settings, systemPrompt, prompt.user);
        } catch (err) {
            // A direct browser fetch to a third-party API usually fails with a
            // CORS/network TypeError. Fall back to SillyTavern's active backend
            // (server-side, no CORS) so the update still succeeds.
            const isNetwork = err instanceof TypeError;
            console.warn('[RP Explorer] Custom endpoint failed, falling back to active API.', err);
            if (typeof getContext().generateQuietPrompt === 'function') {
                if (isNetwork && typeof toastr !== 'undefined') {
                    toastr.info('Custom endpoint unreachable (likely CORS) — using SillyTavern\'s active API instead.');
                }
                return requestDefaultApi(systemPrompt, prompt.user);
            }
            throw err;
        }
    }
    return requestDefaultApi(systemPrompt, prompt.user);
}

/**
 * Mode 1: direct OpenAI-compatible chat-completions call (single fetch).
 */
async function requestCustomEndpoint(settings, systemPrompt, userPrompt) {
    const base = settings.customApiUrl.replace(/\/+$/, '');
    // Allow either a bare host or a full .../chat/completions URL.
    const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;

    const headers = { 'Content-Type': 'application/json' };
    if (settings.customApiKey) {
        headers['Authorization'] = `Bearer ${settings.customApiKey}`;
    }

    const body = {
        model: settings.customModel || 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        temperature: Number(settings.customTemperature) || 0.4,
        max_tokens: Number(settings.customMaxTokens) || 1200,
        stream: false,
    };

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        throw new Error(`Custom API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content
        ?? data?.choices?.[0]?.text
        ?? '';
}

/**
 * Mode 2: inherit SillyTavern's active connection. A single background
 * generation through the normal pipeline (so it respects the user's API,
 * model, proxy, etc.). The full instruction set is embedded into one prompt.
 */
async function requestDefaultApi(systemPrompt, userPrompt) {
    const context = getContext();
    if (typeof context.generateQuietPrompt !== 'function') {
        throw new Error('No custom API configured and generateQuietPrompt is unavailable.');
    }

    // Fold system + user into one quiet prompt -> still a single API call that
    // routes through SillyTavern's currently active connection (the Custom
    // OpenAI-compatible profile, server-side, so no CORS).
    const combined = `${systemPrompt}\n\n${userPrompt}`;

    // Use the positional signature, which is stable across ST versions:
    //   generateQuietPrompt(quiet_prompt, quietToLoud, skipWIAN, ...)
    const result = await context.generateQuietPrompt(combined, false, true);
    if (!result || !String(result).trim()) {
        throw new Error('The active SillyTavern API returned an empty response.');
    }
    return String(result);
}
