class TournamentTimer {
    constructor() {
        this.tournamentHash = null;
        this.timerId = null;
        this.wakeLock = null;
        this.socket = null;
        this.isRunning = false;
        this.timeLeft = 0;
        this.endTime = 0;

        // Parse URL first
        this.parseUrlHash();
        this.initializeElements();
        this.updateTimerLabel();
        this.updateDisplay();
        this.initializeWebSocket();
        this.initializeSleepPrevention();
        this.setupEventListeners();
    }

    parseUrlHash() {
        // Parse URL like: #HASH/timer/tournament or #HASH/timer/round-1-table-2
        const hash = window.location.hash.substring(1);
        const parts = hash.split('/');

        if (parts.length >= 3 && parts[1] === 'timer') {
            this.tournamentHash = parts[0];
            this.timerId = parts[2];
        } else {
            alert('Invalid timer URL format. Expected format: #HASH/timer/TYPE');
            window.location.href = '/';
        }
    }

    updateTimerLabel() {
        const titleEl = document.getElementById('timerTitle');
        const labelEl = document.getElementById('timerLabel');

        if (this.timerId === 'tournament') {
            titleEl.textContent = 'Tournament Timer';
            labelEl.textContent = 'Overall Tournament Clock';
            document.title = 'Tournament Timer';
        } else {
            // Parse "round-X-table-Y"
            const match = this.timerId.match(/round-(\d+)-table-(\d+)/);
            if (match) {
                const round = match[1];
                const table = match[2];
                titleEl.textContent = `Round ${round} - Table ${table}`;
                labelEl.textContent = `Timer for Round ${round}, Table ${table}`;
                document.title = `R${round} T${table} Timer`;
            } else {
                titleEl.textContent = 'Timer';
                labelEl.textContent = this.timerId;
                document.title = 'Timer';
            }
        }
    }

    initializeElements() {
        this.timerDisplay = document.getElementById('timer');
        this.statusDisplay = document.getElementById('status');
        this.hoursInput = document.getElementById('hours');
        this.minutesInput = document.getElementById('minutes');
        this.secondsInput = document.getElementById('seconds');
        this.startBtn = document.getElementById('startBtn');
        this.resumeBtn = document.getElementById('resumeBtn');
        this.pauseBtn = document.getElementById('pauseBtn');
        this.resetBtn = document.getElementById('resetBtn');
        this.connectionStatus = document.getElementById('connectionStatus');
    }

    initializeWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}`;

        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
            this.connectionStatus.textContent = 'Connected';
            this.connectionStatus.className = 'connected';

            // Join the specific timer
            this.socket.send(JSON.stringify({
                type: 'JOIN_TIMER',
                payload: {
                    hash: this.tournamentHash,
                    timerId: this.timerId
                }
            }));
        };

        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleServerMessage(data);
        };

        this.socket.onclose = () => {
            this.connectionStatus.textContent = 'Disconnected';
            this.connectionStatus.className = 'disconnected';
            setTimeout(() => this.initializeWebSocket(), 3000);
        };

        this.socket.onerror = () => {
            this.connectionStatus.textContent = 'Connection Error';
            this.connectionStatus.className = 'error';
        };
    }

    async initializeSleepPrevention() {
        if ('wakeLock' in navigator) {
            try {
                document.addEventListener('visibilitychange', () => {
                    if (this.wakeLock !== null && document.visibilityState === 'visible') {
                        this.requestWakeLock();
                    }
                });
            } catch (err) {
                console.log('Wake Lock not supported:', err);
            }
        }
    }

    async requestWakeLock() {
        if ('wakeLock' in navigator && this.isRunning) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake lock activated');
            } catch (err) {
                console.log('Wake lock failed:', err);
            }
        }
    }

    async releaseWakeLock() {
        if (this.wakeLock !== null) {
            await this.wakeLock.release();
            this.wakeLock = null;
            console.log('Wake lock released');
        }
    }

    setupEventListeners() {
        this.startBtn.addEventListener('click', () => this.startTimer());
        this.resumeBtn.addEventListener('click', () => this.resumeTimer());
        this.pauseBtn.addEventListener('click', () => this.pauseTimer());
        this.resetBtn.addEventListener('click', () => this.resetTimer());
    }

    startTimer() {
        const hours = parseInt(this.hoursInput.value) || 0;
        const minutes = parseInt(this.minutesInput.value) || 0;
        const seconds = parseInt(this.secondsInput.value) || 0;
        const totalSeconds = hours * 3600 + minutes * 60 + seconds;

        if (totalSeconds <= 0) return;

        this.sendMessage('TIMER_START', { duration: totalSeconds });
    }

    resumeTimer() {
        this.sendMessage('TIMER_RESUME', {});
    }

    pauseTimer() {
        this.sendMessage('TIMER_PAUSE', {});
    }

    resetTimer() {
        this.sendMessage('TIMER_RESET', {});
    }

    sendMessage(type, payload) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type,
                payload: {
                    ...payload,
                    timerId: this.timerId
                }
            }));
        }
    }

    handleServerMessage(data) {
        const { type, payload } = data;

        switch (type) {
            case 'TIMER_STARTED':
                this.isRunning = true;
                this.endTime = payload.endTime;
                console.log('Timer started, endTime:', payload.endTime, 'current time:', Date.now());
                this.startBtn.disabled = true;
                this.resumeBtn.style.display = 'none';
                this.pauseBtn.disabled = false;
                this.statusDisplay.textContent = '';
                this.requestWakeLock();
                this.startDisplayUpdate();
                break;

            case 'TIMER_PAUSED':
                this.isRunning = false;
                this.timeLeft = Math.ceil(payload.timeLeft / 1000);
                this.startBtn.disabled = false;
                this.resumeBtn.style.display = 'inline-block';
                this.pauseBtn.disabled = true;
                this.statusDisplay.textContent = 'Paused';
                this.updateDisplay();
                this.releaseWakeLock();
                break;

            case 'TIMER_RESET':
                this.isRunning = false;
                this.timeLeft = 0;
                this.startBtn.disabled = false;
                this.resumeBtn.style.display = 'none';
                this.pauseBtn.disabled = true;
                this.statusDisplay.textContent = 'Ready to start';
                this.updateDisplay();
                this.releaseWakeLock();
                break;

            case 'TIMER_FINISHED':
                this.isRunning = false;
                this.timeLeft = 0;
                this.startBtn.disabled = false;
                this.resumeBtn.style.display = 'none';
                this.pauseBtn.disabled = true;
                this.statusDisplay.textContent = 'Time\'s up!';
                this.updateDisplay();
                this.releaseWakeLock();
                this.playAlert();
                break;

            case 'TIMER_SYNC':
                this.isRunning = payload.isRunning;
                this.endTime = payload.endTime;
                if (this.isRunning) {
                    this.startBtn.disabled = true;
                    this.resumeBtn.style.display = 'none';
                    this.pauseBtn.disabled = false;
                    this.statusDisplay.textContent = '';
                    this.requestWakeLock();
                    this.startDisplayUpdate();
                } else {
                    this.timeLeft = Math.ceil(payload.timeLeft / 1000);
                    this.startBtn.disabled = false;
                    this.resumeBtn.style.display = payload.timeLeft > 0 ? 'inline-block' : 'none';
                    this.pauseBtn.disabled = true;
                    this.statusDisplay.textContent = payload.timeLeft > 0 ? 'Paused' : 'Ready to start';
                    this.updateDisplay();
                    this.releaseWakeLock();
                }
                break;

            case 'ERROR':
                console.error('Server error:', payload.message);
                alert('Error: ' + payload.message);
                break;
        }
    }

    startDisplayUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        const updateTimer = () => {
            if (!this.isRunning) {
                clearInterval(this.updateInterval);
                return;
            }

            this.timeLeft = Math.max(0, Math.ceil((this.endTime - Date.now()) / 1000));
            this.updateDisplay();

            if (this.timeLeft === 0) {
                clearInterval(this.updateInterval);
            }
        };

        updateTimer();
        this.updateInterval = setInterval(updateTimer, 100);
    }

    updateDisplay() {
        const timeLeft = Math.max(0, this.timeLeft || 0);
        const hours = Math.floor(timeLeft / 3600);
        const minutes = Math.floor((timeLeft % 3600) / 60);
        const seconds = timeLeft % 60;

        this.timerDisplay.textContent =
            `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    playAlert() {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Timer Finished!', {
                body: 'Your countdown timer has reached zero.',
                icon: '/favicon.ico'
            });
        }

        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);

        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.5);
    }
}

if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}

new TournamentTimer();
