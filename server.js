const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Enable JSON parsing
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve trophy page at /trophy
app.get('/trophy', (req, res) => {
  res.sendFile(path.join(__dirname, 'trophy', 'index.html'));
});

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
