// WebSocket client module for real-time synchronization
class WebSocketClient {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.messageHandlers = new Map();
    this.isReconnecting = false;
    this.tournamentHash = null;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
          this.reconnectAttempts = 0;
          this.isReconnecting = false;
          this.attemptReconnect();
        }
      }
    });
  }

  connect(tournamentHash) {
    this.tournamentHash = tournamentHash;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.showConnectionStatus('connected');

      // Join the tournament room
      if (this.tournamentHash) {
        this.send('JOIN_TOURNAMENT', { hash: this.tournamentHash });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.showConnectionStatus('disconnected');
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
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
      setTimeout(() => {
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
