const axios = require('axios');

class ModrinthAPI {
  constructor() {
    this.baseUrl = 'https://api.modrinth.com/v2';
    this.userAgent = 'ECHO-Launcher/1.0.0';
  }

  extractBaseVersion(versionString) {
    if (!versionString) return '';
    const match = versionString.match(/^(\d+\.\d+(?:\.\d+)?)/);
    return match ? match[1] : versionString;
  }

  async searchMods(query, filters = {}) {
    try {
      const params = new URLSearchParams();
      let facets = [['project_type:mod']];

      if (filters.gameVersion) {
        const baseVersion = this.extractBaseVersion(filters.gameVersion);
        if (baseVersion) {
          facets.push([`versions:${baseVersion}`]);
        }
      }

      if (filters.loader && filters.loader !== '') {
        facets.push([`categories:${filters.loader.toLowerCase()}`]);
      }

      params.append('query', query || '');
      params.append('facets', JSON.stringify(facets));
      params.append('limit', filters.limit || 20);
      params.append('offset', filters.offset || 0);
      params.append('index', filters.sortBy || 'relevance');

      const response = await axios.get(`${this.baseUrl}/search?${params.toString()}`, {
        headers: { 'User-Agent': this.userAgent }
      });

      return {
        success: true,
        hits: response.data.hits,
        total: response.data.total_hits,
        offset: response.data.offset,
        limit: response.data.limit
      };
    } catch (error) {
      console.error('Modrinth search error:', error);
      return { success: false, error: error.message, hits: [], total: 0 };
    }
  }

  async searchContent(query, projectType, filters = {}) {
    try {
      const params = new URLSearchParams();
      let facets = [[`project_type:${projectType}`]];

      if (filters.gameVersion) {
        const baseVersion = this.extractBaseVersion(filters.gameVersion);
        if (baseVersion) {
          facets.push([`versions:${baseVersion}`]);
        }
      }

      if (filters.category && filters.category !== '') {
        facets.push([`categories:${filters.category}`]);
      }

      params.append('query', query || '');
      params.append('facets', JSON.stringify(facets));
      params.append('limit', filters.limit || 20);
      params.append('offset', filters.offset || 0);
      params.append('index', filters.sortBy || 'relevance');

      const response = await axios.get(`${this.baseUrl}/search?${params.toString()}`, {
        headers: { 'User-Agent': this.userAgent }
      });

      return {
        success: true,
        hits: response.data.hits,
        total: response.data.total_hits,
        offset: response.data.offset,
        limit: response.data.limit
      };
    } catch (error) {
      console.error('Modrinth search error:', error);
      return { success: false, error: error.message, hits: [], total: 0 };
    }
  }

  async getModDetails(projectId) {
    try {
      const response = await axios.get(`${this.baseUrl}/project/${projectId}`, {
        headers: { 'User-Agent': this.userAgent }
      });
      return { success: true, mod: response.data };
    } catch (error) {
      console.error('Modrinth mod details error:', error);
      return { success: false, error: error.message };
    }
  }

  async getModVersions(projectId, filters = {}) {
    try {
      const params = new URLSearchParams();

      if (filters.gameVersion) {
        const baseVersion = this.extractBaseVersion(filters.gameVersion);
        if (baseVersion) {
          params.append('game_versions', `["${baseVersion}"]`);
        }
      }

      if (filters.loader && filters.loader !== '') {
        params.append('loaders', `["${filters.loader.toLowerCase()}"]`);
      }

      const response = await axios.get(`${this.baseUrl}/project/${projectId}/version?${params.toString()}`, {
        headers: { 'User-Agent': this.userAgent }
      });

      return { success: true, versions: response.data };
    } catch (error) {
      console.error('Modrinth versions error:', error);
      return { success: false, error: error.message, versions: [] };
    }
  }

  async downloadFile(downloadUrl, filePath, progressCallback) {
    try {
      const response = await axios({
        method: 'get',
        url: downloadUrl,
        responseType: 'stream',
        headers: { 'User-Agent': this.userAgent }
      });

      const fs = require('fs-extra');
      const path = require('path');
      await fs.ensureDir(path.dirname(filePath));

      const totalLength = response.headers['content-length'];
      let downloadedLength = 0;

      const writer = fs.createWriteStream(filePath);

      response.data.on('data', (chunk) => {
        downloadedLength += chunk.length;
        if (progressCallback && totalLength) {
          const percentage = Math.round((downloadedLength * 100) / totalLength);
          progressCallback({
            loaded: downloadedLength,
            total: parseInt(totalLength),
            percentage: percentage
          });
        }
      });

      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve({ success: true }));
        writer.on('error', (error) => reject(error));
      });
    } catch (error) {
      console.error('Modrinth download error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = ModrinthAPI;
