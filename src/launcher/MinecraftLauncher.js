const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
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

    this.initDirectories();
  }

  async initDirectories() {
    await fs.ensureDir(this.minecraftDir);
    await fs.ensureDir(this.versionsDir);
    await fs.ensureDir(this.librariesDir);
    await fs.ensureDir(this.assetsDir);
    await fs.ensureDir(this.instancesDir);
  }

  async downloadAuthlibInjector() {
    if (await fs.pathExists(this.authlibPath)) return;
    try {
      console.log('Downloading authlib-injector...');
      const response = await axios.get('https://authlib-injector.yushi.moe/artifact/latest.json');
      const downloadUrl = response.data.download_url;
      const fileResponse = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
      await fs.writeFile(this.authlibPath, fileResponse.data);
      console.log('authlib-injector downloaded');
    } catch (error) {
      console.error('Failed to download authlib-injector:', error);
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
            const jarName = `${artifact}-${version}.jar`;
            const libPath = path.join(this.librariesDir, groupPath, artifact, version, jarName);
            if (!await fs.pathExists(libPath)) {
              await fs.ensureDir(path.dirname(libPath));
              try {
                const libUrl = `${library.url}${groupPath}/${artifact}/${version}/${jarName}`;
                const libData = await axios.get(libUrl, { responseType: 'arraybuffer', timeout: 30000 });
                await fs.writeFile(libPath, libData.data);
              } catch (e) {}
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

  getLibraryKey(lib) {
    if (lib.name) return lib.name;
    if (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.path) return lib.downloads.artifact.path;
    return JSON.stringify(lib);
  }

  async resolveVersion(versionId) {
    const versionJsonPath = path.join(this.versionsDir, versionId, `${versionId}.json`);
    if (!await fs.pathExists(versionJsonPath)) {
      throw new Error(`Version ${versionId} not found`);
    }
    const versionJson = await fs.readJson(versionJsonPath);
    return this.mergeVersion(versionJson);
  }

  async mergeVersion(json) {
    let result = { ...json };
    let current = json;
    const processedParents = new Set();
    while (current.inheritsFrom && !processedParents.has(current.inheritsFrom)) {
      const parentId = current.inheritsFrom;
      processedParents.add(parentId);
      const parentJsonPath = path.join(this.versionsDir, parentId, `${parentId}.json`);
      if (!await fs.pathExists(parentJsonPath)) break;
      const parentJson = await fs.readJson(parentJsonPath);
      const existingKeys = new Set((result.libraries || []).map(lib => this.getLibraryKey(lib)));
      const parentLibraries = (parentJson.libraries || []).filter(lib => !existingKeys.has(this.getLibraryKey(lib)));
      result.libraries = [...parentLibraries, ...(result.libraries || [])];
      if (!result.mainClass && parentJson.mainClass) result.mainClass = parentJson.mainClass;
      if (!result.assetIndex && parentJson.assetIndex) result.assetIndex = parentJson.assetIndex;
      if (!result.assets && parentJson.assets) result.assets = parentJson.assets;
      if (!result.javaVersion && parentJson.javaVersion) result.javaVersion = parentJson.javaVersion;
      if (!result.arguments && parentJson.arguments) result.arguments = parentJson.arguments;
      if (!result.minecraftArguments && parentJson.minecraftArguments) result.minecraftArguments = parentJson.minecraftArguments;
      if (!result.type && parentJson.type) result.type = parentJson.type;
      current = parentJson;
    }
    return result;
  }

  async downloadMissingLibraries(versionJson) {
    const libraries = versionJson.libraries || [];
    for (const library of libraries) {
      let libPath = null;
      let downloadUrl = null;
      if (library.downloads && library.downloads.artifact) {
        libPath = path.join(this.librariesDir, library.downloads.artifact.path);
        downloadUrl = library.downloads.artifact.url;
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
      if (libPath && downloadUrl && !await fs.pathExists(libPath)) {
        await fs.ensureDir(path.dirname(libPath));
        try {
          const libData = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 30000 });
          await fs.writeFile(libPath, libData.data);
        } catch (e) {}
      }
    }
  }

  async getAvailableVersions() {
    try {
      const response = await axios.get('https://launchermeta.mojang.com/mc/game/version_manifest.json');
      return response.data.versions.filter(v => v.type === 'release');
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
          progressCallback({ stage: bt('stage_downloading_fabric'), progress: 40 });
          const fabricProfile = await this.downloadFabricLoader(mcVersion, loaderVersion, progressCallback);
          if (fabricProfile) {
            moddedJson = fabricProfile;
            moddedJson.id = versionId;
            moddedJson.isolated = true;
            moddedJson.instanceDir = instanceDir;
            if (!moddedJson.inheritsFrom) moddedJson.inheritsFrom = mcVersion;
          }
        }
        if (!moddedJson) {
          moddedJson = {
            ...vanillaJson,
            id: versionId,
            type: isForge ? 'forge' : isFabric ? 'fabric' : isOptiFine ? 'optifine' : isNeoForge ? 'neoforge' : 'quilt',
            inheritsFrom: mcVersion,
            loader: isForge ? 'forge' : isFabric ? 'fabric' : isOptiFine ? 'optifine' : isNeoForge ? 'neoforge' : 'quilt',
            isolated: true,
            instanceDir: instanceDir
          };
        }
        await fs.writeJson(path.join(versionDir, `${versionId}.json`), moddedJson, { spaces: 2 });
        progressCallback({ stage: bt('stage_install_complete'), progress: 100 });
        return { success: true };
      }

      const versionsManifest = await axios.get('https://launchermeta.mojang.com/mc/game/version_manifest.json');
      const versionInfo = versionsManifest.data.versions.find(v => v.id === versionId);
      if (!versionInfo) throw new Error('Version not found');
      const versionManifest = await axios.get(versionInfo.url);
      const versionData = versionManifest.data;
      const versionDir = path.join(this.versionsDir, versionId);
      await fs.ensureDir(versionDir);
      await fs.writeJson(path.join(versionDir, `${versionId}.json`), versionData, { spaces: 2 });
      progressCallback({ stage: bt('stage_downloading_client'), progress: 20 });
      const clientJar = await axios.get(versionData.downloads.client.url, { responseType: 'arraybuffer', onDownloadProgress: (p) => {
        const percent = Math.round((p.loaded * 100) / p.total);
        progressCallback({ stage: bt('stage_downloading_client'), progress: 20 + percent * 0.2 });
      } });
      await fs.writeFile(path.join(versionDir, `${versionId}.jar`), clientJar.data);
      progressCallback({ stage: bt('stage_downloading_libs'), progress: 40 });
      const libraries = versionData.libraries || [];
      for (let i = 0; i < libraries.length; i++) {
        const library = libraries[i];
        if (library.downloads && library.downloads.artifact) {
          const artifact = library.downloads.artifact;
          const libPath = path.join(this.librariesDir, artifact.path);
          if (!await fs.pathExists(libPath)) {
            await fs.ensureDir(path.dirname(libPath));
            try {
              const libData = await axios.get(artifact.url, { responseType: 'arraybuffer', timeout: 15000 });
              await fs.writeFile(libPath, libData.data);
            } catch (e) {}
          }
        }
        if (i % 10 === 0) {
          progressCallback({ stage: bt('stage_downloading_libs_progress', {current: i, total: libraries.length}), progress: 40 + ((i / libraries.length) * 20) });
        }
      }
      for (const library of libraries) {
        if (library.downloads && library.downloads.classifiers) {
          const natives = library.downloads.classifiers;
          const nativeKey = 'natives-windows';
          if (natives[nativeKey]) {
            const nativePath = path.join(this.librariesDir, natives[nativeKey].path);
            if (!await fs.pathExists(nativePath)) {
              await fs.ensureDir(path.dirname(nativePath));
              try {
                const nativeData = await axios.get(natives[nativeKey].url, { responseType: 'arraybuffer', timeout: 15000 });
                await fs.writeFile(nativePath, nativeData.data);
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
            await fs.ensureDir(path.dirname(assetPath));
            try {
              const assetUrl = `https://resources.download.minecraft.net/${hashPrefix}/${hash}`;
              const assetData = await axios.get(assetUrl, { responseType: 'arraybuffer', timeout: 30000 });
              await fs.writeFile(assetPath, assetData.data);
            } catch (e) {}
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
    }
    const skinPath = path.join(this.minecraftDir, 'skin.png');
    if (await fs.pathExists(skinPath)) {
      const assetsSkinsDir = path.join(instanceDir, 'assets', 'skins');
      await fs.ensureDir(assetsSkinsDir);
      await fs.copy(skinPath, path.join(assetsSkinsDir, `${username}.png`));
    }
    const libraries = [];
    for (const library of resolvedJson.libraries || []) {
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
    libraries.push(jarPath);
    const classpath = libraries.join(path.delimiter);
    const nativesDir = path.join(this.minecraftDir, 'natives', `${version}-${Date.now()}`);
    await fs.ensureDir(nativesDir);
    for (const library of resolvedJson.libraries || []) {
      if (library.downloads && library.downloads.classifiers) {
        const nativeKey = 'natives-windows';
        if (library.downloads.classifiers[nativeKey]) {
          const nativePath = path.join(this.librariesDir, library.downloads.classifiers[nativeKey].path);
          if (await fs.pathExists(nativePath)) {
            try { await extract(nativePath, { dir: nativesDir }); } catch (e) {}
          }
        }
      }
    }
    await this.downloadAuthlibInjector();

    const mcVersion = version.split('-')[0]; // Extract base version (e.g., "1.20.1" from "1.20.1-fabric-0.14.21")
    let javaPath = null;

    if (preferredJava) {
      console.log(`User preferred Java ${preferredJava} specified`);
      javaPath = await this.javaManager.getJavaExecutable(preferredJava);

      if (javaPath) {
        console.log(`Using preferred Java ${preferredJava}: ${javaPath}`);
      } else {
        console.warn(`Preferred Java ${preferredJava} not found, falling back to auto-detection`);
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
        } else {
          console.warn(`Java ${requiredVersion} not found, trying system 'java' command as fallback`);
          javaPath = 'java';
        }
      }
    }

    console.log(`Using Java: ${javaPath}`);

    // Автоматически применяем настройки GPU для высокой производительности
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
    const jvmArgs = [
      `-Xmx${memory}M`,
      `-Xms${Math.floor(memory / 2)}M`,
      ...optimizationArgs,
      '-Dlog4j2.level=warn',
      ...authlibArgs,
      `-Djava.library.path=${nativesDir}`,
      `-Dorg.lwjgl.opengl.Display.allowSoftwareOpenGL=false`,
      selectedGPU > 0 ? `-Dprism.order=d3d` : '',
      '-cp',
      classpath
    ].filter(arg => arg !== '');
    const assetIndexId = resolvedJson.assetIndex?.id || resolvedJson.assets || version.split('-')[0];
    const mainClass = resolvedJson.mainClass;
    if (!mainClass) throw new Error('No main class found');
    const playerUUID = elyAuth && elyAuth.uuid ? elyAuth.uuid.replace(/-/g, '') : this.generateUUID();
    const accessToken = elyAuth && elyAuth.accessToken ? elyAuth.accessToken : 'null';
    const userType = elyAuth ? 'msa' : 'legacy';
    const gameArgs = [
      mainClass,
      '--username', username,
      '--version', version,
      '--gameDir', instanceDir,
      '--assetsDir', this.assetsDir,
      '--assetIndex', assetIndexId,
      '--uuid', playerUUID,
      '--accessToken', accessToken,
      '--userType', userType,
      '--versionType', isForge ? 'forge' : isFabric ? 'fabric' : isOptiFine ? 'optifine' : isNeoForge ? 'neoforge' : isQuilt ? 'quilt' : 'release'
    ];
    const allArgs = [...jvmArgs, ...gameArgs];
    console.log('Launching:', version);
    console.log('Java path:', javaPath);
    const gameProcess = spawn(javaPath, allArgs, {
      cwd: instanceDir,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    try {
      const { execSync } = require('child_process');
      execSync(`powershell -NoProfile -Command "(Get-Process -Id ${gameProcess.pid}).PriorityClass = 'High'"`, { stdio: 'ignore', timeout: 3000 });
    } catch (e) { /* non-critical */ }
    gameProcess.stdout.on('data', (data) => console.log(`[Minecraft] ${data}`));
    gameProcess.stderr.on('data', (data) => console.error(`[Minecraft Error] ${data}`));
    gameProcess.on('error', (error) => console.error('Failed to start game:', error));
    gameProcess.on('exit', (code) => {
      console.log(`Game exited with code ${code}`);
      setTimeout(async () => {
        try { await fs.remove(nativesDir); } catch (err) { console.warn('Failed to clean natives:', err); }
      }, 5000);
    });
    gameProcess.unref();
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