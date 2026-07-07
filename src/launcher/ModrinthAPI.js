const axios = require('axios');

const CATEGORY_TRANSLATIONS = {
  ru: {
    adventure: 'Приключения', cursed: 'Проклятые', decoration: 'Декор', economy: 'Экономика',
    equipment: 'Снаряжение', food: 'Еда', fortune: 'Удача', gameplay: 'Геймплей',
    technology: 'Технологии', magic: 'Магия', management: 'Управление', minimap: 'Мини-карта',
    mobs: 'Мобы', optimization: 'Оптимизация', social: 'Социальное', storage: 'Хранилище',
    transport: 'Транспорт', utility: 'Утилиты', worldgen: 'Генерация мира',
    'cosmetic': 'Косметика', 'library-and-api': 'Библиотека/API',
    'forge': 'Forge', 'fabric': 'Fabric', 'neoforge': 'NeoForge', 'quilt': 'Quilt',
    'bukkit': 'Bukkit', 'spigot': 'Spigot', 'paper': 'Paper', 'bungeecord': 'BungeeCord',
    'velocity': 'Velocity', 'liteloader': 'LiteLoader', 'modloader': 'Mod Loader',
    'architectury': 'Architectury', 'rift': 'Rift',
    'themed': 'Тематические', 'vanilla-like': 'Как ванильные', 'realistic': 'Реалистичные',
    'cute': 'Милые', 'fantasy': 'Фэнтези', 'modern': 'Современные',
    'resolution-8x': '8x', 'resolution-16x': '16x', 'resolution-32x': '32x',
    'resolution-64x': '64x', 'resolution-128x': '128x', 'resolution-256x': '256x', 'resolution-512x': '512x',
    'lighting': 'Освещение', 'performance': 'Производительность', 'realistic-shaders': 'Реалистичные',
    'stylized': 'Стилизованные',
    'modpack': 'Модпаки', 'mod': 'Моды', 'resourcepack': 'Ресурспаки', 'shader': 'Шейдеры',
    'data-pack': 'Датапаки',
    '64x-512x': '64x-512x', '16x-32x': '16x-32x',
  }
};

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

      if (filters.loader && filters.loader !== '') {
        facets.push([`categories:${filters.loader.toLowerCase()}`]);
      }

      if (filters.category && filters.category !== '') {
        facets.push([`categories:${filters.category}`]);
      }

      if (filters.projectType && filters.projectType !== projectType) {
        facets = facets.filter(f => !f[0].startsWith('project_type:'));
        facets.push([`project_type:${filters.projectType}`]);
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

  async getCategories(projectType, lang) {
    try {
      const cacheKey = `categories_${projectType}`;
      if (this._categoryCache && this._categoryCache[cacheKey]) {
        return this._categoryCache[cacheKey].map(c => ({
          ...c,
          translatedName: (CATEGORY_TRANSLATIONS[lang] && CATEGORY_TRANSLATIONS[lang][c.name]) || c.name
        }));
      }
      const response = await axios.get(`${this.baseUrl}/tag/category`, {
        headers: { 'User-Agent': this.userAgent }
      });
      const allCategories = response.data;
      const filtered = allCategories.filter(c => {
        return c.project_type === projectType;
      });
      if (!this._categoryCache) this._categoryCache = {};
      this._categoryCache[cacheKey] = filtered;
      return filtered.map(c => ({
        ...c,
        translatedName: (CATEGORY_TRANSLATIONS[lang] && CATEGORY_TRANSLATIONS[lang][c.name]) || c.name
      }));
    } catch (error) {
      console.error('Modrinth categories error:', error);
      return [];
    }
  }

  async getTags() {
    try {
      if (this._tagsCache) return this._tagsCache;
      const response = await axios.get(`${this.baseUrl}/tag/loader`, {
        headers: { 'User-Agent': this.userAgent }
      });
      this._tagsCache = response.data;
      return this._tagsCache;
    } catch (error) {
      console.error('Modrinth tags error:', error);
      return [];
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
