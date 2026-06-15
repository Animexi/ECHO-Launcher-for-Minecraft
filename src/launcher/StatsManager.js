const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { bt } = require('../localization/backend-translations');

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

    if (!this.stats.versions[version]) {
      this.stats.versions[version] = {
        launches: 0,
        playtime: 0,
        lastPlayed: null
      };
    }

    this.stats.totalLaunches++;
    this.stats.versions[version].launches++;
    this.stats.versions[version].lastPlayed = new Date().toISOString();

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

    this.stats.totalPlaytime += duration;
    if (this.stats.versions[session.version]) {
      this.stats.versions[session.version].playtime += duration;
    }

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
      return bt('time_just_now');
    } else if (diffMins < 60) {
      return bt('time_min_ago', {min: diffMins});
    } else if (diffHours < 24) {
      return bt('time_h_ago', {h: diffHours});
    } else if (diffDays === 1) {
      return bt('time_yesterday');
    } else if (diffDays < 7) {
      return bt('time_d_ago', {d: diffDays});
    } else {
      const lang = require('../localization/backend-translations').getLanguage();
      return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    }
  }
}

module.exports = StatsManager;
