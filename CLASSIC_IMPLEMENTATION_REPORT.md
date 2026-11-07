# Classic UNO implementation review

Date: 7 November 2026. Changes are local only; no commit, push or deployment was performed.

Latest targeted UI changes and verification: [Classic interaction refinement review](CLASSIC_INTERACTION_REFINEMENT_REPORT.md).

## Scope and architecture

Improved the existing shared deck/rules, RoomManager, authenticated WebSocket dispatcher and browser client. No second game engine was introduced. Inspected the requested shared, server and client files, existing tests and card assets. Flip and No Mercy retain their decks, artwork, action handling and six-player capacity. Classic supports ten players. Landing and setup layouts were preserved; Classic lobby capacity text was corrected.

Reference: [Mattel W2085 instructions](https://service.mattel.com/instruction_sheets/W2085-Eng.pdf).

## Audit findings and corrections

| Finding | Change |
| --- | --- |
| Classic deck already had the correct composition | Retained deck and added exhaustive counts, IDs and image mapping checks |
| Rooms limited all modes to six players | Classic capacity is ten in admission, API metadata and lobby text; changing a large room to a smaller mode is rejected |
| No dealer selection; opening effects indexed from player zero | Highest-number dealer draw-off, symbol value zero, tied-player redraws; dealer-relative opening effects and rotation between rounds |
| Opening wild selected a random colour | First player must choose through a server-validated pending action; no random colour or timer fallback |
| Draw state was only a boolean | Exact drawn-card ID enforced by server and reflected in playable IDs; repeated draws rejected |
| Drawn Wild Draw Four needed the physical bluff option | The exact drawn Wild Draw Four can be attempted; server retains legality evidence for a challenge |
| Wild Draw Four lacked pre-play legality evidence | Server snapshots the hand and previous active colour before removing the Wild Draw Four, then evaluates the snapshot on challenge |
| No Draw Four response state | Target chooses acceptance or challenge; other plays are blocked until resolution |
| Immediate draw penalties could underdraw across pile exhaustion | Classic penalties draw one card at a time, reshuffling as needed and retaining the top discard |
| UNO catch endpoint ignored its advertised window and allowed self-catching | Server checks the actual target/window; accepted next-player draw/play closes it; no five-second Classic deadline |
| UNO declarations could be stored several turns ahead | Declaration only when current player has two cards, or while their missed-UNO window is still open |
| Emptying a hand ended the entire match | Round result, opponent-hand scoring, cumulative totals and 500-point match completion |
| Final Draw Four ended before its response | Round scoring waits for acceptance/challenge resolution; final Draw Two penalty is also counted |
| Host could restart an active game | Starting is restricted to lobby, round result or match result |
| Replayed or stale socket actions could perform additional work | Bounded persisted action receipts plus server-issued action versions; stale-version requests are rejected before mutation |
| A stale timer could act when play returned to the same player | Timer callbacks verify the captured action version as well as the player index |
| Disconnection during dragging could leave a ghost or queue an old move | Drag and colour-picker cleanup, disabled offline hand, no queued Classic game mutations and session-based recovery |
| No pointer dragging | Threshold, pointer capture, document movement tracking, animation-frame ghost, valid-target highlight, rejected-drop return and state-change cleanup |
| Touch needed a second selection tap | Classic supports direct tap, click, Enter and Space, with one in-flight play |
| No live score/colour context | Active colour, current turn, round and score status; opponent scores and round scoreboard |
| Large-room roster overlapped in landscape | Compact Classic roster grid and dedicated short-landscape sizing |

Existing session tokens and message types are preserved. Additive message types are `choose_color` and `challenge_draw4`; client action IDs are optional for compatibility with older clients. Existing clients without action IDs still receive turn, hand and draw validation, but do not gain receipt-based replay protection. `round_over` is a new state understood by the updated client. Private hand contents, session tokens, deck order and the internal Draw Four legality evidence are not broadcast to opponents.

## Physical Draw Four challenges

The user's follow-up explicitly selected physical bluff-and-challenge play, replacing the initial strict-rejection interpretation. A player may attempt Wild Draw Four even with a matching-colour card. The next player has **Accept +4** and **Challenge Draw Four** controls. Acceptance gives the target four cards and skips them. A successful challenge gives the offender four cards and leaves the challenger to play; a failed challenge gives the challenger six cards and skips them. The chosen colour continues after resolution.

The server stores a copy of the complete pre-play hand and the previous active colour. Resolution evaluates that snapshot, even if the current hand has since changed through an UNO penalty. These private fields are excluded from every client view through an explicit public pending-action allowlist. The public result contains the outcome and penalty; only the challenger receives evidence consisting of the previous colour, whether a matching colour was held, and its count. No opponent card IDs or faces are disclosed.

Pending responses block further plays and passing. Only the targeted player can respond. Server action versions reject delayed actions; persisted action receipts prevent replay, and consuming the pending action prevents repeated penalties from new response IDs. Pending snapshot evidence survives persistence/reconnection. Final-card scoring waits for resolution, including six cards after a failed challenge. The server leaves `winnerId` unset until that resolution.

## Card asset audit

All 108 PNG faces were inspected together in [the contact sheet](scratch/classic-asset-audit.png). The numbers, colours, skips, reverses, draw twos, four wilds and four draw fours correspond to the current mapping. Every deck identity resolves to a distinct existing path. The back is the existing `uno-classic-back.png`.

Actual face dimensions range from **85–87 pixels wide and 125–129 pixels high**, across twelve dimension combinations. The back is **1024 × 1536**. Faces remain readable at hand sizes but are raster sources with limited detail when enlarged, especially on high-density displays. No assets were replaced or artificially upscaled. Images use contained sizing to preserve source proportions, and hand/table faces are preloaded with a bounded cache of existing paths.

## Interaction and animation

Classic pointer play supports mouse, touch and pen APIs; click/tap and keyboard play remain available. Dragging uses cached geometry and requestAnimationFrame transforms. Accepted state changes animate the played card toward the discard pile and newly drawn cards from the deck. Invalid drops return to the hand. Updated opponent counts pulse; action messages cover skips, draws, UNO and challenge outcomes. Direction changes, colour picker/results and round/match modals provide short visual feedback. Reduced-motion preferences disable the added motion. Visual effects do not change authoritative state.

The existing 20-second server deadline remains, except an opening wild waits for the required explicit colour choice. The latest refinement displays its countdown around the active player’s avatar instead of the common floating timer. This timer is an existing online-game convention, not a rule from the physical instruction sheet.

## Verification

- `npm.cmd test`: **74 tests passed, zero failures**. Includes the existing Flip, No Mercy, persistence, authenticated WebSocket and timer checks.
- New rule tests cover deck composition, all 108 mappings, player counts 2/3/6/10, opening effects for two and three players, excluded opening Draw Four, drawing, exact identity, UNO boundaries, colour validation, Draw Four responses, scoring, last-card penalties and reshuffle conservation.
- Simulated complete matches at 2/3/6/10 players reach 500 while checking all 108 unique card IDs after every action.
- The WebSocket integration test checks authenticated identity, hidden hands, room collision protection, state broadcast and action replay receipts.
- `node scripts/verify_classic_complete.mjs` uses an isolated local test server/database and headless Chrome. It sends actual mouse, touch and keyboard input for interactions and checks server state. Full natural matches to 500 at two, three, six and ten players use the rendered host client and authenticated WebSocket peers, including repeated round transitions. Separate actual input tests cover mouse, touch and keyboard actions.
- Browser checks include mouse click/drag, touch tap/drag, keyboard activation, invalid drop, wild colour selection, opening wild choice, draw pile, successful/failed challenges, accepting a bluff, final play, round result and next round. A real client WebSocket is closed during touch dragging: the ghost disappears, an attempted offline draw is blocked, and the same session/hand recovers after automatic reconnection.
- Screenshots captured at **360×800, 390×844, 412×915, 768×1024, 1366×768 and 1920×1080**, plus **844×390** landscape for ten players. The two-player snapshots checked image loading and horizontal overflow. Ten-player snapshots were visually reviewed for roster/table/hand placement.
- Machine-readable browser results: [results.json](scratch/classic-verification/results.json). Latest interaction-only results: [results-interactions.json](scratch/classic-verification/results-interactions.json). Unit results: [classic-test-final.txt](scratch/classic-test-final.txt).

Selected screenshots: [desktop](scratch/classic-verification/1366x768.png), [mobile](scratch/classic-verification/390x844.png), [ten-player portrait](scratch/classic-verification/10players-390x844.png), [ten-player landscape](scratch/classic-verification/10players-844x390.png).

## Review limits

Chrome touch emulation was used; physical phones, low-end-device performance, pen hardware, Safari and Firefox were not tested. Full ten-player matches now also run through authenticated WebSockets with a rendered host browser. Transport interruption during dragging is verified by closing that browser WebSocket, but physical network loss and device radio transitions were not tested. Card source resolution remains the material visual limitation; strict Draw Four rejection has been removed as requested. No production deployment verification was attempted.

The pre-existing untracked `scripts/verify_mobile_refinement.mjs` was left untouched. Test databases, contact sheet and screenshots are under the ignored `scratch/` directory. The repository's older tests also write to the existing local development database, as they did before these changes.

## Extended browser match evidence

These complete matches used the physical Draw Four flow and server-authoritative scoring:

- Full natural 2-player match: 946 actions, 17 rounds, winner 505 points, browser and WebSocket peers
- Full natural 3-player match: 1351 actions, 18 rounds, winner 572 points, browser and WebSocket peers
- Full natural 6-player match: 650 actions, 10 rounds, winner 816 points, browser and WebSocket peers
- Full natural 10-player match: 358 actions, 5 rounds, winner 736 points, browser and WebSocket peers

The separate three-client WebSocket integration test verifies all response outcomes, observer privacy, recipient-only evidence, duplicate responses, stale responses and synchronized card counts/turns. Additional tests cover dealer draw-off ties, symbol-as-zero handling, stale timer protection, reopening a pending challenge after server rehydration and an opening wild remaining unresolved when an old timer fires.
