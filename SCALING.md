# Multiplayer capacity

The application currently runs authoritative rooms in one Node process. Do not
increase Render instance count yet: rooms and sockets are process-local, and
clients routed to different instances would not share a table.

This change indexes connections by room (including fallback deliveries and social
events), reuses SQLite prepared statements, limits incoming WebSocket frames to
64 KiB, and reconnects clients whose outbound backlog exceeds 1 MiB instead of
accumulating stale state without bound. Personalized hands remain per player.
Persistence remains synchronous and durable; no delayed-save crash window added.

## Reproduce the local load check

Run `npm run test:load` with Node 24+. Optionally set LOAD_ROOMS (default 100).
The script starts an isolated local server/database, connects four real WebSocket
clients per room, performs 40 ready changes and 20 gameplay actions per room,
and checks the responding player's state/version before timing completion.
Gameplay covers Classic draw/pass and opening colour selection, not every mode,
full-match completion, browser rendering, long sessions, or internet latency.

Observed on the development laptop: 100 rooms, 400 connections, 6,000 timed
updates, 4.92 seconds including setup; median 58.3 ms, p95 93.6 ms, p99 133.7 ms;
server+load-client combined memory 108.3 MiB. This burst check is not a production
capacity guarantee. All 217 regression tests passed.

## Production rollout

Deploy the commit, then test on production-equivalent staging with independent
load clients and realistic turn pacing for a sustained period. Measure latency,
CPU, memory, disconnects and event-loop delay across Classic, Flip and No Mercy.
Keep the service on one instance for this release. Upgrade the free service to
an appropriately sized paid instance before relying on higher concurrency;
choose its size from measured staging results. This commit does not change
billing or the existing free-plan configuration.

For horizontal scaling, implement room ownership/routing, a shared room/session
store and inter-instance messaging first. Simply adding workers or replicas
would break room consistency. Persistent SQLite also needs a durable disk or a
migration to shared durable storage; the current Render source directory is
not a durable database volume.

Render references:
- https://render.com/docs/scaling
- https://render.com/docs/websocket
- https://render.com/docs/free
