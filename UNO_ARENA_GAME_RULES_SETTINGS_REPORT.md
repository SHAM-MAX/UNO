# UNO ARENA — SETTINGS → GAME RULES IMPLEMENTATION REPORT

**Repository:** `https://github.com/SHAM-MAX/UNO`  
**Working Directory:** `C:\Users\ShamSundarR\Downloads\uno`  
**Test Suite Status:** 214 Passing / 0 Failures (100% Pass Rate)

---

## 1. Executive Summary

We have designed, engineered, and verified a comprehensive, production-grade **Settings → Game Rules** customization system across the entire UNO Arena ecosystem:
- **Classic UNO** (108 cards, standard official rules, optional stacking, draw behavior, 7-0 swap/pass, WD4 challenge).
- **UNO Flip** (Light side & Dark side, dual-sided play, optional stacking, draw behavior).
- **Show 'em No Mercy** (168 cards, penalty stacking, draw behavior, 7-swap & 0-pass, configurable Mercy Knockout limit).
- **Play vs AI Mode** (Pre-game rule customization directly on the landing page setup container).
- **Multiplayer Lobby & Arena** (Host-only pre-match rule controls, real-time synchronized rule chips, automatic guest unreadiness on rule changes, and locked in-game rule inspection during live play).

All settings are strictly server-authoritative, backed by SQLite persistence and rehydration, validated with boundary clamping, and integrated seamlessly into UNO Arena's wooden tabletop aesthetic and mobile responsive layouts.

---

## 2. Core Feature Specifications & Rule Matrix

| Setting Name | Key | Permitted Values | Default | Scope | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Missed UNO Penalty** | `missedUnoPenalty` | `1` to `10` cards | `2` | All Modes & AI | Cards drawn when another player catches someone who has 1 card without declaring UNO. Enforced atomically with deck reshuffling protection, duplicate-catch rejection, and Mercy Knockout checks. |
| **Starting Hand Size** | `startingHandSize` | `3` to `10` cards | `7` | All Modes & AI | Number of cards dealt to each player at match start. |
| **Turn Duration** | `turnDuration` | `15s`, `30s`, `45s`, `60s` | `30s` | All Modes & AI | Active turn timer duration with synchronized SVG countdown ring. |
| **Draw-card Stacking (Classic)** | `stackingAllowed` | `true` / `false` | `false` | Classic UNO | Stack Draw 2 on Draw 2, or Wild Draw 4 on Wild Draw 4. |
| **Draw Behavior (Classic)** | `drawUntilPlayable` | `false` (Draw 1) / `true` (Until Playable) | `false` | Classic UNO | Voluntary single draw vs drawing until finding a legally playable card. |
| **7-0 Hand Swap & Pass (Classic)** | `sevenZeroSwap` | `true` / `false` | `false` | Classic UNO | Playing a 7 swaps hand with target player; playing a 0 passes all hands in direction of play. Supported by both Human and AI bots. |
| **Wild Draw Four Challenge (Classic)** | `wildDraw4Challenge` | `true` / `false` | `true` | Classic UNO | Challenging player checks if challenger had matching color; bluffer draws 4 or challenger draws 6. |
| **Draw-card Stacking (Flip)** | `stackingAllowed` | `true` / `false` | `false` | UNO Flip | Stack Draw 1 on Light side, or Draw 5 on Dark side. |
| **Draw Behavior (Flip)** | `drawUntilPlayable` | `false` (Draw 1) / `true` (Until Playable) | `false` | UNO Flip | Voluntary single draw vs drawing until finding a playable card. |
| **Penalty Stacking (No Mercy)** | `stackingAllowed` | `true` / `false` | `true` | No Mercy | Official No Mercy rule: stack equal or higher penalty cards (+2, +4, +6, +10). Can be disabled. |
| **Draw Behavior (No Mercy)** | `drawUntilPlayable` | `true` (Until Playable) / `false` (Draw 1) | `true` | No Mercy | Official No Mercy rule: draw until playable card found. |
| **7-Swap & 0-Pass (No Mercy)** | `sevenZeroSwap` | `true` / `false` | `true` | No Mercy | Official No Mercy rule: 7 swaps hands with chosen player; 0 shifts hands in play direction. |
| **Mercy Knockout (No Mercy)** | `mercyKnockout` | `true` / `false` | `true` | No Mercy | Instantly eliminates players whose hand count meets or exceeds the knockout limit. |
| **Knockout Hand Limit (No Mercy)** | `mercyKnockoutLimit` | `10`, `15`, `20`, `25`, `30`, `35`, `45` | `25` | No Mercy | Hand size threshold triggering immediate elimination. |

---

## 3. Architecture & Server Enforcement

1. **`shared/rules.js`**:
   - `defaultHouseRules(mode)` defines standard baseline configurations per mode.
   - `canStackCard` expanded to handle Classic Draw 2 / Wild Draw 4 stacking and Flip Draw 1 / Draw 5 stacking when `stackingAllowed` is enabled.
   - `isCardPlayable` and `checkMercyKnockout` respect `houseRules.mercyKnockout !== false`.

2. **`server/src/roomManager.js`**:
   - `sanitizeHouseRules(mode, rawRules)` provides boundary enforcement and type safety.
   - `setHouseRules(roomId, playerId, rules)`:
     - Verifies lobby state (`room.status === 'lobby'`).
     - Rejects non-host participants with `Only the host can modify rules`.
     - Automatically resets all non-host human players to `isReady = false` whenever rules change.
     - Logs rule change events into room action history.
     - Persists room state to SQLite.
   - `startGame`: deals `startingHandSize` cards (3–10) per player.
   - `resetTurnTimer` & `handleTurnTimeout`: applies configured `turnDuration` (15s, 30s, 45s, 60s).
   - `catchUno`: atomically draws configured `missedUnoPenalty` (1–10 cards) with deck exhaustion protection, prevents duplicate penalties, and triggers Mercy Knockout if applicable.
   - `playCard` & Bot AI: executes 7-swap and 0-pass when enabled in Classic and No Mercy.
   - `drawCard`: enforces voluntary single draw or draw-until-playable according to `drawUntilPlayable`.
   - `startRematchRoster`: preserves customized house rules for same-mode rematches, and applies compatible defaults when changing modes.

3. **`server/src/index.js`**:
   - Added REST endpoint `PUT /api/rooms/:roomId/rules`.
   - Handled WebSocket event `set_rules` with comprehensive validation and client error reporting.

---

## 4. UI & Visual Integration

1. **Landing Page Play vs AI Setup**:
   - Section 3 added to both desktop `#aiSetupContainer` and mobile `#mobileAiSetupContainer`.
   - Displays real-time rule status badge ("Official Rules" vs "Custom House Rules") and concise rule summary pill.
   - "⚙️ Customize" button opens `#gameRulesModal` pre-populated with mode-specific defaults or custom selections.
   - Start Game button sends configured house rules to `/api/rooms/bot`.

2. **Multiplayer Lobby**:
   - Replaced old No Mercy-only panel with universal `.lobby-rules-panel` across Classic, Flip, and No Mercy.
   - Displays real-time rule chips (Missed UNO penalty, Starting hand size, Turn timer, Stacking, Draw behavior, 7-0 Swap, Knockout limit).
   - Host sees "⚙️ Customize Rules"; guests see "👁️ View Rules".
   - Any rule edit by host instantly broadcasts to all lobby participants and resets guest readiness status.

3. **In-Game Match Rules Inspection**:
   - Clicking "RULES" in the navigation bar during active gameplay (`status === 'playing'`) opens `#gameRulesModal` in read-only mode.
   - Displays prominent locked banner: `🔒 Active match rules are locked and view-only.`
   - Form inputs are disabled; "Restore defaults" is hidden; primary action is "Close ✕".

4. **Mobile Responsiveness**:
   - Full responsive support in portrait (390x844) and landscape (844x390) viewports.
   - Touch-friendly dropdowns, pill toggles, and scrollable container.

---

## 5. Visual Proof & Screenshots

- `game_rules_modal_desktop.png`: Custom rules configuration modal with Missed UNO penalty (5 cards), Hand size (5 cards), and Draw-card stacking.
- `game_rules_ai_setup_desktop.png`: Desktop Play vs AI setup showing updated "Custom House Rules" badge and summary pill.
- `game_rules_lobby_host.png`: Host view in multiplayer lobby with rule chips and "⚙️ Customize Rules" button.
- `game_rules_lobby_guest.png`: Guest view in multiplayer lobby with "👁️ View Rules" and real-time synchronized settings.
- `game_rules_arena_locked_mobile.png`: In-game locked rules inspection on mobile showing read-only state.
- `game_rules_modal_mobile_portrait.png`: Mobile portrait layout of Game Rules modal.
- `game_rules_modal_mobile_landscape.png`: Mobile landscape layout of Game Rules modal.

---

## 6. Automated Verification Results

- Unit & integration tests (`npm.cmd test`): **214 passing / 0 failing**.
- Browser CDP verification (`scripts/verify_game_rules_settings.mjs`): **100% verified across AI setup, arena locking, multiplayer synchronization, and mobile layouts**.
- Git whitespace check (`git diff --check`): **Clean, 0 errors**.

