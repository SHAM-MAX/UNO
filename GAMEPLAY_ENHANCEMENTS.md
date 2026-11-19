# Gameplay enhancements and verification

- Turn status names the active player; the local player's last five seconds pulse gently. Classic and other mode countdown rings stay synchronized.
- Connection loss locks move controls across all three modes, clears stale queued actions, shows reconnect status, and retries with bounded backoff. A restored room state unlocks play; online events retry promptly using the same session.
- Mobile touch selects and lifts a playable card on the first tap. A second tap plays it or opens its color/target chooser. Desktop mouse and keyboard retain direct activation. Selection clears when it becomes invalid.
- Short synthesized draw-power, Reverse, Skip, Flip, Wild, and swap sounds obey mute and volume settings. New users start at 65% volume; an existing saved zero stays muted.
- Results show the winner, remaining hands/scores, and No Mercy knockout order. Knockout order is recorded by the server, persisted, and reset at the next game. Existing rematch voting remains available. Results fit the viewport, including ten-player lists.
- Roulette's two-second receipt-before-victory ordering is preserved. Ordinary power-card text popups remain suppressed.

## Verification

- 234 server tests passed, including knockout-order sharing/reset.
- Browser checks passed for same-room reconnect and blocked disconnected moves in Classic, Flip, and No Mercy; mobile two-tap selection; urgent turn status; mute/volume; ten-player result layouts at 1440x900, 390x844, and 844x390.
- Browser Back/Forward and roulette-before-victory regressions passed.
- 35-card mobile hand rendering measured approximately 23-28 ms locally.

## Local WebSocket load measurements

All runs used isolated temporary databases and real WebSocket clients on the development machine. The script performs ready changes and legal game actions. These are local measurements, not hosting or mobile-network latency guarantees.

| Mode | Rooms | Players/room | Connections | Starting hand | Updates | p95 latency | Event-loop p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Classic | 20 | 10 | 200 | 10 | 2400 | 26 ms | 33 ms |
| Flip | 30 | 6 | 180 | 10 | 2400 | 48 ms | 49 ms |
| No Mercy | 30 | 6 | 180 | 10 | 2400 | 48 ms | 61 ms |

The load script accepts LOAD_ROOMS, LOAD_PLAYERS, LOAD_HAND_SIZE, and LOAD_MODE. Classic supports ten players; Flip and No Mercy retain their six-player limit.
