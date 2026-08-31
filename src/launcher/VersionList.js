const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// Axios-инстанс с поддержкой прокси из переменных окружения
const http = axios.create({
  timeout: 30000,
  proxy: (() => {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy ||
                     process.env.HTTP_PROXY || process.env.http_proxy ||
                     process.env.PROXY_URL || process.env.proxy_url;
    if (!proxyUrl) return false;
    try { return { url: proxyUrl }; } catch (e) { return false; }
  })()
});

/**
 * VersionList — загрузка и кэширование списка версий из Mojang манифеста.
 * Аналог OfficialVersionList из Legacy Launcher.
 */
class VersionList {
  constructor(cacheDir) {
    this.cacheDir = cacheDir || path.join(process.env.APPDATA || '.', '.minecraft_custom', 'cache');
    this.manifestUrl = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
    this.manifestCachePath = path.join(this.cacheDir, 'version_manifest.json');
    this.manifestCacheTTL = 5 * 60 * 1000; // 5 минут
    this._manifest = null;
    this._manifestTimestamp = 0;
  }

  /**
   * Загружает манифест версий с кэшированием.
   * @returns {Promise<{versions: Array, latest: Object}>}
   */
  async getManifest() {
    // Проверяем кэш
    const cached = this._getCachedManifest();
    if (cached) return cached;

    // Пробуем загрузить со всех доступных URL
    const manifestUrls = [
      'https://launchermeta.mojang.com/mc/game/version_manifest.json',
      'https://piston-meta.mojang.com/mc/game/version_manifest.json',
      'https://piston-data.mojang.com/mc/game/version_manifest.json',
    ];

    let manifest;
    for (const url of manifestUrls) {
      try {
        const response = await http.get(url, { timeout: 15000 });
        manifest = response.data;
        if (manifest && manifest.versions) break;
      } catch (e) {
        // Пробуем следующий URL
      }
    }

    if (!manifest) {
      // Финальный фоллбэк — пробуем загрузить из кэша или выбрасываем ошибку
      const cached = this._getCachedManifest();
      if (cached) {
        console.warn('Using cached manifest (network unavailable)');
        return cached;
      }
      throw new Error('Unable to fetch version manifest from any source');
    }

    // Сохраняем в кэш
    this._saveManifest(manifest);
    this._manifest = manifest;
    this._manifestTimestamp = Date.now();

    return manifest;
  }

  /**
   * Получает список всех версий, отфильтрованных по типу.
   * @param {string} type - 'release', 'snapshot', 'old_beta', 'old_alpha' или null для всех
   * @returns {Promise<Array>}
   */
  async getVersions(type = null) {
    const manifest = await this.getManifest();
    let versions = manifest.versions || [];

    if (type) {
      versions = versions.filter(v => v.type === type);
    }

    // Сортируем по времени выпуска (новые первыми)
    versions.sort((a, b) => {
      const timeA = new Date(a.time || 0).getTime();
      const timeB = new Date(b.time || 0).getTime();
      return timeB - timeA;
    });

    return versions;
  }

  /**
   * Получает список всех версий (все типы).
   * @returns {Promise<Array>}
   */
  async getAllVersions() {
    return this.getVersions(null);
  }

  /**
   * Получает список только релизов.
   * @returns {Promise<Array>}
   */
  async getReleaseVersions() {
    return this.getVersions('release');
  }

  /**
   * Получает список только снапшотов.
   * @returns {Promise<Array>}
   */
  async getSnapshotVersions() {
    return this.getVersions('snapshot');
  }

  /**
   * Получает информацию о последней версии указанного типа.
   * @param {string} type - 'release' или 'snapshot'
   * @returns {Promise<Object|null>}
   */
  async getLatestVersion(type = 'release') {
    const manifest = await this.getManifest();
    return manifest.latest?.[type] || null;
  }

  /**
   * Получает полный манифест версии (JSON по URL из versionInfo.url).
   * @param {string} versionId - ID версии (например, '1.21.4')
   * @returns {Promise<Object>}
   */
  async getVersionManifest(versionId) {
    const manifest = await this.getManifest();
    const versionInfo = manifest.versions.find(v => v.id === versionId);
    if (!versionInfo) {
      throw new Error(`Version ${versionId} not found in manifest`);
    }

    // Проверяем кэш
    const cachePath = path.join(this.cacheDir, `version_${versionId}.json`);
    const cached = this._getCachedVersionManifest(versionId, cachePath);
    if (cached) return cached;

    // Пробуем основной URL с retry
    let versionData;
    try {
      versionData = await this._fetchWithRetry(versionInfo.url, 3, 2000);
    } catch (error) {
      // Фоллбэк — пробуем загрузить через альтернативные эндпоинты
      versionData = await this._tryVersionManifestFallbacks(versionId, versionInfo.url);
      if (!versionData) throw error;
    }

    // Сохраняем в кэш
    await fs.outputFile(cachePath, JSON.stringify(versionData, null, 2));

    return versionData;
  }

  /**
   * Запрос с retry и экспоненциальной задержкой.
   */
  async _fetchWithRetry(url, retries = 3, baseDelay = 2000) {
    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await http.get(url, { timeout: 20000 });
        return response.data;
      } catch (error) {
        lastError = error;
        if (attempt < retries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          console.warn(`Retry ${attempt + 1}/${retries} for ${url} after ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  /**
   * Пробует загрузить JSON версии через фоллбэк URL'ы.
   */
  async _tryVersionManifestFallbacks(versionId, originalUrl) {
    // Альтернативные CDN для манифестов версий
    const fallbackUrls = [
      `https://piston-meta.mojang.com/v1/packages/${versionId}/${versionId}.json`,
      `https://piston-data.mojang.com/v1/versions/${versionId}.json`,
      `https://launchermeta.mojang.com/v1/packages/${versionId}/${versionId}.json`,
    ];

    for (const url of fallbackUrls) {
      try {
        const response = await http.get(url, { timeout: 15000 });
        if (response.data && response.data.id === versionId) {
          return response.data;
        }
      } catch (e) {
        // Пробуем следующий URL
      }
    }

    // Пробуем извлечь путь из оригинального URL и заменить домен
    try {
      const urlObj = new URL(originalUrl);
      const fallbackDomains = [
        'https://piston-meta.mojang.com',
        'https://piston-data.mojang.com',
        'https://launchermeta.mojang.com',
      ];

      for (const domain of fallbackDomains) {
        try {
          const fallbackUrl = `${domain}${urlObj.pathname}${urlObj.search}`;
          const response = await http.get(fallbackUrl, { timeout: 15000 });
          if (response.data && response.data.id === versionId) {
            return response.data;
          }
        } catch (e) {
          // Пробуем следующий домен
        }
      }
    } catch (e) {
      // Не удалось распарсить URL
    }

    return null;
  }

  /**
   * Проверяет, есть ли версия в манифесте.
   * @param {string} versionId
   * @returns {Promise<boolean>}
   */
  async hasVersion(versionId) {
    try {
      const manifest = await this.getManifest();
      return manifest.versions.some(v => v.id === versionId);
    } catch {
      return false;
    }
  }

  /**
   * Очищает кэш.
   */
  clearCache() {
    this._manifest = null;
    this._manifestTimestamp = 0;
    try {
      fs.removeSync(this.cacheDir);
      fs.ensureDirSync(this.cacheDir);
    } catch (e) {}
  }

  // --- Private helpers ---

  _getCachedManifest() {
    if (this._manifest && (Date.now() - this._manifestTimestamp < this.manifestCacheTTL)) {
      return this._manifest;
    }

    try {
      if (fs.existsSync(this.manifestCachePath)) {
        const cached = JSON.parse(fs.readFileSync(this.manifestCachePath, 'utf8'));
        this._manifest = cached;
        this._manifestTimestamp = Date.now();
        return cached;
      }
    } catch (e) {}
    return null;
  }

  _saveManifest(manifest) {
    try {
      fs.outputFileSync(this.manifestCachePath, JSON.stringify(manifest, null, 2));
    } catch (e) {}
  }

  _getCachedVersionManifest(versionId, cachePath) {
    try {
      if (fs.existsSync(cachePath)) {
        const stat = fs.statSync(cachePath);
        const age = Date.now() - stat.mtimeMs;
        if (age < 24 * 60 * 60 * 1000) { // 24 часа
          return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        }
      }
    } catch (e) {}
    return null;
  }

  async _tryFallbackUrls() {
    const fallbackUrls = [
      'https://piston-meta.mojang.com/mc/game/version_manifest.json',
      'https://versions.minecraft.net/mc/game/version_manifest.json',
    ];

    for (const url of fallbackUrls) {
      try {
        const response = await http.get(url, { timeout: 10000 });
        return response.data;
      } catch (e) {
        // Пробуем следующий URL
      }
    }
    return null;
  }
}

module.exports = VersionList;
