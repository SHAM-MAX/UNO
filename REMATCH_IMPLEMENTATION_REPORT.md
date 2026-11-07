# Multiplayer rematch implementation review

7 November 2026. Implemented and verified locally. No commit, push or deployment was performed for this feature.

## Delivered flow

The winner of a completed match can request a rematch. Requesting creates a persisted proposal and broadcasts it to every original participant, including eliminated No Mercy players. The initiator is accepted automatically but must choose a mode or receive the default preference at voting expiry.

Receiving players can accept, decline, or close the dialog. Closing a pending invitation records a decline. Closing after accepting withdraws the acceptance and removes the player's vote; the dialog closes after server confirmation. The initiator's close button cancels the proposal for everybody. A cancelled proposal leaves the completed winner announcement and final scores intact.

Accepted players vote using the existing Classic, Flip and No Mercy artwork. Votes can change while voting remains open. The server selects the highest vote total. Ties prefer the initiator's choice, then the previous mode, then Classic/Flip/No Mercy in that order. Uncast votes default to the previous mode, subject to its existing player capacity.

Response and voting durations are shared constants, each **30 seconds**. A proposal moves to voting once all original participants respond, or when the response deadline expires. Disconnected pending participants retain their invitation until that deadline. A two-second results phase announces the selected mode before the server starts the new match. Fewer than two acceptances cancels the proposal.

Classic round completion is deliberately separate: the existing host-only **Next round** action continues the current Classic match and preserves cumulative scores. Rematch proposals apply to the completed match.

## Server and session handling

- Proposal state includes its ID/version, initiator, original participant IDs/names, accepted/declined/pending lists, votes, timestamps, deadlines, previous results, status and selected mode.
- Responses and votes validate authenticated membership, acceptance, proposal identity, phase and deadlines. Duplicate responses and unauthorized cancellation are rejected.
- Bounded action receipts prevent replayed requests. A match ID prevents an old proposal request from applying after a later match finishes.
- Proposal state and deadline scheduling recover from persistence. A disconnected initiator does not automatically cancel the proposal.
- The next active roster contains accepted identities only. Declined identities retain their session tokens in a separate spectator collection, receive no private hand, and can reconnect without being added to the new game.
- Fresh games use the existing RoomManager deck/dealing implementation. Scores, penalties, direction, hands, piles, UNO challenges, drawn-card state and old action receipts are reset. A connected accepted host is preferred, with a valid accepted fallback if everyone is offline.
- Timer generations prevent a queued callback from the previous match acting in a newly selected mode.
- Existing `room:state` messages carry proposal updates and the new game. Added authenticated actions are `rematch_propose`, `rematch_respond`, `rematch_vote` and `rematch_cancel`.

Existing mode capacities are preserved: Classic supports ten players; Flip and No Mercy support six. If more than six accept, those two vote options are disabled and the server rejects them. An earlier vote for an incompatible mode is invalidated when a seventh player accepts. A ten-player original match can still choose Flip or No Mercy when no more than six accept.

No card assets, card rendering, draw/play animations, landing/setup screens, gameplay layouts or mode rules were redesigned.

## Modified files

- `shared/constants.js`: response, voting and result delays.
- `server/src/roomManager.js`: proposal lifecycle, voting, persistence, spectator sessions, roster initialization and timer generation.
- `server/src/index.js`: authenticated rematch actions, replay receipts and state broadcasting to retained sessions.
- `client/app.js`: winner request, invitation/vote/status UI, close semantics, reconnect presentation and synchronized start.
- `client/index.html`: accessible rematch dialog shell.
- `client/arena.css`: styles isolated to the new dialog.
- `server/tests/rematch.test.js`: lifecycle, voting, expiry, persistence, fresh-mode and roster tests.
- `server/tests/rematch_multiplayer.test.js`: real authenticated WebSocket synchronization, privacy, reconnection and replay tests.
- `scripts/verify_rematch.mjs`: three-browser interaction and responsive verification.

The pre-existing untracked `scripts/verify_mobile_refinement.mjs` is unchanged.

## Verification

**102 automated tests pass**, including all existing Classic, Flip and No Mercy regression checks. [Full test output](scratch/rematch-tests.txt).

The new tests cover every mode majority and tie-break, default preferences, vote changes, duplicate/expired/unauthorized requests, persistence, initiator disconnect, cancelled/withdrawn invitations, unique ten-player rosters, capacity constraints, host reassignment, fresh scoring/decks and stale timer/action prevention. Real WebSocket integration also checks eliminated players, reconnecting participants, declined-session privacy and replay protection.

Three independent Chrome sessions connected through real WebSockets were tested at desktop and mobile sizes:

1. Winner votes Flip, Bob votes Classic, Cara votes Flip. The real 30-second server voting timer selects Flip, announces the result, and starts the same new game on all accepted clients.
2. One player declines and remains connected outside the active roster.
3. Both receiving players close their invitation; no second acceptance cancels the proposal.
4. Initiator closes; all three clients receive cancellation.
5. A disconnected participant reconnects using the original session, receives the pending invitation and accepts.
6. An accepted participant closes; their acceptance/vote is withdrawn, their dialog closes on confirmation and they are excluded from the next active roster.

The first voting scenario uses real production deadlines and automatic scheduling. Later roster scenarios use controlled server advancement to avoid waiting through repeated 30-second windows. Match completion is established by test fixtures; this suite tests rematching rather than replaying full matches.

[Browser results](scratch/rematch-verification/results.json) · [Accepted-close results](scratch/rematch-verification/close-results.json)

Screenshots were captured at **360×800, 390×844, 412×915, 1366×768 and 1920×1080**, checked for horizontal overflow and visually inspected:

- [Screenshot overview](scratch/rematch-verification/review.png)
- [Winner's proposal](scratch/rematch-verification/winner-proposal.png)
- [Desktop invitation](scratch/rematch-verification/invitation-desktop.png)
- [Mobile invitation](scratch/rematch-verification/invitation-mobile.png)
- [Voting](scratch/rematch-verification/mode-voting.png)
- [Accepted/declined statuses](scratch/rematch-verification/accepted-declined.png)
- [Selected mode](scratch/rematch-verification/vote-result.png)
- [Cancelled proposal](scratch/rematch-verification/cancelled-proposal.png)
- [Accepted player withdraws](scratch/rematch-verification/accepted-player-withdrawal.png)
- [New game](scratch/rematch-verification/new-game.png)

## Local preview and limits

The local preview has been refreshed at **http://localhost:3001**. HTTP health, updated frontend markup and authenticated WebSocket rematch handling were checked. The server remains running for manual testing.

Browser verification uses Chrome and mobile emulation, not physical phones or other engines. No production deployment was attempted. Spectators retain sessions and the completed-match result; they do not automatically re-enter later matches. The existing six-player limits for Flip/No Mercy are enforced rather than changing their rules or layouts. Test screenshots and databases remain under ignored `scratch/` paths.
