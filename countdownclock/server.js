const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

class CountdownServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        
        this.timerState = {
            isRunning: false,
            startTime: 0,
            duration: 0,
            endTime: 0,
            pausedTime: 0
        };
        
        this.clients = new Set();
        this.timerInterval = null;
        
        this.setupRoutes();
        this.setupWebSocket();
    }

    setupRoutes() {
        this.app.use(express.static(path.join(__dirname)));
        
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'index.html'));
        });
    }

    setupWebSocket() {
        this.wss.on('connection', (ws) => {
            console.log('Client connected');
            this.clients.add(ws);
            
            this.sendTimerSync(ws);
            
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleClientMessage(data, ws);
                } catch (err) {
                    console.error('Invalid message:', err);
                }
            });
            
            ws.on('close', () => {
                console.log('Client disconnected');
                this.clients.delete(ws);
            });
            
            ws.on('error', (err) => {
                console.error('WebSocket error:', err);
                this.clients.delete(ws);
            });
        });
    }

    handleClientMessage(data, ws) {
        switch (data.type) {
            case 'time_sync':
                ws.send(JSON.stringify({
                    type: 'time_sync_response',
                    serverTime: Date.now(),
                    clientTime: data.clientTime
                }));
                break;
            case 'start':
                this.startTimer(data.duration);
                break;
            case 'resume':
                this.resumeTimer();
                break;
            case 'pause':
                this.pauseTimer();
                break;
            case 'reset':
                this.resetTimer();
                break;
        }
    }

    startTimer(duration) {
        if (this.timerState.isRunning) return;
        
        this.timerState.isRunning = true;
        this.timerState.startTime = Date.now();
        this.timerState.duration = duration * 1000;
        this.timerState.endTime = this.timerState.startTime + this.timerState.duration;
        this.timerState.pausedTime = 0;
        
        this.broadcast({
            type: 'timer_started',
            endTime: this.timerState.endTime
        });
        
        this.startTimerCheck();
    }

    pauseTimer() {
        if (!this.timerState.isRunning) return;
        
        this.timerState.isRunning = false;
        this.timerState.pausedTime = Math.max(0, this.timerState.endTime - Date.now());
        
        this.broadcast({
            type: 'timer_paused',
            timeLeft: Math.ceil(this.timerState.pausedTime / 1000)
        });
        
        this.stopTimerCheck();
    }

    resumeTimer() {
        if (this.timerState.isRunning || this.timerState.pausedTime <= 0) return;
        
        this.timerState.isRunning = true;
        this.timerState.startTime = Date.now();
        this.timerState.endTime = this.timerState.startTime + this.timerState.pausedTime;
        
        this.broadcast({
            type: 'timer_started',
            endTime: this.timerState.endTime
        });
        
        this.startTimerCheck();
    }

    resetTimer() {
        this.timerState.isRunning = false;
        this.timerState.startTime = 0;
        this.timerState.duration = 0;
        this.timerState.endTime = 0;
        this.timerState.pausedTime = 0;
        
        this.broadcast({
            type: 'timer_reset'
        });
        
        this.stopTimerCheck();
    }

    startTimerCheck() {
        this.stopTimerCheck();
        
        this.timerInterval = setInterval(() => {
            if (!this.timerState.isRunning) return;
            
            const now = Date.now();
            if (now >= this.timerState.endTime) {
                this.timerState.isRunning = false;
                this.broadcast({
                    type: 'timer_finished'
                });
                this.stopTimerCheck();
            }
        }, 100);
    }

    stopTimerCheck() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    sendTimerSync(ws) {
        const now = Date.now();
        let timeLeft = 0;
        
        if (this.timerState.isRunning) {
            timeLeft = Math.max(0, Math.ceil((this.timerState.endTime - now) / 1000));
        } else if (this.timerState.pausedTime > 0) {
            timeLeft = Math.ceil(this.timerState.pausedTime / 1000);
        }
        
        ws.send(JSON.stringify({
            type: 'timer_sync',
            isRunning: this.timerState.isRunning,
            endTime: this.timerState.endTime,
            timeLeft: timeLeft
        }));
    }

    broadcast(message) {
        const messageStr = JSON.stringify(message);
        this.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageStr);
            }
        });
    }

    start(port = 3000) {
        this.server.listen(port, '0.0.0.0', () => {
            console.log(`Countdown timer server running on port ${port}`);
        });
    }
}

const server = new CountdownServer();
server.start(process.env.PORT || 3000);
