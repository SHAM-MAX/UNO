# Classic interaction refinement review

7 November 2026. Local changes only; nothing committed, pushed or deployed.

## Changes

- Replaced the previous short destination transforms with temporary travelling cards. The client captures source geometry before sending a draw/play action, waits for authoritative state, and animates to the resulting hand/discard position over 300–450 ms. Draws travel with a back and reveal the correct face near arrival, using the same animation timeline. Retained hand cards move into their updated fan positions. Penalties animate actual card-count increases; opponent cards remain face down.
- Removed the ordinary Classic DRAW CARD control from view. The existing native draw-pile button remains keyboard-accessible, visibly enabled/disabled, and uses the existing one-request handler. It is disabled during all pending actions. Wild Draw Four uses a separate ACCEPT +4 control and the existing Challenge control.
- Attached the existing countdown display to the active player's avatar. Opponent profiles use initials; the current player has an initials profile beside their hand. Exactly one ring displays, derived from the existing server deadline and 20-second duration. The existing shared interval is reused. Flip and No Mercy retain their common timer.
- Moved CALL UNO beside the local hand. It is visible only with exactly two cards, on the local turn, before declaration, and when server-authorized. Confirmation waits for the server. Repeated declaration requests are blocked by the client and rejected by the server.
- Changed the authorized missed-UNO action label to CAUGHT. An opponent who called UNO displays non-interactive CAUGHT FAILED while holding one card. A stale catch request returns CAUGHT FAILED without changing hands or turns. A successful catch animates two penalty cards on the affected player's client and towards that player's card fan on other clients.
- Hid the repetitive last-card banner and common floating timer in Classic. Round/colour/turn/score context remains. UNO, catches, challenges and penalties use the existing temporary toast component.
- Added ghost cleanup on newer state, errors, disconnect, visibility changes and leaving the room. Reduced motion renders the authoritative final state immediately. Zero-size/hidden geometry and room/round transitions are excluded from travel animations.

The wooden tabletop, felt, card images, hand fan, piles, navbar and other-mode artwork remain unchanged. No avatar photos were available in the existing player model, so profiles use initials.

## Files changed for this refinement

- `client/app.js`: action guards, source capture, coordinated travel, profiles, timer placement, UNO/catch presentation and cleanup.
- `client/arena.css`: scoped Classic controls, profiles, ring, temporary card geometry and small toast styling.
- `server/src/roomManager.js`: explicit failed-catch feedback and duplicate UNO rejection; existing rule timing and penalty calculation retained.
- `server/tests/classic_complete.test.js`: repeated declaration and stale-catch non-mutation regression test.
- `scripts/verify_classic_refinements.mjs`: two rendered clients, connected third player, movement sampling, input tests and screenshots.
- `scripts/verify_classic_animation_cleanup.mjs`: reconnect-during-travel and other-mode control verification.
- `scripts/verify_classic_complete.mjs`: updated the existing acceptance test selector for the dedicated Draw Four acceptance control.

The earlier implementation changes remain in the working tree. The pre-existing untracked mobile refinement script was left untouched.

## Verification evidence

Full suite: **75 tests passed**, including Flip, No Mercy, persistence, multiplayer challenge synchronization and turn timers. Output: [refinement-tests.txt](scratch/refinement-tests.txt).

The targeted browser runner opens Alice and Bob in separate storage origins, then connects Cara over an authenticated WebSocket. It checks deck permissions, local UNO visibility, active profile-ring placement, authoritative travel geometry, successful catches, failed catches, expiry without an automatic penalty, direct tap, mouse/touch drag, Wild Draw Four responses, reduced motion and timer shutdown at round completion. Movement samples record actual rendered coordinates and animation durations. A Chrome screencast captures browser frames for visual review.

The visual fixtures suppress automatic timeout actions because screenshot encoding on this host can exceed a turn. They retain the normal server-issued 20-second deadlines and countdown rendering. Production timeout code is unchanged and remains covered by the server suite.

The targeted browser checks passed. Machine-readable evidence: [interaction results](scratch/classic-refinements/results.json) and [reconnect/Flip results](scratch/classic-refinements/cleanup-results.json).

Measured ordinary play: the card moved from approximately (573, 579) to (616, 482) between captured rendered frames, with a 300 ms animation. Draw travel moved from approximately (607, 382) to (656, 491), also with a 300 ms animation. These are intermediate samples, not the final destination positions. Both animations settled without ghosts left behind. Two catch penalty ghosts were observed on each rendered client.

A separate browser run interrupted a draw in flight and verified ghost removal, restored target visibility, the same session/hand after reconnect, and the exact drawn-card ID. It also switched from Classic to Flip and verified restoration of the original central draw control and common countdown.

Screenshots were captured and visually inspected at 360×800, 390×844, 412×915, 1366×768 and 1920×1080:

- [All-screen review](scratch/classic-refinements/screenshot-review.png)
- [Mobile](scratch/classic-refinements/390x844.png)
- [Desktop](scratch/classic-refinements/1366x768.png)
- [Play frame](scratch/classic-refinements/play-mid.png)
- [Draw frame](scratch/classic-refinements/draw-mid.png)
- [CAUGHT FAILED](scratch/classic-refinements/caught-failed.png)
- [Recorded interaction preview](scratch/classic-refinements/interaction-preview.gif)

The GIF contains 90 actual Chrome screencast frames, resized for review with uniform preview timing; its playback speed is approximate. Source frames remain under `scratch/classic-refinements/recording-*.jpg`.

## Limits

Chrome and touch emulation are used. Physical devices, pen hardware, other browser engines and low-end-device performance are not measured. The original card-face assets remain 85–87 × 125–129 pixels; their resolution limitation is unchanged. Screencast frame previews demonstrate card travel, rather than providing a calibrated performance benchmark.
