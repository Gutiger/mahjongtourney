const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve trophy page at /trophy
app.get('/trophy', (req, res) => {
  res.sendFile(path.join(__dirname, 'trophy', 'index.html'));
});

// Server-side state (authoritative)
let serverState = {
  // Tournament configuration
  groups: 3,
  ofSize: 4,
  forRounds: 3,
  withGroupLeaders: false,
  playerNames: [],
  forbiddenPairs: [],
  discouragedGroups: [],

  // Tournament results
  lastResults: null,

  // Scoring state
  textFieldRefs: {},
  chomboRefs: {},

  // Uma/Oka config
  oka: null,
  uma1: null,
  uma2: null,
  uma3: null,
  uma4: null,
  startingPoints: null,
  chomboValue: null,

  // Metadata
  lastUpdated: Date.now(),
  version: 0,  // Increment on each change for optimistic locking
  isEmpty: true  // Track if state has been initialized
};

// Connected clients
const clients = new Set();

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('Client connected. Total clients:', clients.size + 1);
  clients.add(ws);

  // Send full state to newly connected client
  ws.send(JSON.stringify({
    type: 'FULL_STATE',
    state: serverState
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleClientMessage(ws, data);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected. Total clients:', clients.size - 1);
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// Handle incoming messages from clients
function handleClientMessage(ws, data) {
  const { type, payload } = data;

  switch (type) {
    case 'UPDATE_TEXT_FIELD':
      serverState.textFieldRefs[payload.fieldId] = payload.value;
      serverState.version++;
      serverState.isEmpty = false;
      broadcastStateChange('TEXT_FIELD_UPDATED', payload);
      break;

    case 'UPDATE_CHOMBO':
      serverState.chomboRefs[payload.person] = payload.count;
      serverState.version++;
      serverState.isEmpty = false;
      broadcastStateChange('CHOMBO_UPDATED', payload);
      break;

    case 'UPDATE_CONFIG':
      Object.assign(serverState, payload);
      serverState.version++;
      serverState.isEmpty = false;
      broadcastStateChange('CONFIG_UPDATED', payload);
      break;

    case 'UPDATE_PLAYER_NAMES':
      serverState.playerNames = payload.playerNames;
      serverState.version++;
      serverState.isEmpty = false;
      broadcastStateChange('PLAYER_NAMES_UPDATED', payload);
      break;

    case 'RECOMPUTE_TOURNAMENT':
      serverState.lastResults = null;
      serverState.textFieldRefs = {};
      serverState.chomboRefs = {};
      if (payload.config) {
        Object.assign(serverState, payload.config);
      }
      serverState.version++;
      serverState.isEmpty = false;
      broadcastStateChange('TOURNAMENT_RECOMPUTED', payload);
      break;

    case 'UPDATE_RESULTS':
      serverState.lastResults = payload.results;
      serverState.version++;
      serverState.isEmpty = false;
      broadcastStateChange('RESULTS_UPDATED', payload);
      break;

    case 'REQUEST_FULL_STATE':
      ws.send(JSON.stringify({
        type: 'FULL_STATE',
        state: serverState
      }));
      break;

    case 'RESTORE_FROM_LOCALSTORAGE':
      // Only restore if server state is empty
      if (serverState.isEmpty) {
        console.log('Restoring server state from client localStorage');
        serverState = {
          ...payload.state,
          version: serverState.version + 1,
          lastUpdated: Date.now(),
          isEmpty: false
        };

        // Broadcast the restored state to all clients
        broadcastStateChange('FULL_STATE', { state: serverState });
      }
      break;

    default:
      console.warn('Unknown message type:', type);
  }

  serverState.lastUpdated = Date.now();
}

// Broadcast state changes to all connected clients
function broadcastStateChange(type, payload) {
  const message = JSON.stringify({
    type,
    payload,
    version: serverState.version,
    timestamp: Date.now()
  });

  clients.forEach((client) => {
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
