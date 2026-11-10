// WebSocket client module for real-time synchronization
class WebSocketClient {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.messageHandlers = new Map();
    this.isReconnecting = false;
    this.reconnectTimer = null;
    this.pingTimeout = null;
    this.tournamentHash = null;

    // After a phone unlock or laptop wake the socket may be closed, or dead but still
    // reporting OPEN (the OS dropped it while asleep). Check it on every wake signal.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkConnection();
    });
    window.addEventListener('online', () => this.checkConnection());

    // Laptops don't always fire visibilitychange on wake, so also watch for a gap in
    // this interval's ticks, which means the device was asleep.
    let lastTick = Date.now();
    setInterval(() => {
      const now = Date.now();
      if (now - lastTick > 15000) this.checkConnection();
      lastTick = now;
    }, 5000);
  }

  checkConnection() {
    if (!this.tournamentHash) return;

    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.restartReconnect();
      return;
    }

    // Still connecting, or a ping is already waiting for its PONG
    if (this.ws.readyState !== WebSocket.OPEN || this.pingTimeout) return;

    const ws = this.ws;
    this.send('PING', {});
    this.pingTimeout = setTimeout(() => {
      this.pingTimeout = null;
      if (ws === this.ws) {
        console.warn('No PONG from server; treating connection as dead');
        this.ws = null;
        ws.close();
        this.showConnectionStatus('disconnected');
        this.restartReconnect();
      }
    }, 5000);
  }

  // Start reconnecting from the first (shortest) delay, replacing any pending retry
  restartReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.attemptReconnect();
  }

  connect(tournamentHash) {
    this.tournamentHash = tournamentHash;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    const oldWs = this.ws;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    if (oldWs && oldWs.readyState <= WebSocket.OPEN) {
      oldWs.close();
    }

    // Handlers ignore events from an old socket that was replaced by a newer one
    ws.onopen = () => {
      if (ws !== this.ws) return;
      console.log('WebSocket connected');
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.showConnectionStatus('connected');

      // Join the tournament room
      if (this.tournamentHash) {
        this.send('JOIN_TOURNAMENT', { hash: this.tournamentHash });
      }
    };

    ws.onmessage = (event) => {
      if (ws !== this.ws) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'PONG') {
          clearTimeout(this.pingTimeout);
          this.pingTimeout = null;
          return;
        }
        this.handleMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      if (ws !== this.ws) return;
      console.log('WebSocket disconnected');
      this.showConnectionStatus('disconnected');
      this.attemptReconnect();
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  handleMessage(message) {
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      handler(message);
    } else {
      console.warn('No handler for message type:', message.type);
    }
  }

  on(messageType, handler) {
    this.messageHandlers.set(messageType, handler);
  }

  send(type, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('WebSocket not connected, message not sent:', type);
    }
  }

  attemptReconnect() {
    if (this.isReconnecting) return;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.isReconnecting = true;
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

      this.showConnectionStatus('reconnecting');
      this.reconnectTimer = setTimeout(() => {
        // Clear before connecting so that if this attempt fails, its onclose schedules the next one
        this.isReconnecting = false;
        this.connect(this.tournamentHash);
      }, delay);
    } else {
      console.error('Max reconnection attempts reached');
      this.showReconnectError();
    }
  }

  showConnectionStatus(status) {
    let statusDiv = document.getElementById('connection-status');
    if (!statusDiv) {
      statusDiv = document.createElement('div');
      statusDiv.id = 'connection-status';
      statusDiv.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        padding: 10px 20px;
        border-radius: 5px;
        font-weight: bold;
        z-index: 10000;
        transition: opacity 0.3s;
      `;
      document.body.appendChild(statusDiv);
    }

    clearTimeout(this._statusFadeTimeout);
    statusDiv.style.opacity = '1';

    if (status === 'connected') {
      statusDiv.textContent = '✓ Connected';
      statusDiv.style.backgroundColor = '#4CAF50';
      statusDiv.style.color = 'white';
      this._statusFadeTimeout = setTimeout(() => {
        statusDiv.style.opacity = '0';
      }, 2000);
    } else if (status === 'reconnecting') {
      statusDiv.textContent = '↻ Reconnecting...';
      statusDiv.style.backgroundColor = '#FF9800';
      statusDiv.style.color = 'white';
    } else {
      statusDiv.textContent = '✗ Disconnected';
      statusDiv.style.backgroundColor = '#f44336';
      statusDiv.style.color = 'white';
    }
  }

  showReconnectError() {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      padding: 30px;
      background: white;
      border: 3px solid #f44336;
      border-radius: 10px;
      z-index: 10001;
      text-align: center;
    `;
    errorDiv.innerHTML = `
      <h2>Connection Lost</h2>
      <p>Unable to reconnect to server.</p>
      <button onclick="location.reload()">Reload Page</button>
    `;
    document.body.appendChild(errorDiv);
  }
}

// Global WebSocket client instance
const wsClient = new WebSocketClient();
