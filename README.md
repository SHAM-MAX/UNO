# 🎴 UNO Arena

> **UNO Arena** is a real-time online multiplayer card game supporting 2–6 players across three game modes: **Classic UNO**, **UNO Flip**, and **UNO Show ’em No Mercy**. Built with a server-authoritative rules engine, persistent room storage, WebSocket synchronization, accessible card graphics, and a built-in sound synthesizer.

---

## 🌟 Features & Game Modes

### 1. Classic UNO
- **Standard 108-Card Deck**: 4 colors (Red, Yellow, Green, Blue), numbers 0–9, Skip, Reverse, Draw Two, Wild, and Wild Draw Four.
- **Starting Hand**: 7 cards per player.
- **Turn Mechanics**: Match color, number, or symbol.
- **2-Player Reverse Rule**: In a 2-player game, **Reverse** acts as a **Skip** (the player immediately takes another turn).
- **Draw Behavior**: Draw one card from the draw pile; if playable, can play or pass.
- **UNO Call & Missed Penalty**: Players down to 1 card must call UNO. If an opponent catches a player who forgot to call UNO, that player receives a 2-card penalty!
- **Stacking**: Disabled by default in Classic (can be enabled via house rules).

### 2. UNO Flip
- **Real Double-Sided Cards (112 cards)**: Every card has a **Light Side** and a **Dark Side**.
- **Light Side**: Colors (Red, Yellow, Green, Blue), numbers 1–9, Draw One (+1), Skip, Reverse, Wild, Wild Draw Two (+2), and Flip cards.
- **Dark Side**: Colors (Teal, Orange, Pink, Purple), numbers 1–9, Draw Five (+5), Skip Everyone, Dark Reverse, Wild, Wild Draw Color, and Flip cards.
- **The Dimensional Flip**: Playing a **Flip** card instantly flips every player’s hand, the draw pile, and the discard pile to the other side! The new top card face dictates the active color and symbol.

### 3. UNO Show ’em No Mercy
- **Brutal 168-Card Deck**: Massive deck designed for extreme, cutthroat card play.
- **Draw Stacking (Always ON)**: When a player plays a draw card (+2, +4, +6, +10, Wild Reverse Draw 4), opponents can counter with an equal or higher draw card to pass the penalty along. The player who cannot counter must draw the **entire accumulated total**!
- **Draw Until Playable**: When drawing cards on your turn, you draw repeatedly from the draw pile until you find a legally playable card.
- **7 Hand-Swap**: Playing any 7 forces that player to swap their entire hand with another active player of their choice!
- **0 Hand-Pass**: Playing any 0 forces all active players to pass their hands in the current direction of play!
- **Discard All**: Discard all cards matching the color of the Discard All card at once!
- **25-Card Mercy Knockout**: If at any point a player accumulates 25 or more cards in their hand, they are immediately **eliminated (knocked out)** from the match!
- **Dual Win Conditions**: Empty your hand, OR be the last player standing after all opponents are eliminated by Mercy.

---

## 🎨 Design & Accessibility

- **Original Card Graphics**: Custom SVG cards featuring clear typography and high contrast.
- **Dual-Encoding Colorblind Accessibility**: Every color is paired with a distinct geometric symbol badge so color alone is never required:
  - **Red**: Diamond (`◆`)
  - **Yellow**: Star (`★`)
  - **Green**: Triangle (`▲`)
  - **Blue**: Circle (`●`)
  - **Teal**: Pentagon (`⬟`)
  - **Orange**: Sun (`☼`)
  - **Pink**: Cross (`✚`)
  - **Purple**: Moon (`☾`)
  - **Wild**: Sparkle (`✦`)
- **Sound Synthesizer**: Zero external audio asset dependencies! Pure Web Audio API generates crisp acoustic whooshes, draw slides, dimensional flip sounds, UNO brass fanfares, and knockout explosions. Includes instant mute/unmute toggle.
- **Responsive Layout**: Oval arena felt table designed to scale seamlessly across desktop displays, tablets, and mobile touchscreens.

---

## 🛡️ Architecture & Security

- **Server-Authoritative**: All card draws, plays, turn orders, and penalties are validated strictly on the server.
- **Zero Information Leakage**: The server **never** sends opponent hands to a client. Clients receive only their own private cards, along with public state (opponent card counts, discard pile, active color, turn indicators).
- **Room Storage**: SQLite with WAL stores rooms and sessions. This survives process restarts while the data directory survives. Render's Free service has ephemeral storage, so a spin-down or redeploy can clear rooms; use `render-persistent.yaml` and its disk for persistence across restarts.
- **Session Tokens**: Players store a unique session token in `localStorage` allowing automatic seat re-attachment if their socket disconnects.

---

## 🚀 Local Setup & Running

### Prerequisites
- [Node.js](https://nodejs.org/) v20.0.0 or higher (built and verified on Node.js v24).
- npm (v10+).

### Quick Start
```bash
# 1. Install dependencies
npm install

# 2. Run automated test suite
npm test

# 3. Start the server
npm start
```

Open your browser to `http://localhost:3001`!

### Playing a Multiplayer Game Locally
1. Open `http://localhost:3001` in your browser.
2. Enter your name and click **Create Room**.
3. Copy the room code or click **Copy Shareable Invite Link** (e.g. `http://localhost:3001/?room=ABC123`).
4. Open an incognito window or another browser tab and navigate to the invite link.
5. In both windows, click **I AM READY**, then click **START GAME** on the host screen.

---

## 🧪 Automated Testing

The project includes 22 automated test suites covering rules, deck compositions, and end-to-end WebSocket multiplayer flows:

```bash
npm test
```

### Test Coverage Breakdown:
1. **Deck Composition**:
   - Classic Deck (108 cards exact: 25 per color + 8 wilds).
   - Flip Deck (112 cards exact: 112 light faces + 112 dark faces).
   - No Mercy Deck (168 cards exact: 132 color cards + 36 wild/special actions).
2. **Classic Rules**:
   - Legal vs illegal move validation.
   - 2-Player Reverse edge case (acts as Skip).
   - Skip card mechanics.
   - Draw Two card mechanics.
   - UNO call & missed-UNO catch challenge window.
   - Empty hand win condition.
3. **UNO Flip Rules**:
   - Light to Dark side transitions.
   - Top discard pile face inversion and color change.
   - Dark side Draw 5 (+5 penalty).
   - Dark side Skip Everyone (player takes another turn).
4. **No Mercy Rules**:
   - Draw card stacking (+2 on +2, +4 on +2, penalty accumulation).
   - 7 Hand-Swap mechanics.
   - 0 Hand-Pass clockwise/counter-clockwise shifting.
   - Discard All card color purge.
   - 25-card Mercy Knockout and last-standing victory.
5. **Persistence**:
   - SQLite state persistence across server reboots.
   - Session token seat recovery.
6. **E2E WebSocket Multiplayer**:
   - Live 2-player sessions over WebSockets for Classic, Flip, and No Mercy modes.

---

## ☁️ Render Deployment Guide

A turnkey Render Blueprint is included in [`render.yaml`](./render.yaml).

### Render Free Tier & Pricing Breakdown
- **Render Web Service (Free Tier)**:
  - Cost: **\$0 / month**.
  - 512 MB RAM, 0.1 CPU, 750 free instance hours per month.
  - Automatic HTTPS & WebSocket support.
  - *Note*: Free instances spin down after 15 minutes of inactivity and do not support persistent disks. (On the free tier, rooms persist in SQLite during active games, but disk resets if the free container spins down after inactivity).
- **Persistent Storage Option**:
  - The separate [`render-persistent.yaml`](./render-persistent.yaml) Blueprint uses the **Starter Plan** with a 1 GB persistent disk. Select that file as the Blueprint path in Render.
  - Check Render's current pricing before creating paid resources. The default `render.yaml` stays on the Free plan and does not promise that rooms survive a spin-down or redeploy.

### Deployment Steps
1. Push this repository to GitHub or GitLab:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/uno-arena.git
   git branch -M main
   git push -u origin main
   ```
2. Log in to [Render Dashboard](https://dashboard.render.com).
3. Click **New +** -> **Blueprint**.
4. Connect your `uno-arena` repository.
5. Render will automatically detect [`render.yaml`](./render.yaml) and configure the service:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
6. Click **Apply** to deploy! Once deployed, Render will provide your public URL (e.g. `https://uno-arena.onrender.com`).

---

## 📋 API & Health Endpoints

- `GET /health` or `GET /api/health`: Returns server status, uptime, and active room count.
- `POST /api/rooms`: Creates a new room with host credentials.
- `POST /api/rooms/join`: Validates room code and joins as guest or resumes session.
- `GET /api/rooms/:roomId`: Returns public room metadata (mode, status, player count).
- `WS /ws`: Real-time WebSocket connection endpoint.

