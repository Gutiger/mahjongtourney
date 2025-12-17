class CountdownTimer {
    constructor() {
        this.wakeLock = null;
        this.socket = null;
        this.isRunning = false;
        this.timeLeft = 0;
        this.endTime = 0;
        
        this.initializeElements();
        this.updateDisplay();
        this.initializeWebSocket();
        this.initializeSleepPrevention();
        this.setupEventListeners();
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
        
        this.sendMessage({
            type: 'start',
            duration: totalSeconds
        });
    }

    resumeTimer() {
        this.sendMessage({ type: 'resume' });
    }

    pauseTimer() {
        this.sendMessage({ type: 'pause' });
    }

    resetTimer() {
        this.sendMessage({ type: 'reset' });
    }

    sendMessage(message) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
        }
    }

    handleServerMessage(data) {
        switch (data.type) {
            case 'timer_started':
                this.isRunning = true;
                this.endTime = data.endTime;
                console.log('Timer started, endTime:', data.endTime, 'current time:', Date.now());
                this.startBtn.disabled = true;
                this.resumeBtn.style.display = 'none';
                this.pauseBtn.disabled = false;
                this.statusDisplay.textContent = '';
                this.requestWakeLock();
                this.startDisplayUpdate();
                break;
                
            case 'timer_paused':
                this.isRunning = false;
                this.timeLeft = data.timeLeft;
                this.startBtn.disabled = false;
                this.resumeBtn.style.display = 'inline-block';
                this.pauseBtn.disabled = true;
                this.statusDisplay.textContent = 'Paused';
                this.updateDisplay();
                this.releaseWakeLock();
                break;
                
            case 'timer_reset':
                this.isRunning = false;
                this.timeLeft = 0;
                this.startBtn.disabled = false;
                this.resumeBtn.style.display = 'none';
                this.pauseBtn.disabled = true;
                this.statusDisplay.textContent = 'Ready to start';
                this.updateDisplay();
                this.releaseWakeLock();
                break;
                
            case 'timer_finished':
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
                
            case 'timer_sync':
                this.isRunning = data.isRunning;
                this.endTime = data.endTime;
                if (this.isRunning) {
                    this.startBtn.disabled = true;
                    this.resumeBtn.style.display = 'none';
                    this.pauseBtn.disabled = false;
                    this.statusDisplay.textContent = '';
                    this.requestWakeLock();
                    this.startDisplayUpdate();
                } else {
                    this.timeLeft = data.timeLeft;
                    this.startBtn.disabled = false;
                    this.resumeBtn.style.display = data.timeLeft > 0 ? 'inline-block' : 'none';
                    this.pauseBtn.disabled = true;
                    this.statusDisplay.textContent = data.timeLeft > 0 ? 'Paused' : 'Ready to start';
                    this.updateDisplay();
                    this.releaseWakeLock();
                }
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
            console.log('Time left:', this.timeLeft);
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

new CountdownTimer();