const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class StatsManager {
  constructor() {
    this.minecraftDir = path.join(os.homedir(), '.minecraft_custom');
    this.statsPath = path.join(this.minecraftDir, 'launcher_stats.json');
    this.stats = null;
    this.activeSessions = new Map(); // Track active game sessions
  }

  async loadStats() {
    try {
      if (await fs.pathExists(this.statsPath)) {
        this.stats = await fs.readJson(this.statsPath);
      } else {
        this.stats = {
          totalPlaytime: 0, // in minutes
          totalLaunches: 0,
          versions: {}, // version -> { launches, playtime, lastPlayed }
          launchHistory: [] // { version, timestamp, duration }
        };
        await this.saveStats();
      }
    } catch (error) {
      console.error('Error loading stats:', error);
      this.stats = {
        totalPlaytime: 0,
        totalLaunches: 0,
        versions: {},
        launchHistory: []
      };
    }
  }

  async saveStats() {
    try {
      await fs.writeJson(this.statsPath, this.stats, { spaces: 2 });
    } catch (error) {
      console.error('Error saving stats:', error);
    }
  }

  async recordLaunch(version) {
    if (!this.stats) {
      await this.loadStats();
    }

    const sessionId = `${version}-${Date.now()}`;
    const startTime = Date.now();

    // Initialize version stats if not exists
    if (!this.stats.versions[version]) {
      this.stats.versions[version] = {
        launches: 0,
        playtime: 0,
        lastPlayed: null
      };
    }

    // Update stats
    this.stats.totalLaunches++;
    this.stats.versions[version].launches++;
    this.stats.versions[version].lastPlayed = new Date().toISOString();

    // Track active session
    this.activeSessions.set(sessionId, {
      version,
      startTime
    });

    await this.saveStats();
    return sessionId;
  }

  async recordGameEnd(sessionId) {
    if (!this.stats) {
      await this.loadStats();
    }

    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return;
    }

    const endTime = Date.now();
    const duration = Math.round((endTime - session.startTime) / 1000 / 60); // minutes

    // Update playtime
    this.stats.totalPlaytime += duration;
    if (this.stats.versions[session.version]) {
      this.stats.versions[session.version].playtime += duration;
    }

    // Add to launch history (keep last 50)
    this.stats.launchHistory.unshift({
      version: session.version,
      timestamp: new Date(session.startTime).toISOString(),
      duration
    });

    if (this.stats.launchHistory.length > 50) {
      this.stats.launchHistory = this.stats.launchHistory.slice(0, 50);
    }

    this.activeSessions.delete(sessionId);
    await this.saveStats();
  }

  async getStats() {
    if (!this.stats) {
      await this.loadStats();
    }
    return this.stats;
  }

  async getFavoriteVersion() {
    if (!this.stats) {
      await this.loadStats();
    }

    const versions = Object.entries(this.stats.versions);
    if (versions.length === 0) {
      return null;
    }

    // Find version with most playtime
    const favorite = versions.reduce((max, [version, data]) => {
      if (!max || data.playtime > max.playtime) {
        return { version, ...data };
      }
      return max;
    }, null);

    return favorite;
  }

  formatPlaytime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours} ч ${mins} м`;
  }

  formatTimestamp(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 1000 / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) {
      return 'Только что';
    } else if (diffMins < 60) {
      return `${diffMins} мин назад`;
    } else if (diffHours < 24) {
      return `${diffHours} ч назад`;
    } else if (diffDays === 1) {
      return 'Вчера';
    } else if (diffDays < 7) {
      return `${diffDays} дн назад`;
    } else {
      return date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    }
  }
}

module.exports = StatsManager;
