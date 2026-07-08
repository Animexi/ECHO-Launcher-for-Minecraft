const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const extract = require('extract-zip');
const JavaManager = require('./JavaManager');
const GPUSettings = require('../utils/GPUSettings');
const { bt } = require('../localization/backend-translations');

class MinecraftLauncher {
  constructor() {
    this.minecraftDir = path.join(os.homedir(), '.minecraft_custom');
    this.versionsDir = path.join(this.minecraftDir, 'versions');
    this.librariesDir = path.join(this.minecraftDir, 'libraries');
    this.assetsDir = path.join(this.minecraftDir, 'assets');
    this.configPath = path.join(this.minecraftDir, 'launcher_config.json');
    this.instancesDir = path.join(this.minecraftDir, 'instances');
    this.authlibPath = path.join(this.minecraftDir, 'authlib-injector.jar');
    this.javaManager = new JavaManager();
    this.gpuSettings = new GPUSettings();
    this.manifestCache = new Map();
    this.MANIFEST_CACHE_TTL = 5 * 60 * 1000;
    this.DOWNLOAD_CONCURRENCY = 8;

    this.initDirectories();
  }

  // ---------- Helper methods for library deduplication ----------
  getLibraryGA(lib) {
    if (!lib.name) return null;
    const parts = lib.name.split(':');
    if (parts.length >= 4) {
      return `${parts[0]}:${parts[1]}:${parts[3]}`;
    }
    if (parts.length >= 2) {
      return `${parts[0]}:${parts[1]}`;
    }
    return null;
  }

  getLibraryVersion(lib) {
    if (!lib.name) return '';
    const parts = lib.name.split(':');
    return parts.length >= 3 ? parts[2] : '';
  }

  compareVersions(v1, v2) {
    const a = v1.split('.').map(Number);
    const b = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const n1 = a[i] || 0;
      const n2 = b[i] || 0;
      if (n1 !== n2) return n1 - n2;
    }
    return 0;
  }
  // --------------------------------------------------------------

  async initDirectories() {
    await fs.ensureDir(this.minecraftDir);
    await fs.ensureDir(this.versionsDir);
    await fs.ensureDir(this.librariesDir);
    await fs.ensureDir(this.assetsDir);
    await fs.ensureDir(this.instancesDir);
  }

  async getCachedManifest(url) {
    const cached = this.manifestCache.get(url);
    if (cached && (Date.now() - cached.timestamp < this.MANIFEST_CACHE_TTL)) {
      return cached.data;
    }
    const response = await axios.get(url);
    this.manifestCache.set(url, { data: response.data, timestamp: Date.now() });
    return response.data;
  }

  async downloadWithResume(url, filePath, progressCallback) {
    await fs.ensureDir(path.dirname(filePath));
    let downloadedSize = 0;
    try {
      if (await fs.pathExists(filePath)) {
        const stat = await fs.stat(filePath);
        downloadedSize = stat.size;
      }
    } catch (e) {}

    const headers = {};
    if (downloadedSize > 0) {
      headers['Range'] = `bytes=${downloadedSize}-`;
    }

    try {
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        headers: headers,
        timeout: 60000
      });

      if (response.status === 206 && downloadedSize > 0) {
        const writer = fs.createWriteStream(filePath, { flags: 'a' });
        const totalLength = parseInt(response.headers['content-length'] || '0') + downloadedSize;
        let currentSize = downloadedSize;

        return new Promise((resolve, reject) => {
          response.data.on('data', (chunk) => {
            currentSize += chunk.length;
            if (progressCallback && totalLength > 0) {
              progressCallback({ loaded: currentSize, total: totalLength, percentage: Math.round((currentSize * 100) / totalLength) });
            }
          });
          response.data.pipe(writer);
          writer.on('finish', () => resolve({ success: true }));
          writer.on('error', reject);
        });
      } else {
        const writer = fs.createWriteStream(filePath);
        const totalLength = parseInt(response.headers['content-length'] || '0');
        let currentSize = 0;

        return new Promise((resolve, reject) => {
          response.data.on('data', (chunk) => {
            currentSize += chunk.length;
            if (progressCallback && totalLength > 0) {
              progressCallback({ loaded: currentSize, total: totalLength, percentage: Math.round((currentSize * 100) / totalLength) });
            }
          });
          response.data.pipe(writer);
          writer.on('finish', () => resolve({ success: true }));
          writer.on('error', reject);
        });
      }
    } catch (error) {
      if (error.response && error.response.status === 416) {
        return { success: true };
      }
      throw error;
    }
  }

  async verifyFileHash(filePath, expectedHash) {
    if (!expectedHash) return true;
    try {
      if (!await fs.pathExists(filePath)) return false;
      const fileBuffer = await fs.readFile(filePath);
      const hash = crypto.createHash('sha1').update(fileBuffer).digest('hex');
      return hash === expectedHash;
    } catch (e) {
      return false;
    }
  }

  async downloadBatch(tasks, concurrency) {
    let completed = 0;
    const total = tasks.length;
    const results = [];

    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(batch.map(task => task()));
      results.push(...batchResults);
      completed += batch.length;
    }

    return results;
  }

  async downloadAuthlibInjector() {
    if (await fs.pathExists(this.authlibPath)) return;
    try {
      console.log('Downloading authlib-injector...');
      const response = await axios.get('https://authlib-injector.yushi.moe/artifact/latest.json', { timeout: 15000 });
      const downloadUrl = response.data.download_url;
      const fileResponse = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 30000 });
      await fs.writeFile(this.authlibPath, fileResponse.data);
      console.log('authlib-injector downloaded');
    } catch (error) {
      console.error('Failed to download authlib-injector:', error.message);
    }
  }

  async downloadFabricLoader(mcVersion, loaderVersion, progressCallback) {
    try {
      const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVersion}/profile/json`;
      progressCallback({ stage: bt('stage_fabric_profile'), progress: 50 });
      const profileResponse = await axios.get(profileUrl);
      const fabricProfile = profileResponse.data;
      progressCallback({ stage: bt('stage_fabric_libs'), progress: 60 });
      const libraries = fabricProfile.libraries || [];
      for (let i = 0; i < libraries.length; i++) {
        const library = libraries[i];
        if (library.url && library.name) {
          const parts = library.name.split(':');
          if (parts.length >= 3) {
            const [group, artifact, version] = parts;
            const groupPath = group.replace(/\./g, '/');
            let jarName;
            if (parts.length >= 4) {
              jarName = `${artifact}-${version}-${parts[3]}.jar`;
            } else {
              jarName = `${artifact}-${version}.jar`;
            }
            const libPath = path.join(this.librariesDir, groupPath, artifact, version, jarName);
            if (!await fs.pathExists(libPath)) {
              try {
                const libUrl = `${library.url}${groupPath}/${artifact}/${version}/${jarName}`;
                await this.downloadWithResume(libUrl, libPath);
              } catch (e) {
                if (parts.length < 4) {
                  console.warn(`Failed to download Fabric lib ${library.name}:`, e.message);
                }
              }
            }
          }
        }
        if (i % 5 === 0) {
          progressCallback({ stage: bt('stage_fabric_libs_progress', {current: i, total: libraries.length}), progress: 60 + ((i / libraries.length) * 30) });
        }
      }
      return fabricProfile;
    } catch (error) {
      console.error('Failed to download Fabric loader:', error);
      return null;
    }
  }

  async downloadForgeProfile(mcVersion, forgeVersion, versionId, progressCallback) {
    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVersion}/forge-${mcVersion}-${forgeVersion}-installer.jar`;
        progressCallback({ stage: bt('stage_installing_forge'), progress: 35 });

        const versionDir = path.join(this.versionsDir, versionId);
        await fs.ensureDir(versionDir);
        const installerPath = path.join(versionDir, `forge-installer.jar`);

        const response = await axios({ method: 'get', url: installerUrl, responseType: 'stream', timeout: 300000 });
        const writer = fs.createWriteStream(installerPath);
        await new Promise((resolve, reject) => {
          response.data.pipe(writer);
          writer.on('finish', resolve);
          writer.on('error', reject);
        });

        const stat = await fs.stat(installerPath);
        console.log(`Forge installer downloaded: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);

        progressCallback({ stage: bt('stage_installing_forge'), progress: 45 });

        const javaPath = await this.javaManager.getJavaForMinecraft(mcVersion) || 'java';
        await new Promise((resolve, reject) => {
          const proc = spawn(javaPath, ['-jar', installerPath, '--installClient', this.minecraftDir], {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 600000
          });
          let stderr = '';
          let libCount = 0;
          let phase = 'libs';
          proc.stdout.on('data', (d) => {
            const text = d.toString();
            console.log('[Forge Installer]', text.trim());
            if (text.includes('Considering library')) {
              libCount++;
              if (libCount % 3 === 0) {
                const libProgress = Math.min(70, 45 + (libCount / 80) * 25);
                progressCallback({ stage: bt('stage_installing_forge_progress', { current: libCount, total: '~80' }), progress: Math.round(libProgress) });
              }
            }
            if (text.includes('Building Processors') || text.includes('MainClass:')) {
              if (phase === 'libs') {
                phase = 'processors';
                progressCallback({ stage: bt('stage_installing_forge'), progress: 70 });
              }
            }
            if (text.includes('Splitting') || text.includes('Extracting')) {
              if (phase === 'processors') {
                phase = 'done';
                progressCallback({ stage: bt('stage_installing_forge'), progress: 80 });
              }
            }
          });
          proc.stderr.on('data', (d) => { stderr += d.toString(); });
          proc.on('close', (code) => {
            if (code === 0) {
              console.log('Forge installer completed successfully');
              resolve();
            } else {
              reject(new Error(`Forge installer exited with code ${code}: ${stderr.substring(0, 500)}`));
            }
          });
          proc.on('error', reject);
        });

        try { await fs.remove(installerPath); } catch (e) {}

        const installedJsonPath = path.join(versionDir, `${versionId}.json`);
        if (await fs.pathExists(installedJsonPath)) {
          const forgeProfile = await fs.readJson(installedJsonPath);
          progressCallback({ stage: bt('stage_installing_forge'), progress: 90 });
          return forgeProfile;
        } else {
          throw new Error('Forge installer did not create version.json');
        }
      } catch (error) {
        lastError = error;
        console.error(`Failed to download Forge profile (attempt ${attempt}/${maxRetries}):`, error.message);
        try { await fs.remove(path.join(this.versionsDir, versionId, 'forge-installer.jar')); } catch (e) {}
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    console.error('All Forge profile download attempts failed:', lastError?.message);
    return null;
  }

  async downloadOptiFineProfile(mcVersion, optifineVersion, versionId, vanillaJson, progressCallback) {
    try {
      progressCallback({ stage: bt('stage_fabric_profile'), progress: 35 });

      const jarFileName = `OptiFine_${mcVersion}_${optifineVersion}.jar`;
      const optifineUrl = `https://optifine.net/adloadx?f=${jarFileName}`;
      const libGroupPath = 'optifine/OptiFine';
      const libVersion = `${mcVersion}_${optifineVersion}`;
      const libPath = path.join(this.librariesDir, libGroupPath, 'OptiFine', libVersion, jarFileName);

      progressCallback({ stage: bt('stage_downloading_client'), progress: 40 });
      if (!await fs.pathExists(libPath)) {
        try {
          await fs.ensureDir(path.dirname(libPath));
          const response = await axios.get(optifineUrl, {
            responseType: 'stream',
            timeout: 120000,
            maxRedirects: 5,
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          const writer = fs.createWriteStream(libPath);
          await new Promise((resolve, reject) => {
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
          });
        } catch (e) {
          console.error(`Failed to download OptiFine JAR from ${optifineUrl}:`, e.message);
          return null;
        }
      }

      progressCallback({ stage: bt('stage_fabric_libs'), progress: 60 });

      const optifineProfile = {
        ...vanillaJson,
        id: versionId,
        type: 'release',
        inheritsFrom: mcVersion,
        mainClass: vanillaJson.mainClass || 'net.minecraft.client.main.Main',
        libraries: [
          ...(vanillaJson.libraries || []),
          {
            name: `optifine:OptiFine:${libVersion}`,
            downloads: {
              artifact: {
                path: `${libGroupPath}/OptiFine/${libVersion}/${jarFileName}`,
                url: optifineUrl
              }
            }
          }
        ]
      };

      progressCallback({ stage: bt('stage_fabric_libs'), progress: 80 });
      return optifineProfile;
    } catch (error) {
      console.error('Failed to download OptiFine profile:', error.message);
      return null;
    }
  }

  async downloadNeoForgeProfile(mcVersion, neoforgeVersion, versionId, progressCallback) {
    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoforgeVersion}/neoforge-${neoforgeVersion}-installer.jar`;
        progressCallback({ stage: bt('stage_installing_neoforge'), progress: 35 });

        const versionDir = path.join(this.versionsDir, versionId);
        await fs.ensureDir(versionDir);
        const installerPath = path.join(versionDir, `neoforge-installer.jar`);

        const response = await axios({ method: 'get', url: installerUrl, responseType: 'stream', timeout: 300000 });
        const writer = fs.createWriteStream(installerPath);
        await new Promise((resolve, reject) => {
          response.data.pipe(writer);
          writer.on('finish', resolve);
          writer.on('error', reject);
        });

        const stat = await fs.stat(installerPath);
        console.log(`NeoForge installer downloaded: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);

        progressCallback({ stage: bt('stage_installing_neoforge'), progress: 45 });

        const javaPath = await this.javaManager.getJavaForMinecraft(mcVersion) || 'java';
        await new Promise((resolve, reject) => {
          const proc = spawn(javaPath, ['-jar', installerPath, '--installClient', this.minecraftDir], {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 600000
          });
          let stderr = '';
          let libCount = 0;
          let phase = 'libs';
          proc.stdout.on('data', (d) => {
            const text = d.toString();
            console.log('[NeoForge Installer]', text.trim());
            if (text.includes('Considering library')) {
              libCount++;
              if (libCount % 3 === 0) {
                const libProgress = Math.min(70, 45 + (libCount / 80) * 25);
                progressCallback({ stage: bt('stage_installing_neoforge_progress', { current: libCount, total: '~80' }), progress: Math.round(libProgress) });
              }
            }
            if (text.includes('Building Processors') || text.includes('MainClass:')) {
              if (phase === 'libs') {
                phase = 'processors';
                progressCallback({ stage: bt('stage_installing_neoforge'), progress: 70 });
              }
            }
            if (text.includes('Splitting') || text.includes('Extracting')) {
              if (phase === 'processors') {
                phase = 'done';
                progressCallback({ stage: bt('stage_installing_neoforge'), progress: 80 });
              }
            }
          });
          proc.stderr.on('data', (d) => { stderr += d.toString(); });
          proc.on('close', (code) => {
            if (code === 0) {
              console.log('NeoForge installer completed successfully');
              resolve();
            } else {
              reject(new Error(`NeoForge installer exited with code ${code}: ${stderr.substring(0, 500)}`));
            }
          });
          proc.on('error', reject);
        });

        try { await fs.remove(installerPath); } catch (e) {}

        const installedJsonPath = path.join(versionDir, `${versionId}.json`);
        if (await fs.pathExists(installedJsonPath)) {
          const neoforgeProfile = await fs.readJson(installedJsonPath);
          progressCallback({ stage: bt('stage_installing_neoforge'), progress: 90 });
          return neoforgeProfile;
        } else {
          throw new Error('NeoForge installer did not create version.json');
        }
      } catch (error) {
        lastError = error;
        console.error(`Failed to download NeoForge profile (attempt ${attempt}/${maxRetries}):`, error.message);
        try { await fs.remove(path.join(this.versionsDir, versionId, 'neoforge-installer.jar')); } catch (e) {}
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    console.error('All NeoForge profile download attempts failed:', lastError?.message);
    return null;
  }

  async downloadQuiltLoader(mcVersion, loaderVersion, versionId, progressCallback) {
    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const profileUrl = `https://meta.quiltmc.org/v3/versions/loader/${mcVersion}/${loaderVersion}/profile/json`;
        progressCallback({ stage: bt('stage_installing_quilt'), progress: 35 });
        const profileResponse = await axios.get(profileUrl, { timeout: 30000 });
        const quiltProfile = profileResponse.data;

        quiltProfile.id = versionId;
        quiltProfile.isolated = true;
        if (!quiltProfile.inheritsFrom) quiltProfile.inheritsFrom = mcVersion;

        progressCallback({ stage: bt('stage_installing_quilt'), progress: 50 });
        const libraries = quiltProfile.libraries || [];
        for (let i = 0; i < libraries.length; i++) {
          const library = libraries[i];
          if (library.url && library.name) {
            const parts = library.name.split(':');
            if (parts.length >= 3) {
              const [group, artifact, version] = parts;
              const groupPath = group.replace(/\./g, '/');
              let jarName;
              if (parts.length >= 4) {
                jarName = `${artifact}-${version}-${parts[3]}.jar`;
              } else {
                jarName = `${artifact}-${version}.jar`;
              }
              const libPath = path.join(this.librariesDir, groupPath, artifact, version, jarName);
              if (!await fs.pathExists(libPath)) {
                try {
                  const libUrl = `${library.url}${groupPath}/${artifact}/${version}/${jarName}`;
                  await this.downloadWithResume(libUrl, libPath);
                } catch (e) {
                  if (parts.length < 4) {
                    console.warn(`Failed to download Quilt lib ${library.name}:`, e.message);
                  }
                }
              }
            }
          }
          if (i % 5 === 0) {
            progressCallback({ stage: bt('stage_installing_quilt_progress', {current: i, total: libraries.length}), progress: 50 + ((i / libraries.length) * 40) });
          }
        }
        return quiltProfile;
      } catch (error) {
        lastError = error;
        console.error(`Failed to download Quilt loader (attempt ${attempt}/${maxRetries}):`, error.message);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    console.error('All Quilt loader download attempts failed:', lastError?.message);
    return null;
  }

  getLibraryKey(lib) {
    if (lib.name) return lib.name;
    if (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.path) return lib.downloads.artifact.path;
    return JSON.stringify(lib);
  }

  async mergeVersion(json) {
    let result = { ...json };
    let current = json;
    const processedParents = new Set();
    const allLibraries = [];

    const addLibraries = (versionObj) => {
      if (versionObj.libraries) {
        for (const lib of versionObj.libraries) {
          allLibraries.push(lib);
        }
      }
    };

    addLibraries(current);

    while (current.inheritsFrom && !processedParents.has(current.inheritsFrom)) {
      const parentId = current.inheritsFrom;
      processedParents.add(parentId);
      const parentJsonPath = path.join(this.versionsDir, parentId, `${parentId}.json`);
      if (!await fs.pathExists(parentJsonPath)) break;
      const parentJson = await fs.readJson(parentJsonPath);
      addLibraries(parentJson);

      if (!result.mainClass && parentJson.mainClass) result.mainClass = parentJson.mainClass;
      if (!result.assetIndex && parentJson.assetIndex) result.assetIndex = parentJson.assetIndex;
      if (!result.assets && parentJson.assets) result.assets = parentJson.assets;
      if (!result.javaVersion && parentJson.javaVersion) result.javaVersion = parentJson.javaVersion;
      if (parentJson.arguments) {
        if (!result.arguments) {
          result.arguments = JSON.parse(JSON.stringify(parentJson.arguments));
        } else {
          if (parentJson.arguments.jvm) {
            if (!result.arguments.jvm) {
              result.arguments.jvm = JSON.parse(JSON.stringify(parentJson.arguments.jvm));
            } else {
              const existingJvm = new Set(result.arguments.jvm.filter(a => typeof a === 'string'));
              for (const jvmArg of parentJson.arguments.jvm) {
                if (typeof jvmArg === 'string' && !existingJvm.has(jvmArg)) {
                  result.arguments.jvm.push(jvmArg);
                } else if (typeof jvmArg === 'object') {
                  result.arguments.jvm.push(jvmArg);
                }
              }
            }
          }
          if (parentJson.arguments.game) {
            if (!result.arguments.game) {
              result.arguments.game = JSON.parse(JSON.stringify(parentJson.arguments.game));
            } else {
              const existingGame = new Set(result.arguments.game.filter(a => typeof a === 'string'));
              for (const gameArg of parentJson.arguments.game) {
                if (typeof gameArg === 'string' && !existingGame.has(gameArg)) {
                  result.arguments.game.push(gameArg);
                } else if (typeof gameArg === 'object') {
                  result.arguments.game.push(gameArg);
                }
              }
            }
          }
        }
      }
      if (!result.minecraftArguments && parentJson.minecraftArguments) result.minecraftArguments = parentJson.minecraftArguments;
      if (!result.type && parentJson.type) result.type = parentJson.type;

      current = parentJson;
    }

    const dedupMap = new Map();
    for (const lib of allLibraries) {
      const ga = this.getLibraryGA(lib);
      if (!ga) {
        dedupMap.set(JSON.stringify(lib), lib);
        continue;
      }
      const existing = dedupMap.get(ga);
      if (!existing) {
        dedupMap.set(ga, lib);
      } else {
        const existingVer = this.getLibraryVersion(existing);
        const newVer = this.getLibraryVersion(lib);
        if (this.compareVersions(newVer, existingVer) > 0) {
          dedupMap.set(ga, lib);
        }
      }
    }

    result.libraries = Array.from(dedupMap.values());
    return result;
  }

  async resolveVersion(versionId) {
    const versionJsonPath = path.join(this.versionsDir, versionId, `${versionId}.json`);
    if (!await fs.pathExists(versionJsonPath)) {
      throw new Error(`Version ${versionId} not found`);
    }
    const versionJson = await fs.readJson(versionJsonPath);
    return this.mergeVersion(versionJson);
  }

  async downloadMissingLibraries(versionJson) {
    const libraries = versionJson.libraries || [];
    const tasks = [];

    for (const library of libraries) {
      let libPath = null;
      let downloadUrl = null;
      let expectedHash = null;

      if (library.downloads && library.downloads.artifact) {
        libPath = path.join(this.librariesDir, library.downloads.artifact.path);
        downloadUrl = library.downloads.artifact.url;
        expectedHash = library.downloads.artifact.sha1;
      } else if (library.name && library.url) {
        const parts = library.name.split(':');
        if (parts.length >= 3) {
          const [group, artifact, version] = parts;
          const groupPath = group.replace(/\./g, '/');
          const jarName = `${artifact}-${version}.jar`;
          libPath = path.join(this.librariesDir, groupPath, artifact, version, jarName);
          downloadUrl = `${library.url}${groupPath}/${artifact}/${version}/${jarName}`;
        }
      } else if (library.name) {
        const parts = library.name.split(':');
        if (parts.length >= 3) {
          const [group, artifact, version] = parts;
          const groupPath = group.replace(/\./g, '/');
          const jarName = `${artifact}-${version}.jar`;
          libPath = path.join(this.librariesDir, groupPath, artifact, version, jarName);
          downloadUrl = `https://repo1.maven.org/maven2/${groupPath}/${artifact}/${version}/${jarName}`;
        }
      }
      if (!libPath && library.downloads && library.downloads.classifiers) {
        const nativeKey = 'natives-windows';
        if (library.downloads.classifiers[nativeKey]) {
          libPath = path.join(this.librariesDir, library.downloads.classifiers[nativeKey].path);
          downloadUrl = library.downloads.classifiers[nativeKey].url;
        }
      }

      if (libPath && downloadUrl) {
        const currentLibPath = libPath;
        const currentDownloadUrl = downloadUrl;
        const currentHash = expectedHash;
        tasks.push(async () => {
          const exists = await fs.pathExists(currentLibPath);
          if (exists && currentHash) {
            const valid = await this.verifyFileHash(currentLibPath, currentHash);
            if (valid) return { success: true, skipped: true };
            await fs.remove(currentLibPath);
          }
          if (!exists || !currentHash) {
            if (await fs.pathExists(currentLibPath)) return { success: true, skipped: true };
          }
          try {
            await this.downloadWithResume(currentDownloadUrl, currentLibPath);
            if (currentHash) {
              const valid = await this.verifyFileHash(currentLibPath, currentHash);
              if (!valid) {
                await fs.remove(currentLibPath);
                await this.downloadWithResume(currentDownloadUrl, currentLibPath);
              }
            }
            return { success: true };
          } catch (e) {
            return { success: false, error: e.message };
          }
        });
      }
    }

    if (tasks.length > 0) {
      await this.downloadBatch(tasks, this.DOWNLOAD_CONCURRENCY);
    }
  }

  async getAvailableVersions() {
    try {
      const response = await this.getCachedManifest('https://launchermeta.mojang.com/mc/game/version_manifest.json');
      return response.versions.filter(v => v.type === 'release');
    } catch (error) {
      console.error('Error fetching versions:', error);
      return [];
    }
  }

  async isVersionFullyDownloaded(versionId) {
    try {
      const versionDir = path.join(this.versionsDir, versionId);
      const versionJsonPath = path.join(versionDir, `${versionId}.json`);
      const jarPath = path.join(versionDir, `${versionId}.jar`);
      if (!await fs.pathExists(versionJsonPath) || !await fs.pathExists(jarPath)) return false;
      const versionJson = await fs.readJson(versionJsonPath);
      if (versionJson.assetIndex) {
        const assetIndexPath = path.join(this.assetsDir, 'indexes', `${versionJson.assetIndex.id}.json`);
        if (!await fs.pathExists(assetIndexPath)) return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  async downloadMinecraft(versionId, progressCallback) {
    try {
      const isForge = versionId.includes('-forge-');
      const isFabric = versionId.includes('-fabric-');
      const isOptiFine = versionId.includes('-optifine-');
      const isNeoForge = versionId.includes('-neoforge-');
      const isQuilt = versionId.includes('-quilt-');

      if (isForge || isFabric || isOptiFine || isNeoForge || isQuilt) {
        const mcVersion = versionId.split('-')[0];
        const loaderVersion = versionId.split('-')[2];
        const loaderName = isForge ? 'Forge' : isFabric ? 'Fabric' : isOptiFine ? 'OptiFine' : isNeoForge ? 'NeoForge' : 'Quilt';
        progressCallback({ stage: bt('stage_preparing', {loader: loaderName, version: mcVersion}), progress: 5 });
        const vanillaDir = path.join(this.versionsDir, mcVersion);
        if (!await this.isVersionFullyDownloaded(mcVersion)) {
          progressCallback({ stage: bt('stage_downloading_base'), progress: 10 });
          const result = await this.downloadMinecraft(mcVersion, progressCallback);
          if (!result.success) return result;
        }
        const versionDir = path.join(this.versionsDir, versionId);
        await fs.ensureDir(versionDir);
        const vanillaJar = path.join(vanillaDir, `${mcVersion}.jar`);
        const moddedJar = path.join(versionDir, `${versionId}.jar`);
        await fs.copy(vanillaJar, moddedJar);
        const vanillaJson = await fs.readJson(path.join(vanillaDir, `${mcVersion}.json`));
        const instanceDir = path.join(this.instancesDir, versionId);
        await fs.ensureDir(instanceDir);
        await fs.ensureDir(path.join(instanceDir, 'saves'));
        await fs.ensureDir(path.join(instanceDir, 'mods'));
        await fs.ensureDir(path.join(instanceDir, 'resourcepacks'));
        await fs.ensureDir(path.join(instanceDir, 'shaderpacks'));
        await fs.ensureDir(path.join(instanceDir, 'screenshots'));
        await fs.ensureDir(path.join(instanceDir, 'logs'));
        await fs.ensureDir(path.join(instanceDir, 'config'));

        let moddedJson;

        if (isFabric && loaderVersion) {
          progressCallback({ stage: bt('stage_downloading_fabric'), progress: 30 });
          const fabricProfile = await this.downloadFabricLoader(mcVersion, loaderVersion, progressCallback);
          if (fabricProfile) {
            moddedJson = fabricProfile;
            moddedJson.id = versionId;
            moddedJson.isolated = true;
            moddedJson.instanceDir = instanceDir;
            if (!moddedJson.inheritsFrom) moddedJson.inheritsFrom = mcVersion;
          }
        }

        if (isForge && loaderVersion) {
          progressCallback({ stage: bt('stage_installing_forge'), progress: 30 });
          const forgeProfile = await this.downloadForgeProfile(mcVersion, loaderVersion, versionId, progressCallback);
          if (forgeProfile) {
            moddedJson = forgeProfile;
            moddedJson.id = versionId;
            moddedJson.isolated = true;
            moddedJson.instanceDir = instanceDir;
            if (!moddedJson.inheritsFrom) moddedJson.inheritsFrom = mcVersion;
          }
        }

        if (isNeoForge && loaderVersion) {
          progressCallback({ stage: bt('stage_installing_neoforge'), progress: 30 });
          const neoforgeProfile = await this.downloadNeoForgeProfile(mcVersion, loaderVersion, versionId, progressCallback);
          if (neoforgeProfile) {
            moddedJson = neoforgeProfile;
            moddedJson.id = versionId;
            moddedJson.isolated = true;
            moddedJson.instanceDir = instanceDir;
            if (!moddedJson.inheritsFrom) moddedJson.inheritsFrom = mcVersion;
          }
        }

        if (isQuilt && loaderVersion) {
          progressCallback({ stage: bt('stage_installing_quilt'), progress: 30 });
          const quiltProfile = await this.downloadQuiltLoader(mcVersion, loaderVersion, versionId, progressCallback);
          if (quiltProfile) {
            moddedJson = quiltProfile;
            moddedJson.id = versionId;
            moddedJson.isolated = true;
            moddedJson.instanceDir = instanceDir;
            if (!moddedJson.inheritsFrom) moddedJson.inheritsFrom = mcVersion;
          }
        }

        if (isOptiFine && loaderVersion) {
          progressCallback({ stage: bt('stage_downloading_fabric'), progress: 30 });
          const optifineProfile = await this.downloadOptiFineProfile(mcVersion, loaderVersion, versionId, vanillaJson, progressCallback);
          if (optifineProfile) {
            moddedJson = optifineProfile;
            moddedJson.id = versionId;
            moddedJson.isolated = true;
            moddedJson.instanceDir = instanceDir;
            if (!moddedJson.inheritsFrom) moddedJson.inheritsFrom = mcVersion;
          }
        }

        if (!moddedJson) {
          const loaderName = isForge ? 'Forge' : isFabric ? 'Fabric' : isOptiFine ? 'OptiFine' : isNeoForge ? 'NeoForge' : 'Quilt';
          console.error(`Failed to download ${loaderName} profile for ${versionId}`);
          return { success: false, error: `Failed to download ${loaderName} profile for ${mcVersion}. Check your internet connection and try again.` };
        }

        await fs.writeJson(path.join(versionDir, `${versionId}.json`), moddedJson, { spaces: 2 });

        progressCallback({ stage: bt('stage_downloading_libs'), progress: 70 });
        try {
          const resolvedJson = await this.resolveVersion(versionId);
          await this.downloadMissingLibraries(resolvedJson);
        } catch (e) {
          console.warn('Failed to download mod loader libraries:', e.message);
        }

        progressCallback({ stage: bt('stage_install_complete'), progress: 100 });
        return { success: true };
      }

      const versionsManifest = await this.getCachedManifest('https://launchermeta.mojang.com/mc/game/version_manifest.json');
      const versionInfo = versionsManifest.versions.find(v => v.id === versionId);
      if (!versionInfo) throw new Error('Version not found');
      const versionManifest = await axios.get(versionInfo.url);
      const versionData = versionManifest.data;
      const versionDir = path.join(this.versionsDir, versionId);
      await fs.ensureDir(versionDir);
      await fs.writeJson(path.join(versionDir, `${versionId}.json`), versionData, { spaces: 2 });
      progressCallback({ stage: bt('stage_downloading_client'), progress: 20 });
      const clientJarPath = path.join(versionDir, `${versionId}.jar`);
      const clientHash = versionData.downloads.client.sha1;
      const clientExists = await fs.pathExists(clientJarPath);
      let clientValid = false;
      if (clientExists && clientHash) {
        clientValid = await this.verifyFileHash(clientJarPath, clientHash);
      }
      if (!clientValid) {
        await this.downloadWithResume(versionData.downloads.client.url, clientJarPath, (p) => {
          if (p.percentage) {
            progressCallback({ stage: bt('stage_downloading_client'), progress: 20 + p.percentage * 0.2 });
          }
        });
        if (clientHash) {
          const valid = await this.verifyFileHash(clientJarPath, clientHash);
          if (!valid) {
            await fs.remove(clientJarPath);
            await this.downloadWithResume(versionData.downloads.client.url, clientJarPath);
          }
        }
      }
      progressCallback({ stage: bt('stage_downloading_libs'), progress: 40 });
      const libraries = versionData.libraries || [];
      const libTasks = [];
      for (let i = 0; i < libraries.length; i++) {
        const library = libraries[i];
        if (library.downloads && library.downloads.artifact) {
          const artifact = library.downloads.artifact;
          const libPath = path.join(this.librariesDir, artifact.path);
          const libUrl = artifact.url;
          const libHash = artifact.sha1;
          libTasks.push(async () => {
            if (await fs.pathExists(libPath)) {
              if (libHash) {
                const valid = await this.verifyFileHash(libPath, libHash);
                if (valid) return { success: true, skipped: true };
                await fs.remove(libPath);
              } else {
                return { success: true, skipped: true };
              }
            }
            try {
              await this.downloadWithResume(libUrl, libPath);
              return { success: true };
            } catch (e) {
              return { success: false };
            }
          });
        }
      }
      let libCompleted = 0;
      for (let i = 0; i < libTasks.length; i += this.DOWNLOAD_CONCURRENCY) {
        const batch = libTasks.slice(i, i + this.DOWNLOAD_CONCURRENCY);
        await Promise.allSettled(batch.map(t => t()));
        libCompleted += batch.length;
        progressCallback({ stage: bt('stage_downloading_libs_progress', {current: libCompleted, total: libTasks.length}), progress: 40 + ((libCompleted / libTasks.length) * 20) });
      }
      for (const library of libraries) {
        if (library.downloads && library.downloads.classifiers) {
          const natives = library.downloads.classifiers;
          const nativeKey = 'natives-windows';
          if (natives[nativeKey]) {
            const nativePath = path.join(this.librariesDir, natives[nativeKey].path);
            if (!await fs.pathExists(nativePath)) {
              try {
                await this.downloadWithResume(natives[nativeKey].url, nativePath);
              } catch (e) {}
            }
          }
        }
      }
      progressCallback({ stage: bt('stage_downloading_assets'), progress: 60 });
      if (versionData.assetIndex) {
        const assetIndexUrl = versionData.assetIndex.url;
        const assetIndexData = await axios.get(assetIndexUrl);
        const assetIndexId = versionData.assetIndex.id;
        const indexesDir = path.join(this.assetsDir, 'indexes');
        await fs.ensureDir(indexesDir);
        await fs.writeJson(path.join(indexesDir, `${assetIndexId}.json`), assetIndexData.data, { spaces: 2 });
        const assets = assetIndexData.data.objects;
        const assetKeys = Object.keys(assets);
        let assetCount = 0;
        const concurrency = 20;
        const downloadAsset = async (key) => {
          const asset = assets[key];
          const hash = asset.hash;
          const hashPrefix = hash.substring(0, 2);
          const assetPath = path.join(this.assetsDir, 'objects', hashPrefix, hash);
          if (!await fs.pathExists(assetPath)) {
            try {
              await this.downloadWithResume(`https://resources.download.minecraft.net/${hashPrefix}/${hash}`, assetPath);
            } catch (e) {}
          } else if (hash) {
            const valid = await this.verifyFileHash(assetPath, hash);
            if (!valid) {
              await fs.remove(assetPath);
              try {
                await this.downloadWithResume(`https://resources.download.minecraft.net/${hashPrefix}/${hash}`, assetPath);
              } catch (e) {}
            }
          }
          assetCount++;
          if (assetCount % 50 === 0 || assetCount === assetKeys.length) {
            progressCallback({ stage: bt('stage_downloading_assets_progress', {current: assetCount, total: assetKeys.length}), progress: 60 + ((assetCount / assetKeys.length) * 30) });
          }
        };
        for (let i = 0; i < assetKeys.length; i += concurrency) {
          const batch = assetKeys.slice(i, i + concurrency);
          await Promise.all(batch.map(key => downloadAsset(key)));
        }
      }
      const instanceDir = path.join(this.instancesDir, versionId);
      await fs.ensureDir(instanceDir);
      await fs.ensureDir(path.join(instanceDir, 'saves'));
      await fs.ensureDir(path.join(instanceDir, 'resourcepacks'));
      await fs.ensureDir(path.join(instanceDir, 'screenshots'));
      await fs.ensureDir(path.join(instanceDir, 'logs'));
      progressCallback({ stage: bt('stage_complete'), progress: 100 });
      return { success: true };
    } catch (error) {
      console.error('Download error:', error);
      return { success: false, error: error.message };
    }
  }

  async getInstalledVersions() {
    try {
      const versions = await fs.readdir(this.versionsDir);
      const installedVersions = [];
      for (const version of versions) {
        const versionDir = path.join(this.versionsDir, version);

        const modpackJsonPath = path.join(versionDir, 'modpack.json');
        if (await fs.pathExists(modpackJsonPath)) {
          const versionJsonPath = path.join(versionDir, `${version}.json`);
          const jarPath = path.join(versionDir, `${version}.jar`);
          if (await fs.pathExists(versionJsonPath) && await fs.pathExists(jarPath)) {
            installedVersions.push(version);
          }
        } else {
          if (await this.isVersionFullyDownloaded(version)) {
            installedVersions.push(version);
          }
        }
      }
      return installedVersions;
    } catch (error) {
      return [];
    }
  }

  async scanModDependencies(modsDir, mcVersion, progressCallback) {
    const AdmZip = require('adm-zip');
    const results = { scanned: 0, missing: [], downloaded: [], errors: [] };

    if (!await fs.pathExists(modsDir)) return results;

    const files = await fs.readdir(modsDir);
    const modJars = files.filter(f => f.endsWith('.jar'));
    if (modJars.length === 0) return results;

    const existingModIds = new Set();
    const existingModSlugs = new Set();
    const dependencyMap = new Map();

    for (const jarFile of modJars) {
      results.scanned++;
      const jarPath = path.join(modsDir, jarFile);

      try {
        const zip = new AdmZip(jarPath);

        const fabricModEntry = zip.getEntry('fabric.mod.json');
        if (fabricModEntry) {
          try {
            const fabricJson = JSON.parse(zip.readFileSync(fabricModEntry).toString('utf8'));
            const modId = fabricJson.id;
            if (modId) {
              existingModIds.add(modId);
              existingModSlugs.add(modId);
            }
            const deps = { ...fabricJson.depends, ...fabricJson.recommends };
            for (const [depId, depInfo] of Object.entries(deps || {})) {
              if (depId === 'minecraft' || depId === 'java' || depId === 'fabricloader' || depId === 'fabric-api' || depId === 'quilt_loader') continue;
              if (!dependencyMap.has(depId)) {
                dependencyMap.set(depId, { source: modId || jarFile, constraint: depInfo, loader: 'fabric' });
              }
            }
          } catch (e) {}
        }

        const modsTomlEntry = zip.getEntry('META-INF/mods.toml');
        if (modsTomlEntry) {
          try {
            const tomlContent = zip.readFileSync(modsTomlEntry).toString('utf8');
            const modIdMatch = tomlContent.match(/modId\s*=\s*"?([^"\r\n]+)"?/);
            if (modIdMatch) {
              const modId = modIdMatch[1].trim();
              existingModIds.add(modId);
              existingModSlugs.add(modId);
            }
            const depMatches = tomlContent.match(/\[\[dependencies\.\w+\]\]\s*([\s\S]*?)(?=\[\[|\s*$)/g) || [];
            for (const depBlock of depMatches) {
              const depIdMatch = depBlock.match(/modId\s*=\s*"?([^"\r\n]+)"?/);
              const mandatoryMatch = depBlock.match(/mandatory\s*=\s*(true|false)/);
              if (depIdMatch) {
                const depId = depIdMatch[1].trim();
                if (depId === 'minecraft' || depId === 'java' || depId === 'forge' || depId === 'neoforge' || depId === 'fabricloader') continue;
                const mandatory = mandatoryMatch ? mandatoryMatch[1] === 'true' : true;
                if (!dependencyMap.has(depId)) {
                  dependencyMap.set(depId, { source: modIdMatch ? modIdMatch[1].trim() : jarFile, mandatory, loader: 'forge' });
                }
              }
            }
          } catch (e) {}
        }

        const mcmodEntry = zip.getEntry('mcmod.info');
        if (mcmodEntry) {
          try {
            const mcmodJson = JSON.parse(zip.readFileSync(mcmodEntry).toString('utf8'));
            const modInfo = Array.isArray(mcmodJson) ? mcmodJson[0] : mcmodJson;
            if (modInfo && modInfo.modid) {
              existingModIds.add(modInfo.modid);
              existingModSlugs.add(modInfo.modid);
            }
            if (modInfo && modInfo.dependencies) {
              for (const depId of modInfo.dependencies) {
                if (depId === 'minecraft' || depId === 'forge') continue;
                if (!dependencyMap.has(depId)) {
                  dependencyMap.set(depId, { source: modInfo.modid || jarFile, loader: 'forge' });
                }
              }
            }
          } catch (e) {}
        }

        const neoforgeTomlEntry = zip.getEntry('META-INF/neoforge.mods.toml');
        if (neoforgeTomlEntry) {
          try {
            const tomlContent = zip.readFileSync(neoforgeTomlEntry).toString('utf8');
            const modIdMatch = tomlContent.match(/modId\s*=\s*"?([^"\r\n]+)"?/);
            if (modIdMatch) {
              existingModIds.add(modIdMatch[1].trim());
              existingModSlugs.add(modIdMatch[1].trim());
            }
            const depMatches = tomlContent.match(/\[\[dependencies\.\w+\]\]\s*([\s\S]*?)(?=\[\[|\s*$)/g) || [];
            for (const depBlock of depMatches) {
              const depIdMatch = depBlock.match(/modId\s*=\s*"?([^"\r\n]+)"?/);
              if (depIdMatch) {
                const depId = depIdMatch[1].trim();
                if (depId === 'minecraft' || depId === 'java' || depId === 'neoforge' || depId === 'forge' || depId === 'fabricloader') continue;
                if (!dependencyMap.has(depId)) {
                  dependencyMap.set(depId, { source: modIdMatch ? modIdMatch[1].trim() : jarFile, loader: 'neoforge' });
                }
              }
            }
          } catch (e) {}
        }

        const quiltModEntry = zip.getEntry('quilt.mod.json');
        if (quiltModEntry) {
          try {
            const quiltJson = JSON.parse(zip.readFileSync(quiltModEntry).toString('utf8'));
            const quiltDeps = quiltJson.quilt_loader?.metadata || {};
            if (quiltDeps.id) {
              existingModIds.add(quiltDeps.id);
              existingModSlugs.add(quiltDeps.id);
            }
            const depends = quiltJson.quilt_loader?.depends || {};
            for (const [depId, depInfo] of Object.entries(depends)) {
              if (depId === 'minecraft' || depId === 'java' || depId === 'quilt_loader' || depId === 'fabricloader') continue;
              if (!dependencyMap.has(depId)) {
                dependencyMap.set(depId, { source: quiltDeps.id || jarFile, loader: 'quilt' });
              }
            }
          } catch (e) {}
        }

      } catch (e) {}
    }

    const missingDeps = [];
    for (const [depId, depInfo] of dependencyMap.entries()) {
      if (!existingModIds.has(depId) && !existingModSlugs.has(depId)) {
        missingDeps.push({ id: depId, ...depInfo });
      }
    }
    results.missing = missingDeps;

    if (missingDeps.length === 0) return results;

    progressCallback({ stage: bt('stage_downloading_libs'), progress: 0, detail: `Found ${missingDeps.length} missing dependencies` });

    const searchModrinth = async (depId, loader) => {
      try {
        const params = new URLSearchParams();
        let facets = [['project_type:mod']];
        if (mcVersion) {
          const baseVersion = mcVersion.replace(/^(\d+\.\d+(?:\.\d+)?).*/, '$1');
          facets.push([`versions:${baseVersion}`]);
        }
        if (loader) {
          const loaderLower = loader.toLowerCase();
          if (['fabric', 'forge', 'neoforge', 'quilt'].includes(loaderLower)) {
            facets.push([`categories:${loaderLower}`]);
          }
        }
        params.append('query', depId);
        params.append('facets', JSON.stringify(facets));
        params.append('limit', '5');

        const response = await axios.get(`https://api.modrinth.com/v2/search?${params.toString()}`, {
          headers: { 'User-Agent': 'ECHO-Launcher/1.0.0' },
          timeout: 10000
        });

        const hits = response.data.hits || [];
        const exactMatch = hits.find(h =>
          h.slug === depId || h.title.toLowerCase() === depId.toLowerCase() ||
          (h.slug && h.slug.replace(/-/g, '') === depId.replace(/[-_]/g, ''))
        );
        return exactMatch || hits[0] || null;
      } catch (e) {
        return null;
      }
    };

    const downloadMod = async (dep) => {
      try {
        const project = await searchModrinth(dep.id, dep.loader);
        if (!project) return null;

        const versionParams = new URLSearchParams();
        if (mcVersion) {
          const baseVersion = mcVersion.replace(/^(\d+\.\d+(?:\.\d+)?).*/, '$1');
          versionParams.append('game_versions', `["${baseVersion}"]`);
        }
        if (dep.loader) {
          versionParams.append('loaders', `["${dep.loader.toLowerCase()}"]`);
        }

        const versionsResponse = await axios.get(
          `https://api.modrinth.com/v2/project/${project.project_id}/version?${versionParams.toString()}`,
          { headers: { 'User-Agent': 'ECHO-Launcher/1.0.0' }, timeout: 10000 }
        );

        const versions = versionsResponse.data || [];
        if (versions.length === 0) return null;

        const bestVersion = versions[0];
        const file = bestVersion.files.find(f => f.file_type === 'release') || bestVersion.files[0];
        if (!file) return null;

        const fileName = file.filename || `${project.slug}-${bestVersion.version_number}.jar`;
        const filePath = path.join(modsDir, fileName);

        if (await fs.pathExists(filePath)) return null;

        await this.downloadWithResume(file.url, filePath);
        return { depId: dep.id, project: project.title, file: fileName };
      } catch (e) {
        return null;
      }
    };

    const batchSize = 6;
    let completed = 0;
    for (let i = 0; i < missingDeps.length; i += batchSize) {
      const batch = missingDeps.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map(dep => downloadMod(dep)));
      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value) {
          results.downloaded.push(r.value);
        }
      }
      completed += batch.length;
      progressCallback({ stage: bt('stage_downloading_libs'), progress: Math.round((completed / missingDeps.length) * 100), detail: `Downloaded ${results.downloaded.length}/${missingDeps.length} dependencies` });
    }

    return results;
  }

  async launchGame(config) {
    const { version, username, memory, isolated = false, optimizationProfile = 'balanced', selectedGPU = 0, elyAuth = null, preferredJava = null } = config;

    const versionDir = path.join(this.versionsDir, version);
    const modpackJsonPath = path.join(versionDir, 'modpack.json');
    const isModpack = await fs.pathExists(modpackJsonPath);

    if (!await this.isVersionFullyDownloaded(version)) throw new Error('Version not fully downloaded');
    const resolvedJson = await this.resolveVersion(version);
    await this.downloadMissingLibraries(resolvedJson);
    let instanceDir;

    if (isModpack) {
      instanceDir = versionDir;
    } else if (isolated) {
      instanceDir = path.join(this.instancesDir, version);
    } else {
      instanceDir = this.minecraftDir;
    }

    await fs.ensureDir(instanceDir);
    await fs.ensureDir(path.join(instanceDir, 'saves'));
    await fs.ensureDir(path.join(instanceDir, 'resourcepacks'));
    await fs.ensureDir(path.join(instanceDir, 'screenshots'));
    await fs.ensureDir(path.join(instanceDir, 'logs'));
    const isForge = version.includes('-forge-');
    const isFabric = version.includes('-fabric-');
    const isOptiFine = version.includes('-optifine-');
    const isNeoForge = version.includes('-neoforge-');
    const isQuilt = version.includes('-quilt-');
    if (isForge || isFabric || isOptiFine || isNeoForge || isQuilt) {
      await fs.ensureDir(path.join(instanceDir, 'mods'));
      await fs.ensureDir(path.join(instanceDir, 'config'));
      await fs.ensureDir(path.join(instanceDir, 'shaderpacks'));

      const modsDir = path.join(instanceDir, 'mods');
      const mcVersion = version.split('-')[0];
      try {
        const depResult = await this.scanModDependencies(modsDir, mcVersion, (p) => {
          if (p.detail) console.log(`Dependency check: ${p.detail}`);
        });
        if (depResult.downloaded.length > 0) {
          console.log(`Auto-downloaded ${depResult.downloaded.length} missing mod dependencies:`);
          for (const d of depResult.downloaded) {
            console.log(`  + ${d.project} (${d.file}) for dep "${d.depId}"`);
          }
        }
        if (depResult.missing.length > 0 && depResult.downloaded.length < depResult.missing.length) {
          const stillMissing = depResult.missing.filter(m => !depResult.downloaded.find(d => d.depId === m.id));
          if (stillMissing.length > 0) {
            console.warn(`Could not find on Modrinth: ${stillMissing.map(m => m.id).join(', ')}`);
          }
        }
      } catch (e) {
        console.warn('Mod dependency check failed (non-critical):', e.message);
      }
    }
    const skinPath = path.join(this.minecraftDir, 'skin.png');
    if (!await fs.pathExists(skinPath) && elyAuth && elyAuth.skin) {
      try {
        const base64Data = elyAuth.skin.replace(/^data:image\/png;base64,/, '');
        await fs.writeFile(skinPath, base64Data, 'base64');
      } catch (e) {
        console.warn('Failed to save skin from account data:', e.message);
      }
    }
    if (await fs.pathExists(skinPath)) {
      const assetsSkinsDir = path.join(instanceDir, 'assets', 'skins');
      await fs.ensureDir(assetsSkinsDir);
      await fs.copy(skinPath, path.join(assetsSkinsDir, `${username}.png`));
    }
    let libraries = [];
    for (const library of resolvedJson.libraries || []) {
      const libName = library.name || '';
      const isNativeLib = libName.match(/:natives-/) || (libName.match(/:(natives-windows|natives-linux|natives-macos)/));
      if (isNativeLib) continue;
      let libPath = null;
      if (library.downloads && library.downloads.artifact) libPath = path.join(this.librariesDir, library.downloads.artifact.path);
      else if (library.name) {
        const parts = library.name.split(':');
        if (parts.length >= 3) {
          const [group, artifact, libVersion] = parts;
          const groupPath = group.replace(/\./g, path.sep);
          const jarName = `${artifact}-${libVersion}.jar`;
          libPath = path.join(this.librariesDir, groupPath, artifact, libVersion, jarName);
        }
      }
      if (libPath && await fs.pathExists(libPath)) libraries.push(libPath);
    }
    const jarPath = path.join(this.versionsDir, version, `${version}.jar`);
    // For Forge/NeoForge we should NOT add jarPath to classpath; it will be added via -p later.
    if (!(isForge || isNeoForge)) {
      libraries.push(jarPath);
    }

    const seen = new Set();
    const uniqueLibraries = [];
    for (const libPath of libraries) {
      const relative = path.relative(this.librariesDir, libPath);
      const parts = relative.split(path.sep);
      if (parts.length >= 4) {
        const group = parts.slice(0, -3).join('.');
        const artifact = parts[parts.length - 3];
        const key = `${group}:${artifact}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueLibraries.push(libPath);
        }
      } else {
        uniqueLibraries.push(libPath);
      }
    }
    libraries = uniqueLibraries;

    const classpath = libraries.join(path.delimiter);

    const nativesDir = path.join(this.minecraftDir, 'natives', `${version}-${Date.now()}`);
    await fs.ensureDir(nativesDir);
    const nativeLibs = [];
    for (const library of resolvedJson.libraries || []) {
      const libName = library.name || '';
      const isNativeWindows = libName.endsWith(':natives-windows') || libName.endsWith(':natives-windows-arm64') || libName.endsWith(':natives-windows-x86');
      let nativeJarPath = null;
      if (isNativeWindows && library.downloads && library.downloads.artifact && library.downloads.artifact.path) {
        nativeJarPath = path.join(this.librariesDir, library.downloads.artifact.path);
      } else if (isNativeWindows && library.downloads && library.downloads.classifiers) {
        const nativeKey = 'natives-windows';
        if (library.downloads.classifiers[nativeKey]) {
          nativeJarPath = path.join(this.librariesDir, library.downloads.classifiers[nativeKey].path);
        }
      } else if (library.downloads && library.downloads.classifiers) {
        const nativeKey = 'natives-windows';
        if (library.downloads.classifiers[nativeKey]) {
          nativeJarPath = path.join(this.librariesDir, library.downloads.classifiers[nativeKey].path);
        }
      }
      if (nativeJarPath && await fs.pathExists(nativeJarPath)) {
        nativeLibs.push({ name: libName, path: nativeJarPath });
      } else if (isNativeWindows) {
        console.warn(`Native JAR missing: ${libName} at ${nativeJarPath}`);
      }
    }
    for (const nativeLib of nativeLibs) {
      try {
        await extract(nativeLib.path, { dir: nativesDir });
        console.log(`Extracted native: ${nativeLib.name}`);
      } catch (e) {
        console.warn(`Failed to extract native ${nativeLib.name}:`, e.message);
      }
    }
    async function findNativeFiles(dir, ext) {
      const results = [];
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results.push(...await findNativeFiles(full, ext));
        else if (entry.name.endsWith(ext)) results.push(full);
      }
      return results;
    }
    for (const ext of ['.dll', '.so', '.dylib']) {
      const files = await findNativeFiles(nativesDir, ext);
      for (const filePath of files) {
        const target = path.join(nativesDir, path.basename(filePath));
        if (filePath !== target) await fs.copy(filePath, target, { overwrite: true });
      }
      if (files.length) console.log(`Flattened ${files.length} native ${ext} files to root`);
    }
    const extractedNativeFiles = await fs.readdir(nativesDir).catch(() => []);
    const dllFiles = extractedNativeFiles.filter(f => f.endsWith('.dll'));
    console.log(`Natives directory (${nativesDir}): ${extractedNativeFiles.length} files, ${dllFiles.length} DLLs at root`);
    if (dllFiles.length > 0) console.log(`DLLs: ${dllFiles.join(', ')}`);
    else console.warn('WARNING: No DLLs found at natives root! LWJGL will fail to load.');
    await this.downloadAuthlibInjector();

    const mcVersion = version.split('-')[0];
    const loaderVersion = version.split('-').length > 2 ? version.split('-')[2] : '';
    let javaPath = null;

    if (preferredJava) {
      const requiredJava = this.javaManager.getJavaVersionForMinecraft(mcVersion);
      if (preferredJava !== requiredJava) {
        console.warn(`Preferred Java ${preferredJava} is incompatible with MC ${mcVersion} (needs Java ${requiredJava}), falling back to auto-detection`);
      } else {
        console.log(`User preferred Java ${preferredJava} specified`);
        javaPath = await this.javaManager.getJavaExecutable(preferredJava);

        if (javaPath) {
          console.log(`Using preferred Java ${preferredJava}: ${javaPath}`);
        } else {
          console.warn(`Preferred Java ${preferredJava} not found, falling back to auto-detection`);
        }
      }
    }

    if (!javaPath) {
      javaPath = await this.javaManager.getJavaForMinecraft(mcVersion);
    }

    if (!javaPath) {
      console.log(`Required Java not found for Minecraft ${mcVersion}, attempting to download...`);
      const requiredJavaVersion = this.javaManager.getJavaVersionForMinecraft(mcVersion);

      try {
        const downloadResult = await this.javaManager.downloadJava(requiredJavaVersion, (progress) => {
          console.log(`Java download: ${progress.message}`);
        });

        if (downloadResult.success) {
          javaPath = await this.javaManager.getJavaForMinecraft(mcVersion);
        }
      } catch (downloadError) {
        console.warn(`Failed to download Java ${requiredJavaVersion}:`, downloadError);
      }

      if (!javaPath) {
        const systemJava = await this.javaManager.getSystemJava();
        const requiredVersion = this.javaManager.getJavaVersionForMinecraft(mcVersion);

        if (systemJava && systemJava.version === requiredVersion) {
          console.log(`Using system Java ${systemJava.version}`);
          javaPath = 'java';
        } else if (systemJava) {
          console.warn(`System Java ${systemJava.version} is incompatible with MC ${mcVersion} (needs Java ${requiredVersion}). Cannot launch.`);
          throw new Error(`Java ${requiredVersion} is required for Minecraft ${mcVersion}, but only Java ${systemJava.version} is available. Please install Java ${requiredVersion}.`);
        } else {
          console.warn(`Java ${requiredVersion} not found and no system Java available`);
          throw new Error(`Java ${requiredVersion} is required for Minecraft ${mcVersion}. Please install Java ${requiredVersion}.`);
        }
      }
    }

    console.log(`Using Java: ${javaPath}`);

    try {
      console.log('Applying GPU settings for Java...');
      const gpuResult = await this.gpuSettings.setJavaGPUPreference(javaPath, 'high-performance');
      if (gpuResult.success) {
        console.log('GPU settings applied: High Performance mode enabled for Java');
      } else {
        console.warn('Failed to apply GPU settings:', gpuResult.error);
      }
    } catch (gpuError) {
      console.warn('GPU settings error (non-critical):', gpuError.message);
    }

    const optimizationArgs = this.getOptimizationArgs(optimizationProfile, memory);
    let authlibArgs = [];
    if (await fs.pathExists(this.authlibPath)) authlibArgs = [`-javaagent:${this.authlibPath}=ely.by`];

    // Извлекаем JVM аргументы из version JSON с фильтрацией по правилам
    let loaderJvmArgs = [];
    const versionJvmArgs = resolvedJson.arguments?.jvm || [];
    const currentOS = os.platform() === 'win32' ? 'windows' : os.platform() === 'darwin' ? 'macos' : 'linux';

    for (const arg of versionJvmArgs) {
      if (typeof arg === 'string') {
        // Строковые аргументы применяются всегда, но мы отфильтруем macOS-специфичные позже
        loaderJvmArgs.push(arg);
      } else if (arg.rules) {
        // Проверяем правила
        let applicable = false;
        // Найдём первое подходящее правило по OS
        for (const rule of arg.rules) {
          if (rule.os && rule.os.name) {
            if (rule.os.name === currentOS) {
              applicable = (rule.action === 'allow');
              break;
            }
          }
        }
        // Если нет правила, совпадающего с OS, то по умолчанию не применимо
        if (applicable && arg.value) {
          const values = Array.isArray(arg.value) ? arg.value : [arg.value];
          for (const v of values) {
            let resolved = v
              .replace(/\$\{library_directory\}/g, this.librariesDir)
              .replace(/\$\{classpath_separator\}/g, path.delimiter)
              .replace(/\$\{version_name\}/g, version)
              .replace(/\$\{natives_directory\}/g, nativesDir)
              .replace(/\$\{user_properties\}/g, '{}');
            loaderJvmArgs.push(resolved);
          }
        }
      }
    }

    // Фильтруем явно macOS-специфичные аргументы, которые могли остаться как строки
    if (currentOS === 'windows') {
      loaderJvmArgs = loaderJvmArgs.filter(arg => !arg.includes('-XstartOnFirstThread'));
    }

    // Заменяем ${classpath} в loaderJvmArgs на реальный classpath
    loaderJvmArgs = loaderJvmArgs.map(a => {
      if (a.includes('${classpath}')) return a.replace(/\$\{classpath\}/g, classpath);
      if (a === '${classpath}') return classpath;
      return a;
    });

    // Убираем -cp и следующий за ним аргумент из loaderJvmArgs,
    // но оставляем -p и другие аргументы нетронутыми.
    let filteredLoaderJvmArgs = [];
    for (let i = 0; i < loaderJvmArgs.length; i++) {
      const arg = loaderJvmArgs[i];
      if (arg === '-cp') {
        // Пропускаем этот аргумент и следующий (путь к classpath)
        i++; // пропускаем следующий
        continue;
      }
      filteredLoaderJvmArgs.push(arg);
    }
    loaderJvmArgs = filteredLoaderJvmArgs;

    // Также удаляем длинные строки, содержащие path.delimiter, которые могут быть classpath
    loaderJvmArgs = loaderJvmArgs.filter(a => !(a.includes(path.delimiter) && a.length > 500));

    // Определяем, есть ли уже -p
    const hasModulePath = loaderJvmArgs.some(a => a === '-p');
    const hasAddModules = loaderJvmArgs.some(a => a.startsWith('--add-modules='));

    // Формируем финальные JVM аргументы
    let jvmArgs = [
      `-Xmx${memory}M`,
      `-Xms${Math.floor(memory / 2)}M`,
      ...optimizationArgs,
      '-Dlog4j2.level=warn',
      ...authlibArgs,
      ...loaderJvmArgs
    ];

    // Добавляем java.library.path, если его нет
    if (!loaderJvmArgs.some(a => a.startsWith('-Djava.library.path='))) {
      jvmArgs.push(`-Djava.library.path=${nativesDir}`);
    }
    if (!loaderJvmArgs.some(a => a.startsWith('-Dorg.lwjgl.librarypath='))) {
      jvmArgs.push(`-Dorg.lwjgl.librarypath=${nativesDir}`);
    }
    if (!loaderJvmArgs.some(a => a.includes('allowSoftwareOpenGL'))) {
      jvmArgs.push('-Dorg.lwjgl.opengl.Display.allowSoftwareOpenGL=false');
    }
    if (selectedGPU > 0) {
      jvmArgs.push('-Dprism.order=d3d');
    }

    // Для Forge/NeoForge нужно добавить модульный путь с mapped классами
    if (isForge || isNeoForge) {
      // Находим forge-client.jar (содержит mapped net/minecraft/client/Minecraft.class)
      const forgeClientLib = (resolvedJson.libraries || []).find(l =>
        l.name && l.name.includes(':forge:') && l.name.endsWith(':client') &&
        l.downloads && l.downloads.artifact
      );
      if (forgeClientLib) {
        const forgeClientPath = path.join(this.librariesDir, forgeClientLib.downloads.artifact.path);
        const moduleJarPath = path.join(versionDir, 'forge-client-module.jar');
        await fs.copy(forgeClientPath, moduleJarPath, { overwrite: true });
        // Добавляем module-info.class чтобы Java воспринимала JAR как модуль
        const { execSync } = require('child_process');
        const tmpDir = path.join(os.tmpdir(), `mc-module-${Date.now()}`);
        await fs.ensureDir(tmpDir);
        try {
          await fs.writeFile(path.join(tmpDir, 'module-info.java'), 'module client {}');
          execSync(`javac "${path.join(tmpDir, 'module-info.java')}"`, { cwd: tmpDir, stdio: 'ignore' });
          execSync(`jar uf "${moduleJarPath}" -C "${tmpDir}" module-info.class`, { stdio: 'ignore' });
          console.log('Injected module-info.class into forge-client JAR for module path');
        } catch (e) {
          console.warn('Failed to create module-info.class:', e.message);
        } finally {
          await fs.remove(tmpDir).catch(() => {});
        }
        if (!hasModulePath) {
          jvmArgs.push('-p', moduleJarPath);
        }
      } else {
        console.warn('Forge client library not found, skipping -p module path');
      }
      if (!hasAddModules) {
        jvmArgs.push('--add-modules=ALL-MODULE-PATH');
      }
    }

    // Добавляем -cp и classpath в самом конце (после модульных аргументов)
    jvmArgs.push('-cp', classpath);

    const assetIndexId = resolvedJson.assetIndex?.id || resolvedJson.assets || version.split('-')[0];
    const mainClass = resolvedJson.mainClass;
    if (!mainClass) throw new Error('No main class found');
    const playerUUID = elyAuth && elyAuth.uuid ? elyAuth.uuid.replace(/-/g, '') : this.generateUUID();
    const accessToken = elyAuth && elyAuth.accessToken ? elyAuth.accessToken : 'null';
    const userType = elyAuth ? 'msa' : 'legacy';

    // Извлекаем game args из version JSON (Forge/NeoForge уже содержат --launchTarget, --fml.* и т.д.)
    let loaderGameArgs = [];
    const versionGameArgs = resolvedJson.arguments?.game || [];
    for (const arg of versionGameArgs) {
      if (typeof arg === 'string') {
        let resolved = arg
          .replace(/\$\{auth_player_name\}/g, username)
          .replace(/\$\{auth_session\}/g, accessToken)
          .replace(/\$\{user_properties\}/g, '{}')
          .replace(/\$\{version_name\}/g, version)
          .replace(/\$\{game_directory\}/g, instanceDir)
          .replace(/\$\{assets_root\}/g, this.assetsDir)
          .replace(/\$\{assets_index_name\}/g, assetIndexId)
          .replace(/\$\{auth_uuid\}/g, playerUUID)
          .replace(/\$\{auth_access_token\}/g, accessToken)
          .replace(/\$\{resolution_width\}/g, '854')
          .replace(/\$\{resolution_height\}/g, '480')
          .replace(/\$\{resolution_scale\}/g, '1')
          .replace(/\${clientid}/g, '')
          .replace(/\${auth_xuid}/g, '')
          .replace(/\$\{user_type\}/g, userType)
          .replace(/\$\{version_type\}/g, isForge ? 'forge' : isFabric ? 'fabric' : isOptiFine ? 'optifine' : isNeoForge ? 'neoforge' : isQuilt ? 'quilt' : 'release')
          .replace(/\$\{quickPlayPath\}/g, '')
          .replace(/\$\{quickPlaySingleplayer\}/g, '')
          .replace(/\$\{quickPlayMultiplayer\}/g, '')
          .replace(/\$\{quickPlayRealms\}/g, '');
        loaderGameArgs.push(resolved);
      } else if (arg.rules) {
        let applicable = false;
        for (const rule of arg.rules) {
          if (rule.os && rule.os.name) {
            if (rule.os.name === currentOS) {
              applicable = (rule.action === 'allow');
              break;
            }
          }
        }
        if (applicable && arg.value) {
          const values = Array.isArray(arg.value) ? arg.value : [arg.value];
          for (const v of values) {
            let resolved = v
              .replace(/\$\{auth_player_name\}/g, username)
              .replace(/\$\{auth_session\}/g, accessToken)
              .replace(/\$\{version_name\}/g, version)
              .replace(/\$\{game_directory\}/g, instanceDir)
              .replace(/\$\{assets_root\}/g, this.assetsDir)
              .replace(/\$\{assets_index_name\}/g, assetIndexId)
              .replace(/\$\{auth_uuid\}/g, playerUUID)
              .replace(/\$\{auth_access_token\}/g, accessToken)
              .replace(/\$\{resolution_width\}/g, '854')
              .replace(/\$\{resolution_height\}/g, '480')
              .replace(/\$\{resolution_scale\}/g, '1')
              .replace(/\$\{user_type\}/g, userType)
              .replace(/\$\{version_type\}/g, isForge ? 'forge' : isFabric ? 'fabric' : isOptiFine ? 'optifine' : isNeoForge ? 'neoforge' : isQuilt ? 'quilt' : 'release')
              .replace(/\$\{quickPlayPath\}/g, '')
              .replace(/\$\{quickPlaySingleplayer\}/g, '')
              .replace(/\$\{quickPlayMultiplayer\}/g, '')
              .replace(/\$\{quickPlayRealms\}/g, '');
            loaderGameArgs.push(resolved);
          }
        }
      }
    }

    // Всегда добавляем стандартные Minecraft аргументы + аргументы из JSON
    const standardArgs = [
      '--username', username,
      '--version', version,
      '--gameDir', instanceDir,
      '--assetsDir', this.assetsDir,
      '--assetIndex', assetIndexId,
      '--uuid', playerUUID,
      '--accessToken', accessToken,
      '--userType', userType,
      '--versionType', isForge ? 'forge' : isFabric ? 'fabric' : isOptiFine ? 'optifine' : isNeoForge ? 'neoforge' : isQuilt ? 'quilt' : 'release',
    ];
    const gameArgs = [...loaderGameArgs, ...standardArgs.filter(a => !loaderGameArgs.includes(a))];
    // Добавляем --launchTarget если ещё нет
    if ((isForge || isNeoForge) && !gameArgs.some(a => a === '--launchTarget')) {
      gameArgs.push('--launchTarget', 'fmlclient');
    }
    let allArgs = [...jvmArgs, mainClass, ...gameArgs];
    console.log('Launching:', version);
    console.log('Java path:', javaPath);
    console.log('Classpath entries:', libraries.length);
    console.log('Classpath length:', classpath.length);
    console.log('Has bootstrap:', classpath.includes('bootstrap'));
    console.log('Has ForgeBootstrap mainClass:', mainClass);
    const bootstrapIdx = classpath.indexOf('bootstrap');
    if (bootstrapIdx >= 0) {
      console.log('Bootstrap in classpath at pos:', bootstrapIdx, 'context:', classpath.substring(Math.max(0, bootstrapIdx - 30), bootstrapIdx + 60));
    } else {
      console.log('WARNING: bootstrap NOT found in classpath!');
      console.log('Classpath preview:', classpath.substring(0, 200));
    }

    // Если командная строка слишком длинная (>8000 символов), используем argfile
    const estimatedLength = allArgs.reduce((sum, a) => sum + a.length + 1, 0) + javaPath.length;
    console.log('Estimated command line length:', estimatedLength, 'args:', allArgs.length);
    let useArgFile = false;
    let argFilePath = null;
    if (estimatedLength > 8000) {
      console.log(`Command line too long (${estimatedLength} chars), using argfile`);
      useArgFile = true;
      argFilePath = path.join(instanceDir, `.jvm_args_${Date.now()}.txt`);
      const argFileContent = allArgs.map(a => {
        if (a.includes(' ') || a.includes('"')) {
          return `"${a.replace(/"/g, '""')}"`;
        }
        return a;
      }).join('\n');
      await fs.writeFile(argFilePath, argFileContent, 'utf-8');
      allArgs = [`@${argFilePath}`];
    }

    const gameProcess = spawn(javaPath, allArgs, {
      cwd: instanceDir,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    try {
      const { spawn: spawnChild } = require('child_process');
      const priorityProc = spawnChild('powershell', [
        '-NoProfile', '-Command',
        `Get-Process -Id ${gameProcess.pid} -ErrorAction SilentlyContinue | ForEach-Object { $_.PriorityClass = 'High' }`
      ], { timeout: 5000, stdio: 'ignore' });
      priorityProc.on('error', () => {});
      priorityProc.unref();
    } catch (e) {}
    gameProcess.on('error', (error) => console.error('Failed to start game:', error));
    gameProcess.on('exit', (code) => {
      console.log(`Game exited with code ${code}`);
      setTimeout(async () => {
        try { await fs.remove(nativesDir); } catch (err) { console.warn('Failed to clean natives:', err); }
        if (argFilePath) {
          try { await fs.remove(argFilePath); } catch (err) {}
        }
      }, 5000);
    });
    gameProcess.unref();
    let stderrBuffer = '';
    gameProcess.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('Error') || text.includes('Exception') || text.includes('error')) {
        console.error('[GAME STDOUT]', text.trim());
      }
    });
    gameProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderrBuffer += text;
      if (stderrBuffer.length > 10240) stderrBuffer = stderrBuffer.slice(-10240);
      console.error('[GAME STDERR]', text.trim());
    });
    gameProcess.on('close', (code) => {
      if (code !== 0 && stderrBuffer) {
        console.error('Game crash details:', stderrBuffer.substring(0, 2000));
      }
    });
    return { success: true, pid: gameProcess.pid, process: gameProcess };
  }

  getOptimizationArgs(profile, memory) {
    const os = require('os');
    const cores = os.cpus().length;
    const phys = Math.max(2, Math.floor(cores / 2));

    if (profile === 'performance') {
      return [
        '-XX:+UseG1GC',
        '-XX:+UnlockExperimentalVMOptions',
        '-XX:MaxGCPauseMillis=50',
        `-XX:ParallelGCThreads=${phys}`,
        `-XX:ConcGCThreads=${Math.max(1, Math.floor(phys / 4))}`,
        '-XX:G1NewSizePercent=30',
        '-XX:G1ReservePercent=20',
        '-XX:G1HeapRegionSize=16M',
        '-XX:G1HeapWastePercent=5',
        '-XX:G1MixedGCCountTarget=4',
        '-XX:InitiatingHeapOccupancyPercent=40',
        '-XX:SurvivorRatio=32',
        '-XX:MaxTenuringThreshold=1',
        '-XX:+ParallelRefProcEnabled',
        '-XX:+DisableExplicitGC',
        `-XX:ActiveProcessorCount=${cores}`
      ];
    } else if (profile === 'potato') {
      return [
        '-XX:+UseG1GC',
        '-XX:+UnlockExperimentalVMOptions',
        '-XX:MaxGCPauseMillis=100',
        `-XX:ParallelGCThreads=${Math.max(1, Math.floor(phys / 2))}`,
        '-XX:G1NewSizePercent=20',
        '-XX:G1ReservePercent=20',
        '-XX:InitiatingHeapOccupancyPercent=45',
        `-XX:ActiveProcessorCount=${cores}`
      ];
    } else {
      return [
        '-XX:+UseG1GC',
        '-XX:+UnlockExperimentalVMOptions',
        '-XX:MaxGCPauseMillis=50',
        `-XX:ParallelGCThreads=${phys}`,
        `-XX:ConcGCThreads=${Math.max(1, Math.floor(phys / 4))}`,
        '-XX:G1NewSizePercent=30',
        '-XX:G1ReservePercent=20',
        '-XX:G1HeapRegionSize=16M',
        '-XX:G1HeapWastePercent=5',
        '-XX:G1MixedGCCountTarget=4',
        '-XX:InitiatingHeapOccupancyPercent=40',
        '-XX:SurvivorRatio=32',
        '-XX:MaxTenuringThreshold=1',
        '-XX:+ParallelRefProcEnabled',
        `-XX:ActiveProcessorCount=${cores}`
      ];
    }
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async getConfig() {
    try {
      if (await fs.pathExists(this.configPath)) return await fs.readJson(this.configPath);
    } catch (error) {}
    return { username: 'Player', memory: 2048, lastVersion: null };
  }

  async saveConfig(config) {
    try {
      await fs.writeJson(this.configPath, config, { spaces: 2 });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = MinecraftLauncher;