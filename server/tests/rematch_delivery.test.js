import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'uno-rematch-delivery-'));

const { server, wss, roomManager: rm } = await import('../src/index.js');

function peer(port) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const q = [];
  const listeners = [];

  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    const i = listeners.findIndex((l) => l.p(m));
    if (i < 0) {
      q.push(m);
    } else {
      const l = listeners.splice(i, 1)[0];
      clearTimeout(l.timer);
      l.r(m);
    }
  });

  return {
    ws,
    open: new Promise((r, j) => {
      ws.once('open', r);
      ws.once('error', j);
    }),
    send: (m) => ws.send(JSON.stringify(m)),
    next(p, timeout = 5000) {
      const i = q.findIndex(p);
      if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]);
      return new Promise((r, j) =>
        listeners.push({
          p,
          r,
          timer: setTimeout(() => j(new Error('Rematch synchronization timeout')), timeout),
        })
      );
    },
  };
}

test('Rematch Notification Delivery: All original participants receive immediate notification with consistent status', async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const clients = [peer(port), peer(port), peer(port)];
  const otherClient = peer(port);

  try {
    await Promise.all([...clients, otherClient].map((c) => c.open));

    // Host creates room
    clients[0].send({ type: 'create', playerName: 'Alice', data: { mode: 'classic' } });
    const host = (await clients[0].next((m) => m.type === 'joined')).data;

    // Player 2 and 3 join
    for (let i = 1; i < 3; i++) {
      clients[i].send({ type: 'join', roomId: host.roomId, playerName: i === 1 ? 'Sham' : 'Charlie' });
    }
    const joined = [host, ...(await Promise.all(clients.slice(1).map((c) => c.next((m) => m.type === 'joined').then((m) => m.data))))];
    const ids = joined.map((p) => p.playerId);

    // Other client creates an unrelated room (Room 2)
    otherClient.send({ type: 'create', playerName: 'Dave', data: { mode: 'classic' } });
    const hostOther = (await otherClient.next((m) => m.type === 'joined')).data;

    // Start game in Room 1 and finish it with Alice as winner
    const room = rm.getRoom(host.roomId);
    rm.startGame(host.roomId, ids[0]);
    room.status = 'game_over';
    room.winnerId = ids[0];
    room.winReason = 'Alice emptied hand';
    rm.resetTurnTimer(room);

    // Drain previous state messages
    await Promise.all(clients.map((c) => c.next((m) => m.type === 'room:state')));

    // Alice requests rematch
    clients[0].send({ type: 'rematch_propose', data: { matchId: room.matchId } });

    // 1. All original participants receive the notification immediately via room:state
    const requests = await Promise.all(
      clients.map((c) => c.next((m) => m.type === 'room:state' && m.data.rematchProposal?.status === 'responding'))
    );
    const [p0, p1, p2] = requests.map((r) => r.data.rematchProposal);

    // 2. Proposal ID is identical across all recipients
    assert.equal(p0.id, p1.id);
    assert.equal(p1.id, p2.id);

    // 3. Creator automatically marked accepted, not pending
    assert.deepEqual(p0.acceptedPlayerIds, [ids[0]]);
    assert.ok(!p0.pendingPlayerIds.includes(ids[0]));
    assert.equal(p0.pendingPlayerIds.length, 2);

    // 4. Status consistency across participants
    for (const p of [p0, p1, p2]) {
      const alice = p.participants.find((x) => x.id === ids[0]);
      const sham = p.participants.find((x) => x.id === ids[1]);
      const charlie = p.participants.find((x) => x.id === ids[2]);

      assert.equal(alice.status, 'accepted');
      assert.equal(sham.status, 'pending');
      assert.equal(charlie.status, 'pending');
    }

    // 5. Sham accepts
    clients[1].send({ type: 'rematch_respond', data: { proposalId: p0.id, accept: true } });

    const acceptedUpdates = await Promise.all(
      clients.map((c) => c.next((m) => m.type === 'room:state' && m.data.rematchProposal?.acceptedPlayerIds.length === 2))
    );

    for (const update of acceptedUpdates) {
      const p = update.data.rematchProposal;
      const alice = p.participants.find((x) => x.id === ids[0]);
      const sham = p.participants.find((x) => x.id === ids[1]);
      const charlie = p.participants.find((x) => x.id === ids[2]);

      assert.equal(alice.status, 'accepted');
      assert.equal(sham.status, 'accepted');
      assert.equal(charlie.status, 'pending');
    }

    // 6. Mode voting
    clients[1].send({ type: 'rematch_vote', data: { proposalId: p0.id, mode: 'flip' } });
    clients[0].send({ type: 'rematch_vote', data: { proposalId: p0.id, mode: 'classic' } });

    const voteUpdate = await clients[2].next(
      (m) => m.type === 'room:state' && Object.keys(m.data.rematchProposal?.modeVotes || {}).length === 2
    );
    assert.equal(voteUpdate.data.rematchProposal.modeVotes[ids[1]], 'flip');
    assert.equal(voteUpdate.data.rematchProposal.modeVotes[ids[0]], 'classic');

    // 7. Verify no proposal leaked to other room
    const otherView = rm.getClientView(hostOther.roomId, hostOther.playerId);
    assert.equal(otherView.rematchProposal, null);

  } finally {
    clients.forEach((c) => c.ws.terminate());
    otherClient.ws.terminate();
    wss.clients.forEach((ws) => ws.terminate());
    for (const timer of rm.rematchTimers.values()) clearTimeout(timer);
    await new Promise((r) => server.close(r));
  }
});
