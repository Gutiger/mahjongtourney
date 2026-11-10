const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Enable JSON and form parsing
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- Trophy winners ---
// Set WINNERS to a JSON array of {name, date, tournament} objects.
const DEFAULT_WINNERS = [
  { name: 'Richard 🀀🀀🀃🀃🀃🀄︎🀄︎🀄︎🀅🀅🀅🀆🀆🀆', date: 'December 21, 2024', tournament: 'Jonging It' },
  { name: 'Julian', date: 'March 15, 2025', tournament: 'Jonging It' },
  { name: 'Matt/Skye', date: 'May 18, 2025', tournament: 'Jonging It' },
  { name: 'Evan 🀄︎🀄︎🀄︎🀅🀅🀅🀆🀆🀆', date: 'August 16, 2025', tournament: 'Jonging It' },
  { name: 'Dai', date: 'December 22, 2025', tournament: 'Jonging It' },
  { name: 'Satoshi 🀀🀁🀂🀃🀄︎🀅🀆', date: 'February 21, 2026', tournament: 'Jonging It' },
  { name: 'Elliot', date: 'May 16, 2026', tournament: 'Jonging It' },
  { name: 'Victor', date: 'September 6, 2026', tournament: 'Jonging It' },
];

function loadWinners() {
  if (!process.env.WINNERS) {
    console.log('WINNERS not set; using default winners list');
    return DEFAULT_WINNERS;
  }
  try {
    const parsed = JSON.parse(process.env.WINNERS);
    if (!Array.isArray(parsed)) throw new Error('WINNERS must be a JSON array');
    console.log(`Loaded ${parsed.length} winners from WINNERS env var`);
    return parsed;
  } catch (e) {
    console.error('Failed to parse WINNERS env var:', e.message);
    return [];
  }
}

const winners = loadWinners();

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTrophyPage() {
  const cards = winners.map((w, i) => `
    <div class="winner-card">
      <div class="winner-rank">#${i + 1}</div>
      <div class="tournament-name">${escapeHtml(w.tournament)}</div>
      <div class="winner-name">${escapeHtml(w.name)}</div>
      <div class="tournament-date">${escapeHtml(w.date)}</div>
    </div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mahjong Hall of Fame</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Georgia', serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #f1f1f1; min-height: 100vh; padding: 20px; position: relative; overflow-x: hidden; }
        .tile-background { position: fixed; top: 0; left: 0; width: 100%; height: 100%; overflow: hidden; z-index: 0; pointer-events: none; }
        .floating-tile { position: absolute; font-size: 3em; opacity: 0.3; animation: float-down linear infinite; }
        @keyframes float-down { 0% { transform: translateY(-100px) rotate(0deg); } 100% { transform: translateY(calc(100vh + 100px)) rotate(360deg); } }
        .container { max-width: 1200px; margin: 0 auto; position: relative; z-index: 1; }
        header { text-align: center; padding: 40px 20px; margin-bottom: 40px; border-bottom: 3px solid #d4af37; }
        h1 { font-size: 3.5em; color: #d4af37; text-shadow: 2px 2px 4px rgba(0,0,0,0.5); margin-bottom: 10px; letter-spacing: 2px; }
        .subtitle { font-size: 1.3em; color: #e8e8e8; font-style: italic; margin-top: 10px; }
        .trophy-icon { font-size: 4em; margin-bottom: 20px; }
        .winners-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 30px; padding: 20px; }
        .winner-card { background: linear-gradient(145deg, #2d3561 0%, #1f2544 100%); border-radius: 15px; padding: 30px; box-shadow: 0 8px 20px rgba(0,0,0,0.4); border: 2px solid #3d4a7a; transition: transform 0.3s ease, box-shadow 0.3s ease; position: relative; overflow: hidden; }
        .winner-card::before { content: ''; position: absolute; top: -50%; right: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(212,175,55,0.1) 0%, transparent 70%); opacity: 0; transition: opacity 0.3s ease; }
        .winner-card:hover { transform: translateY(-5px); box-shadow: 0 12px 30px rgba(212,175,55,0.3); border-color: #d4af37; }
        .winner-card:hover::before { opacity: 1; }
        .winner-rank { position: absolute; top: 15px; right: 15px; background: #d4af37; color: #1a1a2e; width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.2em; box-shadow: 0 4px 10px rgba(212,175,55,0.4); }
        .tournament-name { font-size: 1.5em; color: #d4af37; margin-bottom: 15px; font-weight: bold; }
        .winner-name { font-size: 1.8em; color: #ffffff; margin-bottom: 10px; font-weight: bold; }
        .tournament-date { color: #b0b0b0; font-size: 1.1em; margin-bottom: 15px; font-style: italic; }
        footer { text-align: center; margin-top: 60px; padding: 30px; color: #888; border-top: 2px solid #3d4a7a; }
        @media (max-width: 768px) { h1 { font-size: 2.5em; } .winners-grid { grid-template-columns: 1fr; } .winner-card { padding: 20px; } }
    </style>
</head>
<body>
    <div class="tile-background">
        <div class="floating-tile" style="left:5%;animation-duration:15s;animation-delay:0s">🀀</div>
        <div class="floating-tile" style="left:15%;animation-duration:20s;animation-delay:2s">🀁</div>
        <div class="floating-tile" style="left:25%;animation-duration:18s;animation-delay:4s">🀂</div>
        <div class="floating-tile" style="left:35%;animation-duration:22s;animation-delay:1s">🀃</div>
        <div class="floating-tile" style="left:45%;animation-duration:16s;animation-delay:3s">🀄︎</div>
        <div class="floating-tile" style="left:55%;animation-duration:19s;animation-delay:5s">🀅</div>
        <div class="floating-tile" style="left:65%;animation-duration:17s;animation-delay:2s">🀆</div>
        <div class="floating-tile" style="left:75%;animation-duration:21s;animation-delay:0s">🀇</div>
        <div class="floating-tile" style="left:85%;animation-duration:23s;animation-delay:3s">🀈</div>
        <div class="floating-tile" style="left:95%;animation-duration:15s;animation-delay:6s">🀉</div>
    </div>
    <div class="container">
        <header>
            <div class="trophy-icon">🏆</div>
            <h1>Jonging It Tournament Winners</h1>
            <p class="subtitle">Those who have caused the greatest damage without a single benefit</p>
        </header>
        <div class="winners-grid">
            ${cards}
        </div>
        <footer><p>🀄 I think we should play Mahjong 🀄</p></footer>
    </div>
</body>
</html>`;
}

loadWinners();

// Serve trophy page at /trophy
app.get('/trophy', (req, res) => {
  res.send(renderTrophyPage());
});

// Serve static files (after explicit routes so /trophy isn't intercepted by trophy/index.html)
app.use(express.static(path.join(__dirname)));

// Serve timer page at /timer
app.get('/timer', (req, res) => {
  res.sendFile(path.join(__dirname, 'timer', 'index.html'));
});

// Store tournaments by hash
const tournaments = new Map();

// API endpoint to create tournament
app.post('/api/tournament', (req, res) => {
  const { hash, config } = req.body;

  if (!hash || !config) {
    return res.status(400).json({ error: 'Hash and config required' });
  }

  if (tournaments.has(hash)) {
    return res.status(409).json({ error: 'Tournament ID already exists' });
  }

  // Generate default player names based on number of players
  const groups = config.groups || 3;
  const ofSize = config.ofSize || 4;
  const numPlayers = groups * ofSize;
  const defaultPlayerNames = Array.from({ length: numPlayers }, (_, i) => `Player ${i + 1}`);

  // Create new tournament state
  tournaments.set(hash, {
    config: {
      groups: groups,
      ofSize: ofSize,
      forRounds: config.forRounds || 3,
      timerMinutes: config.timerMinutes || 60,
      playerNames: defaultPlayerNames,
      forbiddenPairs: [],
      discouragedGroups: [],
    },
    lastResults: null,
    textFieldRefs: {},
    chomboRefs: {},
    oka: null,
    uma1: null,
    uma2: null,
    uma3: null,
    uma4: null,
    startingPoints: null,
    chomboValue: null,
    lastUpdated: Date.now(),
    version: 0,
    isEmpty: true,
    locked: true, // Config is locked after creation
    clients: new Set(),
    timers: new Map() // Store timer states by timerId
  });

  console.log(`Created tournament: ${hash}`);
  res.json({ success: true, hash });
});

// API endpoint to get tournament
app.get('/api/tournament/:hash', (req, res) => {
  const { hash } = req.params;
  const tournament = tournaments.get(hash);

  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  const { clients, ...tournamentData } = tournament;
  res.json(tournamentData);
});

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.tournamentHash = null; // Will be set when client joins a tournament

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleClientMessage(ws, data);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  ws.on('close', () => {
    if (ws.tournamentHash) {
      const tournament = tournaments.get(ws.tournamentHash);
      if (tournament) {
        tournament.clients.delete(ws);

        // Clean up from timer if subscribed
        if (ws.timerId && tournament.timers.has(ws.timerId)) {
          const timer = tournament.timers.get(ws.timerId);
          timer.clients.delete(ws);
          console.log(`Client left timer ${ws.timerId}`);
        }

        console.log(`Client left tournament ${ws.tournamentHash}. Remaining: ${tournament.clients.size}`);
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    if (ws.tournamentHash) {
      const tournament = tournaments.get(ws.tournamentHash);
      if (tournament) {
        tournament.clients.delete(ws);
      }
    }
  });
});

// Helper function to get or create a timer lazily
function getOrCreateTimer(tournament, timerId) {
  if (!tournament.timers.has(timerId)) {
    tournament.timers.set(timerId, {
      timerId,
      isRunning: false,
      startTime: 0,
      duration: 0,
      endTime: 0,
      pausedTime: 0,
      clients: new Set()
    });
    console.log(`Created timer: ${timerId}`);
  }
  return tournament.timers.get(timerId);
}

// Broadcast timer updates to all clients subscribed to that timer
function broadcastToTimer(timer, type, payload) {
  const message = JSON.stringify({
    type,
    payload: { ...payload, timerId: timer.timerId },
    timestamp: Date.now()
  });

  timer.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Handle incoming messages from clients
function handleClientMessage(ws, data) {
  const { type, payload } = data;

  // Handle JOIN_TOURNAMENT first
  if (type === 'JOIN_TOURNAMENT') {
    const { hash } = payload;
    const tournament = tournaments.get(hash);

    if (!tournament) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        error: 'Tournament not found'
      }));
      return;
    }

    ws.tournamentHash = hash;
    tournament.clients.add(ws);
    console.log(`Client joined tournament ${hash}. Total clients: ${tournament.clients.size}`);

    // Send full state to newly connected client
    const { clients, ...state } = tournament;
    ws.send(JSON.stringify({
      type: 'FULL_STATE',
      state
    }));
    return;
  }

  // Handle JOIN_TIMER for timer clients
  if (type === 'JOIN_TIMER') {
    const { hash, timerId } = payload;
    const tournament = tournaments.get(hash);
    if (!tournament) {
      ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Tournament not found' } }));
      return;
    }

    const timer = getOrCreateTimer(tournament, timerId);
    timer.clients.add(ws);
    ws.tournamentHash = hash;
    ws.timerId = timerId;

    // Send current timer state
    const timeLeft = timer.isRunning
      ? Math.max(0, timer.endTime - Date.now())
      : timer.pausedTime;

    ws.send(JSON.stringify({
      type: 'TIMER_SYNC',
      payload: {
        timerId,
        isRunning: timer.isRunning,
        endTime: timer.endTime,
        timeLeft,
        duration: timer.duration
      }
    }));
    console.log(`Client joined timer: ${hash}/${timerId}`);
    return;
  }

  // All other messages require the client to be in a tournament
  if (!ws.tournamentHash) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      error: 'Must join a tournament first'
    }));
    return;
  }

  const tournament = tournaments.get(ws.tournamentHash);
  if (!tournament) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      error: 'Tournament not found'
    }));
    return;
  }

  switch (type) {
    case 'UPDATE_TEXT_FIELD':
      tournament.textFieldRefs[payload.fieldId] = payload.value;
      tournament.version++;
      tournament.isEmpty = false;
      broadcastToTournament(tournament, 'TEXT_FIELD_UPDATED', payload);
      break;

    case 'UPDATE_CHOMBO':
      tournament.chomboRefs[payload.person] = payload.count;
      tournament.version++;
      tournament.isEmpty = false;
      broadcastToTournament(tournament, 'CHOMBO_UPDATED', payload);
      break;

    case 'UPDATE_CONFIG':
      // Don't allow changing locked config (groups, ofSize, forRounds)
      const { groups, ofSize, forRounds, ...allowedConfig } = payload;
      Object.assign(tournament, allowedConfig);
      tournament.version++;
      tournament.isEmpty = false;
      broadcastToTournament(tournament, 'CONFIG_UPDATED', payload);
      break;

    case 'UPDATE_PLAYER_NAMES':
      tournament.config.playerNames = payload.playerNames;
      tournament.version++;
      tournament.isEmpty = false;
      broadcastToTournament(tournament, 'PLAYER_NAMES_UPDATED', payload);
      break;

    case 'RECOMPUTE_TOURNAMENT':
      tournament.lastResults = null;
      tournament.textFieldRefs = {};
      tournament.chomboRefs = {};
      if (payload.config) {
        // Update allowed config fields
        const { playerNames, forbiddenPairs, discouragedGroups } = payload.config;
        if (playerNames) tournament.config.playerNames = playerNames;
        if (forbiddenPairs) tournament.config.forbiddenPairs = forbiddenPairs;
        if (discouragedGroups) tournament.config.discouragedGroups = discouragedGroups;
      }
      tournament.version++;
      tournament.isEmpty = false;
      broadcastToTournament(tournament, 'TOURNAMENT_RECOMPUTED', payload);
      break;

    case 'UPDATE_RESULTS':
      tournament.lastResults = payload.results;
      tournament.version++;
      tournament.isEmpty = false;
      broadcastToTournament(tournament, 'RESULTS_UPDATED', payload);
      break;

    case 'REQUEST_FULL_STATE':
      const { clients, ...state } = tournament;
      ws.send(JSON.stringify({
        type: 'FULL_STATE',
        state
      }));
      break;

    case 'TIMER_START': {
      const { timerId, duration } = payload;
      const timer = getOrCreateTimer(tournament, timerId);
      const now = Date.now();
      timer.isRunning = true;
      timer.startTime = now;
      timer.duration = duration * 1000;
      timer.endTime = now + timer.duration;
      timer.pausedTime = 0;

      broadcastToTimer(timer, 'TIMER_STARTED', { endTime: timer.endTime });
      console.log(`Timer started: ${timerId}, duration: ${duration}s`);
      break;
    }

    case 'TIMER_PAUSE': {
      const { timerId } = payload;
      const timer = tournament.timers.get(timerId);
      if (timer && timer.isRunning) {
        timer.isRunning = false;
        timer.pausedTime = Math.max(0, timer.endTime - Date.now());

        broadcastToTimer(timer, 'TIMER_PAUSED', { timeLeft: timer.pausedTime });
        console.log(`Timer paused: ${timerId}, timeLeft: ${timer.pausedTime}ms`);
      }
      break;
    }

    case 'TIMER_RESUME': {
      const { timerId } = payload;
      const timer = tournament.timers.get(timerId);
      if (timer && !timer.isRunning && timer.pausedTime > 0) {
        timer.isRunning = true;
        timer.endTime = Date.now() + timer.pausedTime;
        timer.pausedTime = 0;

        broadcastToTimer(timer, 'TIMER_STARTED', { endTime: timer.endTime });
        console.log(`Timer resumed: ${timerId}`);
      }
      break;
    }

    case 'TIMER_RESET': {
      const { timerId } = payload;
      const timer = tournament.timers.get(timerId);
      if (timer) {
        timer.isRunning = false;
        timer.startTime = 0;
        timer.endTime = 0;
        timer.pausedTime = 0;

        broadcastToTimer(timer, 'TIMER_RESET', {});
        console.log(`Timer reset: ${timerId}`);
      }
      break;
    }

    default:
      console.warn('Unknown message type:', type);
  }

  tournament.lastUpdated = Date.now();
}

// Broadcast state changes to all clients in a tournament
function broadcastToTournament(tournament, type, payload) {
  const message = JSON.stringify({
    type,
    payload,
    version: tournament.version,
    timestamp: Date.now()
  });

  tournament.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket server ready`);
});
