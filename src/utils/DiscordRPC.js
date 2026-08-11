const net = require('net');
const path = require('path');
const os = require('os');

class DiscordRPCManager {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.clientId = null;
    this.nonce = 0;
    this.reconnectTimer = null;
    this.lastActivity = null;
    this._ready = false;
    this._reconnectAttempts = 0;
    this._initPromise = null;
  }

  _getSocketPaths() {
    if (process.platform === 'win32') {
      return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
    }
    const tmpDir = os.tmpdir();
    return Array.from({ length: 10 }, (_, i) => path.join(tmpDir, `discord-ipc-${i}`));
  }

  async init(clientId) {
    if (!clientId) return false;
    
    // Если уже инициализируется, ждем завершения
    if (this._initPromise) return this._initPromise;
    
    this.destroy();
    this.clientId = clientId;

    const socketPaths = this._getSocketPaths();

    let connected = false;
    for (const socketPath of socketPaths) {
      try {
        connected = await this._tryConnect(socketPath);
        if (connected) break;
      } catch (e) {
        console.log(`[Discord RPC] Failed to connect to ${socketPath}: ${e.message}`);
        continue;
      }
    }

    if (!connected) {
      console.warn('[Discord RPC] Could not connect to Discord — is Discord running?');
      this._initPromise = null;
      return false;
    }
    
    this._initPromise = null;
    return true;
  }

  _tryConnect(socketPath) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      this.socket = socket;

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('timeout'));
      }, 3000);

      socket.connect(socketPath, () => {
        const handshake = JSON.stringify({ v: 1, client_id: this.clientId });
        const buf = Buffer.from(handshake, 'utf8');
        const frame = Buffer.alloc(8 + buf.length);
        frame.writeUInt32LE(0, 0);
        frame.writeUInt32LE(buf.length, 4);
        buf.copy(frame, 8);
        socket.write(frame);
      });

      socket.on('data', (data) => {
        if (data.length < 8) return;
        const opcode = data.readUInt32LE(0);
        const len = data.readUInt32LE(4);
        if (8 + len > data.length) return;
        const jsonStr = data.slice(8, 8 + len).toString('utf8');
        try {
          const msg = JSON.parse(jsonStr);
          if (opcode === 1 && msg.evt === 'READY') {
            clearTimeout(timeout);
            this.connected = true;
            this._ready = true;
            this._reconnectAttempts = 0;
            console.log('[Discord RPC] Connected');
            if (this.lastActivity) {
              this.setActivity(this.lastActivity);
            }
            resolve(true);
          }
        } catch (e) {}
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        try { socket.destroy(); } catch (e) {}
        reject(err);
      });

      socket.on('close', () => {
        if (this.connected) {
          console.log('[Discord RPC] Disconnected');
        }
        this.connected = false;
        this._ready = false;
        this._scheduleReconnect();
      });
    });
  }

  _sendFrame(opcode, data) {
    if (!this.socket || this.socket.destroyed || !this._ready) return;
    const jsonBuf = Buffer.from(JSON.stringify(data), 'utf8');
    const frame = Buffer.alloc(8 + jsonBuf.length);
    frame.writeUInt32LE(opcode, 0);
    frame.writeUInt32LE(jsonBuf.length, 4);
    jsonBuf.copy(frame, 8);
    this.socket.write(frame);
  }

  setActivity(activity) {
    this.lastActivity = activity;
    if (!this.connected) return;

    const payload = {
      details: activity.details || '',
      state: activity.state || '',
      instance: false,
    };

    if (activity.largeImageKey || activity.smallImageKey) {
      payload.assets = {};
      if (activity.largeImageKey) {
        payload.assets.large_image = activity.largeImageKey;
        payload.assets.large_text = activity.largeImageText || '';
      }
      if (activity.smallImageKey) {
        payload.assets.small_image = activity.smallImageKey;
        payload.assets.small_text = activity.smallImageText || '';
      }
    }

    if (activity.startTimestamp) {
      payload.timestamps = {
        start: Math.floor(activity.startTimestamp.getTime() / 1000),
      };
    }

    this._sendFrame(1, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: payload },
      nonce: `n${++this.nonce}`,
    });
  }

  updateActivity(fields) {
    if (!this.lastActivity) return;
    Object.assign(this.lastActivity, fields);
    this.setActivity(this.lastActivity);
  }

  clearActivity() {
    this.lastActivity = null;
    if (!this.connected) return;
    this._sendFrame(1, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: null },
      nonce: `n${++this.nonce}`,
    });
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || !this.clientId) return;
    if (this._reconnectAttempts >= 5) {
      console.warn('[Discord RPC] Max reconnect attempts reached, giving up');
      return;
    }
    this._reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 60000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.clientId) {
        console.log('[Discord RPC] Reconnecting...');
        this.init(this.clientId);
      }
    }, delay);
  }

  destroy() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try { this.socket.destroy(); } catch (e) {}
      this.socket = null;
    }
    this.connected = false;
    this._ready = false;
    this.lastActivity = null;
  }
}

module.exports = DiscordRPCManager;
