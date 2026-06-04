# RP Explorer

A mobile-first **SillyTavern** extension that turns your roleplay into a living
memory bank. It tracks characters, relationships, and story context — updating
itself automatically via a single, quota-friendly API call — and gives you a
private, AI-proof diary on the side.

> A SillyTavern extension that helps users summarise every interaction and
> relationship.

---

## ✨ Features

### Mobile-first UI/UX
- **Touch-friendly** layout: every button/tab/input meets a 44px minimum tap
  target, inputs use 16px font (no iOS zoom-on-focus), and the panel is a
  full-screen sheet on phones that upgrades to a floating side panel on
  tablets/desktops (`@media (min-width: 768px)`).
- **Fully draggable floating button** (FAB) — works with both **touch** and
  **mouse**, clamps to the viewport, remembers its position, and distinguishes
  a *tap* (opens the panel) from a *drag*.
- **Native SillyTavern integration**: a settings drawer inside the Extensions
  zone, plus an entry in the wand "Extensions" quick menu.

### Native toast notification
Every successful update fires SillyTavern's built-in `toastr` notification with
the exact message:

> **Extension data has been successfully updated.**

(see `src/memory.js` → `TOAST_UPDATED`).

### API & model settings
- Use a **custom OpenAI-compatible endpoint** (URL + key + model + temperature +
  max tokens), **or** inherit SillyTavern's currently active API/connection.
- **Jailbreak inheritance**: optionally folds your current jailbreak /
  post-history instructions into the request's system prompt for consistent
  behaviour (`src/api.js` → `gatherJailbreak()`).
- **Full context awareness**: reads your **persona**, the **character
  description**, and the **chat history** to ground every update.

### A. Dynamic memory & auto-update (single API call)
- Updates **automatically every X messages** (configurable) or **manually** via
  the **Update** button.
- **Quota optimisation**: Gallery + Relationships + Context are batched into
  **ONE** API request that returns a single structured JSON object
  (`src/prompts.js` → `buildUpdatePrompt`).
- The saved memory is injected back into generation via `setExtensionPrompt`
  so the AI can **read the memory bank dynamically** during roleplay.

### B. Character Media Gallery & Relationship Tracker (Tab 1)
- Add characters with **images (links or uploads)** + base metadata (Name, Age,
  Gender, Relationship, Brief info), grouped by **category**.
- The AI maintains a **per-chat overlay** on top of your base data — e.g. when a
  relationship changes in the RP, the relationship status is rewritten.
- A per-chat **relationship graph** is maintained automatically.

### C. Personal Diary / Journal (Tab 2)
- A private note area for you. **The AI never reads or writes it** — the update
  pipeline never touches `chatData.diary`; `src/diary.js` is the only writer.

### Logs & diagnostics (Tab 3 + settings)
- A **Logs** tab and a **Diagnostics & Logs** button in the settings drawer.
- Captures extension events + uncaught errors (persisted to `localStorage`).
- **Run Diagnostics** inspects the floating button (computed styles, on-screen
  position, `elementFromPoint` coverage, problematic ancestor transforms) so UI
  issues can be debugged on-device without a desktop console.

### Data scope: per-chat vs. global
- **Per-chat isolation**: all generated memory (gallery overlay, relationships,
  context summary, diary) lives in `chat_metadata`, so switching or deleting a
  chat resets it automatically.
- **Global character base**: only the gallery's *base* character data + images
  are global (`extension_settings`). When a character is pulled into a new chat
  it starts from the base (or a blank record for newly discovered NPCs) and then
  builds chat-specific relationships on top.

---

## 📁 Repository structure

```
rp-explorer/
├── manifest.json          # SillyTavern extension manifest
├── index.js               # Entry point: settings, UI, events, init
├── style.css              # Mobile-first responsive styles
├── templates/
│   ├── panel.html         # Main draggable panel (tabs)
│   └── settings.html      # Settings block for the Extensions drawer
├── src/
│   ├── constants.js       # Keys, defaults, data shapes
│   ├── storage.js         # Global + per-chat storage (scope rules)
│   ├── api.js             # The single request (custom endpoint / inherit)
│   ├── prompts.js         # Batched prompt builder + response parser
│   ├── memory.js          # Update flow, auto-update, memory injection, toast
│   ├── gallery.js         # Tab 1: gallery + relationship tracker
│   ├── diary.js           # Tab 2: user-only diary
│   ├── logger.js          # Logs + on-device diagnostics (Logs tab / modal)
│   └── ui.js              # Draggable FAB + panel + tab switching
├── README.md
└── LICENSE
```

---

## 🔧 How the key requirements are implemented

### The single API call
`runUpdate()` (in `src/memory.js`) calls `buildUpdatePrompt()` once to assemble
a system+user prompt that asks for **one JSON object** containing the gallery
overlay, the relationship graph, and the context summary. `requestUpdate()` in
`src/api.js` performs exactly **one** outbound request:
- **Custom endpoint** → a single `fetch` to `/chat/completions`.
- **Inherited API** → a single `generateQuietPrompt` background generation
  (system + user folded into one prompt).

The response is parsed by `parseUpdateResponse()` (tolerant of code fences /
stray prose) and merged into per-chat storage.

### The native toast
On success, `runUpdate()` calls `toastr.success(TOAST_UPDATED)` — SillyTavern's
built-in notification system — with the required wording.

### Mobile-first responsiveness
`style.css` is authored base-up for phones (large tap targets, full-screen
sheet, safe-area insets, horizontal-scrolling image strips). A single
`min-width: 768px` media query upgrades to a floating side panel and centered
modals. The FAB uses `touch-action: none` and a custom drag handler supporting
both pointer and touch events.

---

## 🚀 Installation

**Via the extension installer (recommended):**
1. In SillyTavern, open **Extensions → Install extension**.
2. Paste this repo's URL:
   `https://github.com/deszidesu/rp-explorer`
3. Install, then reload SillyTavern.

**Manual:**
1. Clone into your SillyTavern third-party extensions folder:
   ```
   public/scripts/extensions/third-party/rp-explorer/
   ```
2. Reload SillyTavern.

---

## 🕹️ Usage
1. Tap the floating **compass** button (drag it anywhere you like).
2. In **Gallery**, add the characters/NPCs you care about with images + info.
3. Roleplay. Every *X* messages (or when you hit **Update**) RP Explorer makes a
   single API call and refreshes relationships + context. You'll get the
   **"Extension data has been successfully updated."** toast.
4. Use the **Diary** tab for private notes the AI can never see.
5. Tune everything (custom API, jailbreak inheritance, auto-update interval,
   memory injection) in **Extensions → RP Explorer**.

---

## 📝 License
MIT — see [LICENSE](./LICENSE).
