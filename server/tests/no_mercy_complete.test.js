import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/roomManager.js';
import { createNoMercyDeck } from '../../shared/deck.js';
import { isCardPlayable, canStackCard, getNextPlayerIndex } from '../../shared/rules.js';
import { renderCardHTML, renderCardBackHTML } from '../../client/cardGraphics.js';
const card = (id, color = 'red', type = 'number', value = 3) => ({ id, color, type, ...(type === 'number' ? { value } : {}) });
function setup(n = 3) {
    const saved = new Map(); const store = { loadAllActiveRooms: () => [], saveRoom: (id, mode, state) => saved.set(id, structuredClone(state)), saveSession: () => { } };
    const rm = new RoomManager(store); const { roomId, playerId } = rm.createRoom('P0', 'no_mercy');
    for (let i = 1; i < n; i++)rm.joinRoom(roomId, `P${i}`);
    rm.startGame(roomId, playerId); const r = rm.getRoom(roomId), ids = r.players.map(p => p.id);
    Object.assign(r, { currentTurn: 0, direction: 1, pendingAction: null, pendingDrawPenalty: 0, turnDrawnCard: false, turnDrawnCardId: null, activeColor: 'red', topDiscard: card('top'), discardPile: [card('top')], mercyPile: [] });
    ids.forEach((id, i) => { r.playerHands[id] = [card(`h${i}`, 'blue', 'number', 8), card(`e${i}`, 'green', 'number', 9)]; r.players[i].cardCount = 2; });
    return { rm, r, ids, roomId, saved };
}
const conserve = r => { const cards = [...Object.values(r.playerHands).flat(), ...r.drawPile, ...r.discardPile, ...r.mercyPile]; assert.equal(cards.length, 168); assert.equal(new Set(cards.map(c => c.id)).size, 168); };
test('No Mercy exhaustive inventory and authentic asset mappings for all 168 identities', () => {
    const d = createNoMercyDeck(); assert.equal(d.length, 168); assert.equal(new Set(d.map(c => c.id)).size, 168);
    for (const color of ['red', 'yellow', 'green', 'blue']) {
        for (let value = 0; value < 10; value++)assert.equal(d.filter(c => c.color === color && c.type === 'number' && c.value === value).length, 2);
        for (const [type, count] of Object.entries({ skip: 3, reverse: 3, draw2: 3, discard_all: 3, draw4: 2, skip_everyone: 2 })) assert.equal(d.filter(c => c.color === color && c.type === type).length, count);
    }
    for (const [type, count] of Object.entries({ wild_reverse_draw4: 8, wild_color_roulette: 8, wild_draw6: 4, wild_draw10: 4 })) assert.equal(d.filter(c => c.type === type).length, count);
    assert.equal(d.filter(c => c.type === 'wild').length, 0);
    d.forEach(c => { const html = renderCardHTML(c, { mode: 'no_mercy' }); assert.match(html, /<img class="nm-card-image/); assert.match(html, /\/assets\/no-mercy-cards\//); assert.ok(html.includes(`data-face="${c.color}:${c.type}${c.type === 'number' ? ':' + c.value : ''}"`)); assert.doesNotMatch(html, /classic-cards/); });
    assert.match(renderCardBackHTML(false, false, 'no_mercy'), /No Mercy card back/);
});
for (const a of ['draw2', 'draw4', 'wild_reverse_draw4', 'wild_draw6', 'wild_draw10']) for (const b of ['draw2', 'draw4', 'wild_reverse_draw4', 'wild_draw6', 'wild_draw10']) test(`No Mercy stack ${a} then ${b} compares last value`, () => {
    const values = { draw2: 2, draw4: 4, wild_reverse_draw4: 4, wild_draw6: 6, wild_draw10: 10 };
    assert.equal(canStackCard(card('b', 'blue', b), 'no_mercy', 'light', 30, card('a', 'red', a)), values[b] >= values[a]);
});
test('No Mercy setup ignores every action and conserves all cards at 2/3/4/6 players', () => {
    for (const n of [2, 3, 4, 6]) for (let i = 0; i < 20; i++) { const { rm, r, ids, roomId } = setup(n); r.status = 'lobby'; rm.startGame(roomId, ids[0]); conserve(r); assert.equal(r.topDiscard.type, 'number'); assert.equal(r.pendingDrawPenalty, 0); assert.equal(r.currentTurn, (r.dealerIndex + 1) % n); ids.forEach(id => assert.equal(r.playerHands[id].length, 7)); }
});
for (const n of [2, 3, 4, 6]) for (const direction of [-1, 1]) test(`No Mercy 0 passes exact hands: ${n}, direction ${direction}`, () => {
    const { rm, r, ids, roomId } = setup(n); r.direction = direction; r.playerHands[ids[0]].unshift(card('zero', 'red', 'number', 0));
    const before = ids.map(id => r.playerHands[id].filter(c => c.id !== 'zero').map(c => c.id)); assert.ok(rm.playCard(roomId, ids[0], { cardId: 'zero' }).success);
    ids.forEach((id, i) => assert.deepEqual(r.playerHands[id].map(c => c.id), before[(i - direction + n) % n]));
});
test('No Mercy Discard All top and final win', () => {
    const { rm, r, ids, roomId } = setup(); r.playerHands[ids[0]] = [card('all', 'red', 'discard_all'), card('red')]; assert.ok(rm.playCard(roomId, ids[0], { cardId: 'all' }).success); assert.equal(r.discardPile.at(-1).id, 'all'); assert.equal(r.topDiscard.id, 'all'); assert.equal(r.winnerId, ids[0]);
});
test('No Mercy mandatory 7 final card resolves swap before winner', () => {
    const { rm, r, ids, roomId } = setup(); r.playerHands[ids[0]] = [card('seven', 'red', 'number', 7)]; assert.ok(!rm.playCard(roomId, ids[0], { cardId: 'seven', targetPlayerId: ids[0] }).success); assert.ok(rm.playCard(roomId, ids[0], { cardId: 'seven', targetPlayerId: ids[1] }).success); assert.equal(r.winnerId, ids[1]); assert.equal(r.playerHands[ids[0]].length, 2);
});
for (const type of ['reverse', 'skip_everyone', 'wild_reverse_draw4']) test(`No Mercy 2-player ${type} retains actor turn`, () => {
    const { rm, r, ids, roomId } = setup(2); r.playerHands[ids[0]].unshift(card('special', type.startsWith('wild') ? 'wild' : 'red', type)); assert.ok(rm.playCard(roomId, ids[0], { cardId: 'special', chosenColor: 'green' }).success); assert.equal(r.currentTurn, 0); if (type === 'wild_reverse_draw4') { assert.equal(r.pendingDrawPenalty, 4); assert.ok(rm.drawCard(roomId, ids[0]).success); assert.equal(r.currentTurn, 1); assert.equal(r.pendingDrawPenalty, 0); }
});
test('No Mercy two-player Reverse Draw Four may stack back to opponent', () => {
    const { rm, r, ids, roomId } = setup(2); r.playerHands[ids[0]].push(card('rev', 'wild', 'wild_reverse_draw4'), card('six', 'wild', 'wild_draw6')); rm.playCard(roomId, ids[0], { cardId: 'rev', chosenColor: 'red' }); assert.ok(rm.playCard(roomId, ids[0], { cardId: 'six', chosenColor: 'blue' }).success); assert.equal(r.currentTurn, 1); assert.equal(r.pendingDrawPenalty, 10);
});
test('No Mercy drawing enforces exact identity, rejects pass and repeat draw', () => {
    const { rm, r, ids, roomId } = setup(); r.drawPile = [card('unplayable', 'yellow', 'number', 2), card('drawn', 'red', 'number', 5)]; assert.ok(rm.drawCard(roomId, ids[0]).success); assert.equal(r.turnDrawnCardId, 'drawn'); assert.ok(!rm.passTurn(roomId, ids[0]).success); assert.ok(!rm.drawCard(roomId, ids[0]).success); assert.ok(!rm.playCard(roomId, ids[0], { cardId: 'h0' }).success); assert.ok(rm.playCard(roomId, ids[0], { cardId: 'drawn' }).success);
});
test('No Mercy cannot draw when matching card held', () => { const { rm, r, ids, roomId } = setup(); r.playerHands[ids[0]].push(card('match')); assert.ok(!rm.drawCard(roomId, ids[0]).success); });
for (const penalty of [false, true]) test(`No Mercy immediate knockout advances eliminated current turn; penalty=${penalty}`, () => {
    const { rm, r, ids, roomId } = setup(); r.playerHands[ids[0]] = Array.from({ length: 24 }, (_, i) => card('held' + i, 'blue', 'number', 8)); r.drawPile = [card('last', 'yellow', 'number', 4), card('rest')]; r.pendingDrawPenalty = penalty ? 10 : 0; const version = r.actionVersion; assert.ok(rm.drawCard(roomId, ids[0]).success); assert.ok(r.players[0].isEliminated); assert.equal(r.mercyPile.length, 25); assert.equal(r.playerHands[ids[0]].length, 0); assert.equal(r.currentTurn, 1); assert.equal(r.pendingDrawPenalty, 0); assert.ok(r.actionVersion > version); assert.equal(r.discardPile.at(-1).id, r.topDiscard.id);
});
test('No Mercy reserve only reenters exhausted draw pile; preserves top', () => {
    const { rm, r } = setup(); r.mercyPile = [card('reserve')]; r.drawPile = [card('draw')]; rm.reshuffleIfEmpty(r); assert.equal(r.mercyPile.length, 1); r.drawPile = []; rm.reshuffleIfEmpty(r); assert.equal(r.mercyPile.length, 0); assert.equal(r.drawPile[0].id, 'reserve'); assert.equal(r.discardPile.at(-1).id, r.topDiscard.id);
});
test('No Mercy Roulette target chooses; wild excluded; duplicate and wrong player rejected; persistence', () => {
    const { rm, r, ids, roomId, saved } = setup(); r.playerHands[ids[0]].push(card('roulette', 'wild', 'wild_color_roulette')); assert.ok(rm.playCard(roomId, ids[0], { cardId: 'roulette' }).success); assert.equal(r.pendingAction.targetPlayerId, ids[1]); assert.ok(!rm.chooseOpeningColor(roomId, ids[0], 'red').success); assert.ok(!rm.chooseOpeningColor(roomId, ids[1], 'purple').success); assert.ok(saved.get(roomId).pendingAction);
    r.drawPile = [card('wild', 'wild', 'wild_draw10'), card('blue', 'blue'), card('red')]; assert.ok(rm.chooseOpeningColor(roomId, ids[1], 'red').success); assert.equal(r.lastRoulette.revealed.length, 3); assert.equal(r.currentTurn, 2); assert.equal(r.pendingAction, null); assert.ok(!rm.chooseOpeningColor(roomId, ids[1], 'red').success);
});
test('No Mercy UNO window rejects self and repeated catches, closes on accepted next play', () => {
    const { rm, r, ids, roomId } = setup(); r.playerHands[ids[0]] = [card('play'), card('remain', 'blue')]; rm.playCard(roomId, ids[0], { cardId: 'play' }); assert.equal(r.unoChallengeWindow.targetPlayerId, ids[0]); assert.ok(!rm.catchUno(roomId, ids[0], ids[0]).success); assert.ok(rm.catchUno(roomId, ids[2], ids[0]).success); assert.ok(!rm.catchUno(roomId, ids[2], ids[0]).success);
    r.currentTurn = 0; r.playerHands[ids[0]] = [card('again'), card('one', 'blue')]; rm.playCard(roomId, ids[0], { cardId: 'again' }); r.playerHands[ids[1]].push(card('next')); rm.playCard(roomId, ids[1], { cardId: 'next' }); assert.ok(!rm.catchUno(roomId, ids[2], ids[0]).success);
});
test('No Mercy next active seat after elimination respects both directions', () => { for (const direction of [-1, 1]) assert.equal(getNextPlayerIndex(2, direction, [{}, { isEliminated: true }, { isEliminated: true }, {}, {}]), direction === 1 ? 3 : 0); });
for (const n of [2, 3, 4, 6]) test(`No Mercy full games conserve 168 identities after every action: ${n} players`, () => {
    for (let match = 0; match < 5; match++) {
        const { rm, r, ids, roomId } = setup(n); r.status = 'lobby'; rm.startGame(roomId, ids[0]); let actions = 0;
        while (r.status === 'playing' && actions++ < 5000) { const id = r.players[r.currentTurn].id; if (r.pendingAction) { assert.ok(rm.chooseOpeningColor(roomId, id, 'red').success); } else { const hand = r.playerHands[id]; const playable = hand.filter(c => (!r.turnDrawnCard || r.turnDrawnCardId === c.id) && isCardPlayable(c, r.topDiscard, r.activeColor, r.mode, r.flipSide, r.pendingDrawPenalty, r.houseRules)); const c = playable[Math.floor(Math.random() * playable.length)]; const res = c ? rm.playCard(roomId, id, { cardId: c.id, chosenColor: 'red', targetPlayerId: ids.find(other => other !== id && !r.players.find(p => p.id === other).isEliminated) }) : rm.drawCard(roomId, id); assert.ok(res.success, res.error); } conserve(r); if (r.status === 'playing') assert.ok(!r.players[r.currentTurn].isEliminated); }
        assert.equal(r.status, 'game_over'); assert.ok(r.winnerId);
    }
});
test('No Mercy matching accepts colour, number, symbol and wild; coloured Draw Four retains colour', () => {
    const top = card('top', 'red', 'number', 3);
    assert.ok(isCardPlayable(card('red'), top, 'red', 'no_mercy'));
    assert.ok(isCardPlayable(card('three', 'blue', 'number', 3), top, 'red', 'no_mercy'));
    assert.ok(!isCardPlayable(card('four', 'blue', 'draw4'), top, 'red', 'no_mercy'));
    assert.ok(isCardPlayable(card('four', 'blue', 'draw4'), card('top', 'red', 'draw4'), 'red', 'no_mercy'));
    assert.ok(isCardPlayable(card('wild', 'wild', 'wild_draw6'), top, 'red', 'no_mercy'));
});
test('No Mercy skipped eliminated players are excluded from 0 transfer', () => {
    const { rm, r, ids, roomId } = setup(4); r.players[1].isEliminated = true; r.mercyPile = r.playerHands[ids[1]]; r.playerHands[ids[1]] = []; r.playerHands[ids[0]].unshift(card('zero', 'red', 'number', 0)); const held = r.playerHands[ids[0]].slice(1); rm.playCard(roomId, ids[0], { cardId: 'zero' }); assert.deepEqual(r.playerHands[ids[2]], held); assert.deepEqual(r.playerHands[ids[1]], []); assert.equal(r.currentTurn, 2);
});
test('No Mercy hand-transfer recipients can declare UNO or be caught independently', () => {
    const { rm, r, ids, roomId } = setup(); r.playerHands[ids[0]] = [card('seven', 'red', 'number', 7), card('last', 'blue')]; rm.playCard(roomId, ids[0], { cardId: 'seven', targetPlayerId: ids[1] }); assert.ok(rm.getClientView(roomId, ids[1]).canCallUno); assert.equal(rm.getClientView(roomId, ids[2]).canCatchUno, ids[1]); assert.ok(rm.callUno(roomId, ids[1]).success); assert.ok(!rm.catchUno(roomId, ids[2], ids[1]).success);
});
test('No Mercy final two-player Reverse Draw Four makes actor take own penalty before victory', () => {
    const { rm, r, ids, roomId } = setup(2); r.playerHands[ids[0]] = [card('reverse', 'wild', 'wild_reverse_draw4')]; rm.playCard(roomId, ids[0], { cardId: 'reverse', chosenColor: 'red' }); assert.equal(r.status, 'playing'); assert.equal(r.currentTurn, 0); rm.drawCard(roomId, ids[0]); assert.equal(r.playerHands[ids[0]].length, 4); assert.equal(r.status, 'playing');
});
test('No Mercy pending Roulette and reserve survive server rehydration without exposing hidden cards', () => {
    const { rm, r, ids, roomId, saved } = setup(); r.mercyPile = [card('hidden-reserve')]; r.playerHands[ids[0]].push(card('roulette', 'wild', 'wild_color_roulette')); rm.playCard(roomId, ids[0], { cardId: 'roulette' });
    const restored = new RoomManager({ loadAllActiveRooms: () => [{ roomId, state: saved.get(roomId) }], saveRoom: () => { } }); assert.equal(restored.getRoom(roomId).mercyPile[0].id, 'hidden-reserve'); assert.ok(!JSON.stringify(restored.getClientView(roomId, ids[2])).includes('hidden-reserve')); assert.equal(restored.getClientView(roomId, ids[1]).gameState.pendingAction.targetPlayerId, ids[1]); assert.ok(restored.chooseOpeningColor(roomId, ids[1], 'blue').success);
});
test('No Mercy standard threshold is 25; 35 and 45 remain explicit house rules', () => {
    for (const limit of [25, 35, 45]) { const { rm, r, ids } = setup(); r.houseRules.mercyKnockoutLimit = limit; r.playerHands[ids[0]] = Array.from({ length: limit - 1 }, (_, i) => card('held' + i)); assert.ok(!rm.checkKnockout(r, r.players[0])); r.playerHands[ids[0]].push(card('threshold')); assert.ok(rm.checkKnockout(r, r.players[0])); }
});
test('No Mercy Roulette victim choice closes prior UNO catch window', () => {
    const { rm, r, ids, roomId } = setup(); r.playerHands[ids[0]] = [card('roulette', 'wild', 'wild_color_roulette'), card('one', 'blue')]; rm.playCard(roomId, ids[0], { cardId: 'roulette' }); assert.equal(rm.getClientView(roomId, ids[2]).canCatchUno, ids[0]); rm.chooseOpeningColor(roomId, ids[1], 'red'); assert.equal(rm.getClientView(roomId, ids[2]).canCatchUno, null); assert.ok(!rm.catchUno(roomId, ids[2], ids[0]).success);
});
test('No Mercy final Roulette waits for required victim choice before announcing winner', () => {
    const { rm, r, ids, roomId } = setup(); r.playerHands[ids[0]] = [card('roulette', 'wild', 'wild_color_roulette')]; rm.playCard(roomId, ids[0], { cardId: 'roulette', chosenColor: 'purple' }); assert.equal(r.activeColor, null); assert.equal(r.winnerId, null); assert.equal(r.winReason, null); assert.equal(r.status, 'playing'); rm.chooseOpeningColor(roomId, ids[1], 'red'); assert.equal(r.status, 'game_over'); assert.equal(r.winnerId, ids[0]);
});
test('No Mercy authentic card artwork maps exact files for numbers, actions, and wilds', () => {
    for (const color of ['red', 'yellow', 'green', 'blue']) for (let value = 0; value < 10; value++) {
        const html = renderCardHTML(card('number', color, 'number', value), { mode: 'no_mercy' });
        assert.match(html, new RegExp(`/assets/no-mercy-cards/${color}_${value}\\.webp`));
    }
    for (const [type, file] of Object.entries({ draw2: 'draw2', draw4: 'draw4', discard_all: 'discard_all', skip: 'skip', skip_everyone: 'skip_all', reverse: 'reverse' })) {
        const html = renderCardHTML(card('action', 'blue', type), { mode: 'no_mercy' });
        assert.match(html, new RegExp(`/assets/no-mercy-cards/blue_${file}\\.webp`));
    }
    assert.match(renderCardHTML(card('w4', 'wild', 'wild_reverse_draw4'), { mode: 'no_mercy' }), /\/assets\/no-mercy-cards\/wild_draw4\.webp/);
    assert.match(renderCardHTML(card('w6', 'wild', 'wild_draw6'), { mode: 'no_mercy' }), /\/assets\/no-mercy-cards\/wild_draw6\.webp/);
    assert.match(renderCardHTML(card('w10', 'wild', 'wild_draw10'), { mode: 'no_mercy' }), /\/assets\/no-mercy-cards\/wild_draw10\.webp/);
    assert.match(renderCardHTML(card('wr', 'wild', 'wild_color_roulette'), { mode: 'no_mercy' }), /\/assets\/no-mercy-cards\/wild_roulette\.webp/);
});
