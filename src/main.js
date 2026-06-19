const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const MinecraftLauncher = require('./launcher/MinecraftLauncher');
const ModLoaderAPI = require('./launcher/ModLoaderAPI');
const StatsManager = require('./launcher/StatsManager');
const ElyByAuth = require('./auth/ElyByAuth');
const AccountManager = require('./launcher/AccountManager');
const JavaManager = require('./launcher/JavaManager');
const ModrinthAPI = require('./launcher/ModrinthAPI');
const ModpackInstaller = require('./launcher/ModpackInstaller');
const DiscordRPCManager = require('./utils/DiscordRPC');
const { bt } = require('./localization/backend-translations');

let mainWindow;
let welcomeWindow;
const launcher = new MinecraftLauncher();
const modLoaderAPI = new ModLoaderAPI();
const statsManager = new StatsManager();
const elyByAuth = new ElyByAuth();
const accountManager = new AccountManager();
const javaManager = new JavaManager();
const modrinthAPI = new ModrinthAPI();
const modpackInstaller = new ModpackInstaller();
const runningInstances = new Map();
const discordRPC = new DiscordRPCManager();
let tray = null;
let isGameRunning = false;

async function checkFirstRun() {
  const fs = require('fs-extra');
  const os = require('os');
  const flagPath = path.join(os.homedir(), '.minecraft_custom', '.first_run_completed');
  return !(await fs.pathExists(flagPath));
}

async function markFirstRunComplete() {
  const fs = require('fs-extra');
  const os = require('os');
  const flagPath = path.join(os.homedir(), '.minecraft_custom', '.first_run_completed');
  const dir = path.dirname(flagPath);
  await fs.ensureDir(dir);
  await fs.writeFile(flagPath, new Date().toISOString());
}

function createWelcomeWindow() {
  welcomeWindow = new BrowserWindow({
    width: 900,
    height: 700,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0a',
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: false
    },
    icon: path.join(__dirname, '../icon.png')
  });
  welcomeWindow.loadFile('src/ui/welcome.html');
  if (process.argv.includes('--dev')) welcomeWindow.webContents.openDevTools();

  welcomeWindow.on('closed', () => {
    welcomeWindow = null;
    createWindow();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0a',
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: false
    },
    icon: path.join(__dirname, '../icon.png')
  });
  mainWindow.loadFile('src/ui/index.html');
  mainWindow.webContents.setBackgroundThrottling(true);
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();

  mainWindow.on('close', (e) => {
    if (isGameRunning) {
      e.preventDefault();
      mainWindow.hide();
      showTray();
    }
  });
}

function showTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, '../icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('ECHO Launcher — игра запущена');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть ECHO Launcher', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: 'Выход', click: () => { isGameRunning = false; discordRPC.destroy(); app.quit(); } }
  ]));
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

function hideTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function setGameRunning(running) {
  isGameRunning = running;
  if (!running) hideTray();
}

app.whenReady().then(async () => {
  try {
    const config = await launcher.getConfig();
    if (config.discordClientId) {
      await discordRPC.init(config.discordClientId);
    }
  } catch (e) {}
  const isFirstRun = await checkFirstRun();
  if (isFirstRun) {
    createWelcomeWindow();
  } else {
    createWindow();
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !isGameRunning) app.quit(); });
app.on('before-quit', () => { discordRPC.destroy(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('get-versions', async () => await launcher.getAvailableVersions());
ipcMain.handle('get-all-versions', async () => {
  const vanilla = await launcher.getAvailableVersions();
  return await modLoaderAPI.getAllVersions(vanilla);
});
ipcMain.handle('download-version', async (event, version) => {
  return await launcher.downloadMinecraft(version, (progress) => {
    mainWindow.webContents.send('download-progress', progress);
  });
});
ipcMain.handle('launch-game', async (event, config) => {
  const result = await launcher.launchGame(config);
  if (result.success && result.pid) {
    const sessionId = await statsManager.recordLaunch(config.version);
    const instanceId = Date.now().toString();
    runningInstances.set(instanceId, {
      pid: result.pid,
      version: config.version,
      startTime: new Date().toISOString(),
      sessionId: sessionId
    });

    const gameStartTime = new Date();
    const mcVersion = config.version.split('-')[0];
    const loaderType = config.version.includes('-forge-') ? 'Forge' :
      config.version.includes('-fabric-') ? 'Fabric' :
      config.version.includes('-optifine-') ? 'OptiFine' :
      config.version.includes('-neoforge-') ? 'NeoForge' :
      config.version.includes('-quilt-') ? 'Quilt' : 'Vanilla';
    const versionDisplay = config.version.includes('-') ? `${mcVersion} (${loaderType})` : mcVersion;

    const launcherConfig = await launcher.getConfig();
    if (launcherConfig.discordClientId && discordRPC.connected) {
      discordRPC.setActivity({
        details: `Играет как ${config.username}`,
        state: 'Загрузка...',
        largeImageKey: launcherConfig.discordLargeImage || 'echo_logo',
        largeImageText: 'ECHO Launcher',
        smallImageKey: launcherConfig.discordSmallImage || 'minecraft',
        smallImageText: versionDisplay,
        startTimestamp: gameStartTime,
      });
    }

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let gameMode = 'unknown';
    let detectedServer = null;
    let serverPlayers = null;

    const updateDiscordPresence = (state) => {
      if (!launcherConfig.discordClientId || !discordRPC.connected) return;
      discordRPC.updateActivity({
        details: `Играет как ${config.username}`,
        state: state,
        smallImageText: versionDisplay,
      });
    };

    setTimeout(() => {
      if (gameMode === 'unknown') {
        gameMode = 'singleplayer';
        updateDiscordPresence('В одиночной игре');
      }
    }, 15000);

    const processLine = (line) => {
      const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (!clean) return;

      if (clean.includes('Disconnecting from server') || clean.includes('Lost connection to server') || clean.includes('Connection closed') || clean.includes('Disconnected from server')) {
        gameMode = 'unknown';
        detectedServer = null;
        serverPlayers = null;
        updateDiscordPresence('В главном меню');
        return;
      }

      if (clean.includes('Stopping server') || clean.includes('Stopping singleplayer server')) {
        if (gameMode === 'singleplayer') {
          gameMode = 'unknown';
          updateDiscordPresence('В главном меню');
        }
        return;
      }

      if (clean.includes('Stopping!')) {
        gameMode = 'unknown';
        detectedServer = null;
        serverPlayers = null;
        updateDiscordPresence('В главном меню');
        return;
      }

      if (clean.includes('Starting integrated server') || clean.includes('Preparing start of integrated server')) {
        gameMode = 'singleplayer';
        updateDiscordPresence('В одиночной игре');
        return;
      }

      const worldMatch = clean.match(/Preparing level "([^"]+)"/);
      if (worldMatch) {
        gameMode = 'singleplayer';
        updateDiscordPresence(`В одиночной игре — ${worldMatch[1]}`);
        return;
      }

      const connectMatch = clean.match(/Connecting to ([\w.\-]+),\s*(\d+)/);
      if (connectMatch) {
        gameMode = 'multiplayer';
        detectedServer = connectMatch[1];
        updateDiscordPresence(`На сервере ${detectedServer}`);
        return;
      }

      const loginMatch = clean.match(/Logging in to ([\w.\-]+)/);
      if (loginMatch) {
        gameMode = 'multiplayer';
        detectedServer = loginMatch[1];
        updateDiscordPresence(`На сервере ${detectedServer}`);
        return;
      }

      const playerCountMatch = clean.match(/There are (\d+)\/(\d+) players online/);
      if (playerCountMatch) {
        serverPlayers = `${playerCountMatch[1]}/${playerCountMatch[2]}`;
        if (gameMode === 'multiplayer' && detectedServer) {
          updateDiscordPresence(`На сервере ${detectedServer} — ${serverPlayers} игроков`);
        }
        return;
      }

      const serverDone = clean.match(/\[Server thread\/INFO\]:\s*Done/);
      if (serverDone && gameMode !== 'multiplayer') {
        if (gameMode === 'unknown') {
          gameMode = 'singleplayer';
          updateDiscordPresence('В одиночной игре');
        }
        return;
      }

      if (gameMode === 'multiplayer' && clean.includes('multiplayer.server.name')) {
        const nameMatch = clean.match(/multiplayer\.server\.name[=:]\s*(.+)/);
        if (nameMatch) {
          detectedServer = nameMatch[1].trim();
          updateDiscordPresence(`На сервере ${detectedServer}${serverPlayers ? ' — ' + serverPlayers + ' игроков' : ''}`);
        }
        return;
      }
    };

    result.process.stdout.on('data', (data) => {
      stdoutBuffer += data.toString('utf8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();
      for (const line of lines) processLine(line);
    });

    result.process.stderr.on('data', (data) => {
      stderrBuffer += data.toString('utf8');
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop();
      for (const line of lines) processLine(line);
    });

    result.process.on('exit', async (code) => {
      console.log(`Process ${result.pid} exited with code ${code}`);
      discordRPC.clearActivity();
      setGameRunning(false);
      await statsManager.recordGameEnd(sessionId);
      runningInstances.delete(instanceId);
      mainWindow.webContents.send('instance-stopped', instanceId);
    });
    setGameRunning(true);
    mainWindow.webContents.send('instance-started', { id: instanceId, pid: result.pid, version: config.version });
    return { success: true, pid: result.pid, instanceId };
  }
  return { success: false, error: result.error || 'Launch failed' };
});
ipcMain.handle('get-installed-versions', async () => await launcher.getInstalledVersions());
ipcMain.handle('get-versions-with-isolation', async () => {
  try {
    const os = require('os');
    const fs = require('fs-extra');
    const versionsDir = path.join(os.homedir(), '.minecraft_custom', 'versions');

    if (!await fs.pathExists(versionsDir)) {
      return [];
    }

    const settingsPath = path.join(os.homedir(), '.minecraft_custom', 'isolation_settings.json');
    let isolatedVersions = [];
    if (await fs.pathExists(settingsPath)) {
      try { isolatedVersions = await fs.readJson(settingsPath); } catch (e) {}
    }

    const allDirs = await fs.readdir(versionsDir);
    const versions = [];

    for (const dir of allDirs) {
      const versionDir = path.join(versionsDir, dir);
      const stat = await fs.stat(versionDir);

      if (!stat.isDirectory()) continue;

      const jsonPath = path.join(versionDir, `${dir}.json`);
      const jarPath = path.join(versionDir, `${dir}.jar`);

      if (await fs.pathExists(jsonPath) && await fs.pathExists(jarPath)) {
        versions.push({
          version: dir,
          isolated: isolatedVersions.includes(dir)
        });
      }
    }

    return versions;
  } catch (error) {
    console.error('Error getting versions with isolation:', error);
    return [];
  }
});
ipcMain.handle('minimize-window', () => mainWindow.minimize());
ipcMain.handle('close-window', () => mainWindow.close());
ipcMain.handle('get-config', async () => await launcher.getConfig());
ipcMain.handle('get-system-memory', () => {
  const os = require('os');
  const totalMemoryMB = Math.floor(os.totalmem() / 1024 / 1024);
  const freeMemoryMB = Math.floor(os.freemem() / 1024 / 1024);
  let maxAllocation;
  if (totalMemoryMB <= 4096) maxAllocation = Math.max(512, totalMemoryMB - 1536);
  else if (totalMemoryMB <= 8192) maxAllocation = totalMemoryMB - 2048;
  else if (totalMemoryMB <= 16384) maxAllocation = totalMemoryMB - 3072;
  else maxAllocation = totalMemoryMB - 4096;
  const recommendedAllocation = Math.min(4096, Math.floor(maxAllocation * 0.5));
  return { totalMemoryMB, freeMemoryMB, maxAllocation: Math.floor(maxAllocation), recommendedAllocation };
});
ipcMain.handle('save-config', async (event, config) => await launcher.saveConfig(config));
ipcMain.handle('discord-set-client-id', async (event, clientId) => {
  try {
    const config = await launcher.getConfig();
    config.discordClientId = clientId;
    await launcher.saveConfig(config);
    if (clientId) {
      await discordRPC.init(clientId);
    } else {
      discordRPC.destroy();
    }
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('discord-get-status', async () => {
  return { connected: discordRPC.connected, clientId: discordRPC.clientId };
});
ipcMain.handle('discord-set-images', async (event, largeImage, smallImage) => {
  try {
    const config = await launcher.getConfig();
    if (largeImage !== undefined) config.discordLargeImage = largeImage;
    if (smallImage !== undefined) config.discordSmallImage = smallImage;
    await launcher.saveConfig(config);
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('open-folder', async (event, folder) => {
  const { shell } = require('electron');
  const os = require('os');
  const folderPath = path.join(os.homedir(), '.minecraft_custom', folder);
  try { await shell.openPath(folderPath); return { success: true }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('get-minecraft-files', async () => {
  const fs = require('fs-extra');
  const os = require('os');
  const minecraftDir = path.join(os.homedir(), '.minecraft_custom');
  try {
    const result = { worlds: [], mods: [], screenshots: [] };
    const savesDir = path.join(minecraftDir, 'saves');
    if (await fs.pathExists(savesDir)) {
      const worlds = await fs.readdir(savesDir);
      result.worlds = worlds.filter(async (w) => (await fs.stat(path.join(savesDir, w))).isDirectory());
    }
    const modsDir = path.join(minecraftDir, 'mods');
    if (await fs.pathExists(modsDir)) {
      const mods = await fs.readdir(modsDir);
      result.mods = mods.filter(m => m.endsWith('.jar'));
    }
    const screenshotsDir = path.join(minecraftDir, 'screenshots');
    if (await fs.pathExists(screenshotsDir)) {
      const screenshots = await fs.readdir(screenshotsDir);
      result.screenshots = screenshots.filter(s => s.endsWith('.png') || s.endsWith('.jpg'));
    }
    return result;
  } catch (error) { return { worlds: [], mods: [], screenshots: [] }; }
});
ipcMain.handle('save-skin', async (event, skinData) => {
  const fs = require('fs-extra');
  const os = require('os');
  const skinPath = path.join(os.homedir(), '.minecraft_custom', 'skin.png');
  try {
    const base64Data = skinData.replace(/^data:image\/png;base64,/, '');
    await fs.writeFile(skinPath, base64Data, 'base64');
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('get-skin', async () => {
  const fs = require('fs-extra');
  const os = require('os');
  const skinPath = path.join(os.homedir(), '.minecraft_custom', 'skin.png');
  try {
    if (await fs.pathExists(skinPath)) {
      const skinBuffer = await fs.readFile(skinPath);
      return `data:image/png;base64,${skinBuffer.toString('base64')}`;
    }
    return null;
  } catch (error) { return null; }
});
ipcMain.handle('remove-skin', async () => {
  const fs = require('fs-extra');
  const os = require('os');
  const skinPath = path.join(os.homedir(), '.minecraft_custom', 'skin.png');
  try {
    if (await fs.pathExists(skinPath)) await fs.remove(skinPath);
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('delete-version', async (event, versionId) => {
  const fs = require('fs-extra');
  const os = require('os');
  const versionDir = path.join(os.homedir(), '.minecraft_custom', 'versions', versionId);
  try {
    if (await fs.pathExists(versionDir)) await fs.remove(versionDir);
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('get-running-instances', () => {
  const instances = [];
  for (const [id, instance] of runningInstances.entries()) {
    try {
      process.kill(instance.pid, 0);
      instances.push({ id, pid: instance.pid, version: instance.version, startTime: instance.startTime });
    } catch (error) {
      runningInstances.delete(id);
    }
  }
  return instances;
});
ipcMain.handle('kill-instance', async (event, instanceId) => {
  const instance = runningInstances.get(instanceId);
  if (instance) {
    try {
      process.kill(instance.pid);
      runningInstances.delete(instanceId);
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  }
  return { success: false, error: 'Instance not found' };
});
ipcMain.handle('check-version-ready', async (event, versionId) => await launcher.isVersionFullyDownloaded(versionId));
ipcMain.handle('open-instance-folder', async (event, versionId) => {
  const { shell } = require('electron');
  const os = require('os');
  const fs = require('fs-extra');

  const versionDir = path.join(os.homedir(), '.minecraft_custom', 'versions', versionId);
  const modpackJsonPath = path.join(versionDir, 'modpack.json');

  let folderToOpen;
  if (await fs.pathExists(modpackJsonPath)) {
    folderToOpen = versionDir;
  } else {
    folderToOpen = path.join(os.homedir(), '.minecraft_custom', 'instances', versionId);
  }

  try {
    await shell.openPath(folderToOpen);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('get-isolation-settings', async () => {
  const fs = require('fs-extra');
  const os = require('os');
  const settingsPath = path.join(os.homedir(), '.minecraft_custom', 'isolation_settings.json');
  try { if (await fs.pathExists(settingsPath)) return await fs.readJson(settingsPath); } catch (error) {}
  return [];
});
ipcMain.handle('save-isolation-settings', async (event, settings) => {
  const fs = require('fs-extra');
  const os = require('os');
  const settingsPath = path.join(os.homedir(), '.minecraft_custom', 'isolation_settings.json');
  try { await fs.writeJson(settingsPath, settings, { spaces: 2 }); return { success: true }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('toggle-isolation', async (event, data) => {
  const fs = require('fs-extra');
  const os = require('os');
  const { version, isolated } = data;
  const minecraftDir = path.join(os.homedir(), '.minecraft_custom');
  const sharedDir = minecraftDir;
  const isolatedDir = path.join(minecraftDir, 'instances', version);
  const foldersToMigrate = ['saves', 'mods', 'resourcepacks', 'shaderpacks', 'screenshots', 'config', 'logs'];
  try {
    if (isolated) {
      await fs.ensureDir(isolatedDir);
      for (const folder of foldersToMigrate) {
        const sourcePath = path.join(sharedDir, folder);
        const targetPath = path.join(isolatedDir, folder);
        if (await fs.pathExists(sourcePath)) {
          await fs.ensureDir(targetPath);
          const items = await fs.readdir(sourcePath);
          for (const item of items) {
            const itemPath = path.join(sourcePath, item);
            const targetItemPath = path.join(targetPath, item);
            if (!await fs.pathExists(targetItemPath)) await fs.copy(itemPath, targetItemPath);
          }
        } else await fs.ensureDir(targetPath);
      }
    } else {
      if (await fs.pathExists(isolatedDir)) {
        for (const folder of foldersToMigrate) {
          const sourcePath = path.join(isolatedDir, folder);
          const targetPath = path.join(sharedDir, folder);
          if (await fs.pathExists(sourcePath)) {
            await fs.ensureDir(targetPath);
            const items = await fs.readdir(sourcePath);
            for (const item of items) {
              const targetItemPath = path.join(targetPath, item);
              if (!await fs.pathExists(targetItemPath)) await fs.copy(path.join(sourcePath, item), targetItemPath);
            }
          }
        }
      }
    }
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false); else mainWindow.setFullScreen(true);
  return { success: true };
});
ipcMain.handle('resize-launcher', () => {
  const currentSize = mainWindow.getSize();
  if (currentSize[0] === 1000) mainWindow.setSize(1200, 750);
  else if (currentSize[0] === 1200) mainWindow.setSize(1400, 850);
  else mainWindow.setSize(1000, 650);
  mainWindow.center();
  return { success: true };
});
let cachedSystemInfo = null;
ipcMain.handle('get-system-info', () => {
  if (cachedSystemInfo) return cachedSystemInfo;
  const os = require('os');
  const totalMemoryGB = Math.floor(os.totalmem() / 1024 / 1024 / 1024);
  const cpuModel = os.cpus()[0].model;
  const cpuCores = os.cpus().length;
  const platform = os.platform();
  const arch = os.arch();
  let gpuInfo = [];
  try {
    if (platform === 'win32') {
      const { execSync } = require('child_process');
      const wmic = execSync('wmic path win32_VideoController get name', { encoding: 'utf-8', timeout: 3000 });
      const lines = wmic.split('\n').filter(line => line.trim() && line.trim() !== 'Name');
      gpuInfo = lines.map(line => line.trim());
    }
  } catch (error) {}
  cachedSystemInfo = { cpu: cpuModel, cpuCores, totalMemoryGB, platform, arch, gpus: gpuInfo };
  return cachedSystemInfo;
});
ipcMain.handle('get-stats', async () => await statsManager.getStats());

ipcMain.handle('get-screenshots', async () => {
  try {
    const fs = require('fs-extra');
    const os = require('os');
    const minecraftDir = path.join(os.homedir(), '.minecraft_custom');
    const screenshotsDir = path.join(minecraftDir, 'screenshots');

    if (!await fs.pathExists(screenshotsDir)) {
      return { success: true, screenshots: [] };
    }

    const files = await fs.readdir(screenshotsDir);
    const screenshots = files
      .filter(f => f.match(/\.(png|jpg|jpeg)$/i))
      .map(f => ({
        name: f,
        path: path.join(screenshotsDir, f)
      }))
      .sort((a, b) => b.name.localeCompare(a.name)); // Новые первыми

    return { success: true, screenshots };
  } catch (error) {
    console.error('Error getting screenshots:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-screenshot', async (event, screenshotPath) => {
  try {
    const fs = require('fs-extra');
    await fs.remove(screenshotPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-screenshots-folder', async () => {
  const { shell } = require('electron');
  const os = require('os');
  const screenshotsDir = path.join(os.homedir(), '.minecraft_custom', 'screenshots');
  try {
    await shell.openPath(screenshotsDir);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-integrity', async () => {
  try {
    const fs = require('fs-extra');
    const os = require('os');
    const minecraftDir = path.join(os.homedir(), '.minecraft_custom');
    const versionsDir = path.join(minecraftDir, 'versions');

    let totalFiles = 0;
    let missingFiles = [];
    let checkedVersions = 0;

    if (await fs.pathExists(versionsDir)) {
      const versions = await fs.readdir(versionsDir);
      for (const version of versions) {
        const versionDir = path.join(versionsDir, version);
        const stat = await fs.stat(versionDir);
        if (!stat.isDirectory()) continue;

        checkedVersions++;
        const jsonPath = path.join(versionDir, `${version}.json`);
        const jarPath = path.join(versionDir, `${version}.jar`);

        totalFiles += 2;
        if (!await fs.pathExists(jsonPath)) {
          missingFiles.push(jsonPath);
        }
        if (!await fs.pathExists(jarPath)) {
          missingFiles.push(jarPath);
        }
      }
    }

    if (missingFiles.length > 0) {
      const details = missingFiles.slice(0, 5).map(f => `• ${f}`).join('\n');
      const more = missingFiles.length > 5 ? bt('integrity_files_more', {count: missingFiles.length - 5}) : '';
      return {
        success: true,
        type: 'error',
        message: bt('integrity_problems', {versions: checkedVersions, total: totalFiles, missing: missingFiles.length, details: details, more: more})
      };
    }

    return {
      success: true,
      type: 'success',
      message: bt('integrity_ok', {versions: checkedVersions, total: totalFiles})
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('clear-cache', async () => {
  try {
    const fs = require('fs-extra');
    const os = require('os');
    const minecraftDir = path.join(os.homedir(), '.minecraft_custom');

    let freedSpace = 0;

    const nativesDir = path.join(minecraftDir, 'natives');
    if (await fs.pathExists(nativesDir)) {
      const stat = await fs.stat(nativesDir);
      freedSpace += Math.round(stat.size / 1024 / 1024);
      await fs.remove(nativesDir);
    }

    const tempDir = path.join(os.tmpdir(), 'minecraft_modpacks');
    if (await fs.pathExists(tempDir)) {
      const stat = await fs.stat(tempDir);
      freedSpace += Math.round(stat.size / 1024 / 1024);
      await fs.remove(tempDir);
    }

    return { success: true, freedSpace };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('optimize-settings', async () => {
  try {
    const os = require('os');
    const totalMemory = Math.floor(os.totalmem() / 1024 / 1024);
    const cpus = os.cpus();
    const cpuModel = cpus[0].model;
    const cpuCores = cpus.length;

    let recommendedMemory = 2048;
    let profile = 'balanced';
    let recommendation = '';

    if (totalMemory >= 16384) {
      recommendedMemory = 6144;
      profile = 'performance';
      recommendation = bt('optimization_high');
    } else if (totalMemory >= 8192) {
      recommendedMemory = 4096;
      profile = 'balanced';
      recommendation = bt('optimization_balanced');
    } else if (totalMemory >= 4096) {
      recommendedMemory = 2048;
      profile = 'potato';
      recommendation = bt('optimization_low');
    } else {
      recommendedMemory = 1024;
      profile = 'potato';
      recommendation = bt('optimization_minimal');
    }

    const config = await launcher.getConfig();
    const oldMemory = config.memory || 2048;
    const oldProfile = config.optimizationProfile || 'balanced';

    config.memory = recommendedMemory;
    config.optimizationProfile = profile;
    await launcher.saveConfig(config);

    const changes = [];
    if (oldMemory !== recommendedMemory) {
      changes.push(bt('optimization_memory_change', {old: oldMemory, new: recommendedMemory}));
    }
    if (oldProfile !== profile) {
      changes.push(bt('optimization_profile_change', {old: oldProfile, new: profile}));
    }

    const details = bt('optimization_system_info', {ram: totalMemory, cpu: cpuModel, cores: cpuCores, changes: changes.length > 0 ? changes.join('\n') : bt('optimization_already_optimal'), recommendation: recommendation});

    return {
      success: true,
      type: 'success',
      message: details
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-logs-folder', async () => {
  const { shell } = require('electron');
  const os = require('os');
  const logsDir = path.join(os.homedir(), '.minecraft_custom', 'logs');
  try {
    await shell.openPath(logsDir);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('analyze-logs', async () => {
  try {
    const fs = require('fs-extra');
    const os = require('os');
    const logsDir = path.join(os.homedir(), '.minecraft_custom', 'logs');

    if (!await fs.pathExists(logsDir)) {
      return { success: true, logs: [], errors: [] };
    }

    const files = await fs.readdir(logsDir);
    const latestLog = files
      .filter(f => f.endsWith('.log'))
      .sort()
      .reverse()[0];

    if (!latestLog) {
      return { success: true, logs: [], errors: [] };
    }

    const logPath = path.join(logsDir, latestLog);
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.split('\n').slice(-100); // Последние 100 строк

    const logs = [];
    const errors = [];

    lines.forEach(line => {
      if (!line.trim()) return;

      let type = 'info';
      if (line.includes('ERROR') || line.includes('FATAL')) {
        type = 'error';
        errors.push(line.substring(0, 100));
      } else if (line.includes('WARN')) {
        type = 'warn';
      }

      const timeMatch = line.match(/\[(\d{2}:\d{2}:\d{2})\]/);
      const time = timeMatch ? timeMatch[1] : '--:--:--';

      logs.push({
        type,
        time,
        message: line.substring(0, 200)
      });
    });

    return { success: true, logs, errors: errors.slice(0, 5) };
  } catch (error) {
    console.error('Error analyzing logs:', error);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('get-favorite-version', async () => await statsManager.getFavoriteVersion());
ipcMain.handle('ely-start-oauth', async () => {
  try { const tokens = await elyByAuth.startOAuthFlow(); return { success: true, tokens }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('ely-login-username-password', async (event, username, password) => {
  try { const tokens = await elyByAuth.startUsernamePasswordAuth(username, password); return { success: true, tokens }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('ely-get-account-info', async (event, accessToken) => {
  try { const accountInfo = await elyByAuth.getAccountInfo(accessToken); return { success: true, accountInfo }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('ely-refresh-token', async (event, refreshToken) => {
  try { const tokens = await elyByAuth.refreshAccessToken(refreshToken); return { success: true, tokens }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('ely-validate-token', async (event, accessToken) => {
  try { const isValid = await elyByAuth.validateToken(accessToken); return { success: true, valid: isValid }; } catch (error) { return { success: false, valid: false }; }
});
ipcMain.handle('ely-logout', async (event, accessToken) => {
  try { await elyByAuth.logout(accessToken); return { success: true }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('ely-authenticate-for-game', async (event, accessToken) => {
  try { const gameAuth = await elyByAuth.authenticateForGame(accessToken); return { success: true, ...gameAuth }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('accounts-get-all', async () => {
  try { return { success: true, accounts: accountManager.getAllAccounts() }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('accounts-get-active', async () => {
  try { const account = accountManager.getActiveAccount(); return { success: true, account }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('accounts-add-local', async (event, username) => {
  try { const account = await accountManager.addLocalAccount(username); return { success: true, account }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('accounts-add-ely', async (event, authData) => {
  try { const account = await accountManager.addElyByAccount(authData); return { success: true, account }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('accounts-set-active', async (event, accountId) => {
  try { const account = await accountManager.setActiveAccount(accountId); return { success: true, account }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('accounts-remove', async (event, accountId) => {
  try { await accountManager.removeAccount(accountId); return { success: true }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('accounts-update-skin', async (event, accountId, skinData) => {
  try { const account = await accountManager.updateAccountSkin(accountId, skinData); return { success: true, account }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('accounts-get', async (event, accountId) => {
  try { const account = accountManager.getAccount(accountId); return { success: true, account }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('java-get-all-info', async () => {
  try { const info = await javaManager.getAllJavaInfo(); return { success: true, ...info }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('java-get-installed', async () => {
  try { const installed = await javaManager.getInstalledJavaVersions(); return { success: true, installed }; } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('java-download', async (event, version) => {
  try {
    const result = await javaManager.downloadJava(version, (progress) => {
      mainWindow.webContents.send('java-download-progress', progress);
    });
    return result;
  } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('java-delete', async (event, version) => {
  try { return await javaManager.deleteJavaVersion(version); } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('java-get-for-minecraft', async (event, minecraftVersion) => {
  try {
    const javaPath = await javaManager.getJavaForMinecraft(minecraftVersion);
    const requiredVersion = javaManager.getJavaVersionForMinecraft(minecraftVersion);
    return { success: true, javaPath, requiredVersion };
  } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('java-get-required-version', async (event, minecraftVersion) => {
  try {
    const requiredVersion = javaManager.getJavaVersionForMinecraft(minecraftVersion);
    return { success: true, version: requiredVersion };
  } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('complete-first-setup', async () => {
  try {
    await markFirstRunComplete();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('modrinth-search', async (event, query, filters) => {
  try {
    return await modrinthAPI.searchMods(query, filters);
  } catch (error) {
    return { success: false, error: error.message, hits: [], total: 0 };
  }
});
ipcMain.handle('modrinth-get-mod', async (event, projectId) => {
  try {
    return await modrinthAPI.getModDetails(projectId);
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('modrinth-get-versions', async (event, projectId, filters) => {
  try {
    return await modrinthAPI.getModVersions(projectId, filters);
  } catch (error) {
    return { success: false, error: error.message, versions: [] };
  }
});
ipcMain.handle('modrinth-download-mod', async (event, downloadUrl, fileName, targetVersion) => {
  try {
    const os = require('os');
    const fs = require('fs-extra');
    let modsDir;
    if (targetVersion) {
      const settingsPath = path.join(os.homedir(), '.minecraft_custom', 'isolation_settings.json');
      let isolatedVersions = [];
      if (await fs.pathExists(settingsPath)) {
        try { isolatedVersions = await fs.readJson(settingsPath); } catch (e) {}
      }
      if (isolatedVersions.includes(targetVersion)) {
        const versionDir = path.join(os.homedir(), '.minecraft_custom', 'versions', targetVersion);
        modsDir = path.join(versionDir, 'mods');
      } else {
        modsDir = path.join(os.homedir(), '.minecraft_custom', 'mods');
      }
    } else {
      modsDir = path.join(os.homedir(), '.minecraft_custom', 'mods');
    }
    await fs.ensureDir(modsDir);
    const filePath = path.join(modsDir, fileName);
    const result = await modrinthAPI.downloadFile(downloadUrl, filePath, (progress) => {
      mainWindow.webContents.send('mod-download-progress', { fileName, ...progress });
    });
    return { ...result, filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('modrinth-search-content', async (event, query, projectType, filters) => {
  try {
    return await modrinthAPI.searchContent(query, projectType, filters);
  } catch (error) {
    return { success: false, error: error.message, hits: [], total: 0 };
  }
});
ipcMain.handle('modrinth-install-modpack', async (event, projectId, downloadUrl, fileName, gameVersions) => {
  try {
    const os = require('os');
    const fs = require('fs-extra');
    const tempDir = path.join(os.tmpdir(), 'minecraft_modpacks');
    await fs.ensureDir(tempDir);

    const tempFilePath = path.join(tempDir, fileName);

    const downloadResult = await modrinthAPI.downloadFile(downloadUrl, tempFilePath, (progress) => {
      mainWindow.webContents.send('mod-download-progress', { fileName, ...progress });
    });

    if (!downloadResult.success) {
      return { success: false, error: downloadResult.error };
    }

    const selectedVersion = gameVersions && gameVersions.length > 0 ? gameVersions[0] : '1.21.1';

    const installResult = await modpackInstaller.installModpack(tempFilePath, fileName, selectedVersion);

    if (installResult.success) {
      return installResult;
    } else {
      return installResult;
    }
  } catch (error) {
    console.error('Modpack installation error:', error);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('modrinth-download-resourcepack', async (event, downloadUrl, fileName, targetVersion) => {
  try {
    const os = require('os');
    const fs = require('fs-extra');
    let resourcepacksDir;
    if (targetVersion) {
      const settingsPath = path.join(os.homedir(), '.minecraft_custom', 'isolation_settings.json');
      let isolatedVersions = [];
      if (await fs.pathExists(settingsPath)) {
        try { isolatedVersions = await fs.readJson(settingsPath); } catch (e) {}
      }
      if (isolatedVersions.includes(targetVersion)) {
        const versionDir = path.join(os.homedir(), '.minecraft_custom', 'versions', targetVersion);
        resourcepacksDir = path.join(versionDir, 'resourcepacks');
      } else {
        resourcepacksDir = path.join(os.homedir(), '.minecraft_custom', 'resourcepacks');
      }
    } else {
      resourcepacksDir = path.join(os.homedir(), '.minecraft_custom', 'resourcepacks');
    }
    await fs.ensureDir(resourcepacksDir);
    const filePath = path.join(resourcepacksDir, fileName);
    const result = await modrinthAPI.downloadFile(downloadUrl, filePath, (progress) => {
      mainWindow.webContents.send('mod-download-progress', { fileName, ...progress });
    });
    return { ...result, filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('modrinth-download-shader', async (event, downloadUrl, fileName, targetVersion) => {
  try {
    const os = require('os');
    const fs = require('fs-extra');
    let shadersDir;
    if (targetVersion) {
      const settingsPath = path.join(os.homedir(), '.minecraft_custom', 'isolation_settings.json');
      let isolatedVersions = [];
      if (await fs.pathExists(settingsPath)) {
        try { isolatedVersions = await fs.readJson(settingsPath); } catch (e) {}
      }
      if (isolatedVersions.includes(targetVersion)) {
        const versionDir = path.join(os.homedir(), '.minecraft_custom', 'versions', targetVersion);
        shadersDir = path.join(versionDir, 'shaderpacks');
      } else {
        shadersDir = path.join(os.homedir(), '.minecraft_custom', 'shaderpacks');
      }
    } else {
      shadersDir = path.join(os.homedir(), '.minecraft_custom', 'shaderpacks');
    }
    await fs.ensureDir(shadersDir);
    const filePath = path.join(shadersDir, fileName);
    const result = await modrinthAPI.downloadFile(downloadUrl, filePath, (progress) => {
      mainWindow.webContents.send('mod-download-progress', { fileName, ...progress });
    });
    return { ...result, filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-available-minecraft-versions', async () => {
  try {
    const versions = await minecraftLauncher.getAvailableVersions();
    return { success: true, versions };
  } catch (error) {
    return { success: false, error: error.message, versions: [] };
  }
});

ipcMain.handle('get-minecraft-root', async () => {
  try {
    const os = require('os');
    const rootPath = path.join(os.homedir(), '.minecraft_custom');
    return { success: true, path: rootPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-directory', async (event, dirPath) => {
  try {
    const fs = require('fs-extra');
    const files = await fs.readdir(dirPath, { withFileTypes: true });

    const fileList = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(dirPath, file.name);
        try {
          const stats = await fs.stat(filePath);
          return {
            name: file.name,
            path: filePath,
            isDirectory: file.isDirectory(),
            size: stats.size,
            modified: stats.mtime.getTime(),
            created: stats.birthtime.getTime()
          };
        } catch (err) {
          return null;
        }
      })
    );

    return { success: true, files: fileList.filter(f => f !== null) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-parent-directory', async (event, dirPath) => {
  try {
    const parent = path.dirname(dirPath);
    if (parent !== dirPath) {
      return { success: true, parent };
    }
    return { success: false };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-file', async (event, filePath) => {
  try {
    const { shell } = require('electron');
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('show-item-in-folder', async (event, itemPath) => {
  try {
    const { shell } = require('electron');
    shell.showItemInFolder(itemPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file-operation', async (event, data) => {
  try {
    const fs = require('fs-extra');
    const { operation, sources, destination } = data;

    for (const source of sources) {
      const fileName = path.basename(source);
      const destPath = path.join(destination, fileName);

      if (operation === 'copy') {
        await fs.copy(source, destPath, { overwrite: false, errorOnExist: true });
      } else if (operation === 'cut') {
        await fs.move(source, destPath, { overwrite: false });
      }
    }

    return { success: true, message: bt('file_operation_result', {count: sources.length, operation: operation === 'copy' ? bt('file_copied') : bt('file_moved')}) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-item', async (event, data) => {
  try {
    const fs = require('fs-extra');
    const { oldPath, newName } = data;
    const newPath = path.join(path.dirname(oldPath), newName);

    await fs.rename(oldPath, newPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-items', async (event, data) => {
  try {
    const fs = require('fs-extra');
    const { items } = data;

    for (const item of items) {
      await fs.remove(item);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-folder', async (event, data) => {
  try {
    const fs = require('fs-extra');
    const { path: dirPath, name } = data;
    const newFolderPath = path.join(dirPath, name);

    await fs.ensureDir(newFolderPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-item-properties', async (event, itemPath) => {
  try {
    const fs = require('fs-extra');
    const stats = await fs.stat(itemPath);

    return {
      success: true,
      properties: {
        name: path.basename(itemPath),
        path: itemPath,
        isDirectory: stats.isDirectory(),
        size: stats.size,
        created: stats.birthtime.getTime(),
        modified: stats.mtime.getTime()
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-modpack-version', async (event, data) => {
  const { modpackTitle, versionName, gameVersions, loader, filePath } = data;
  const fs = require('fs-extra');
  const os = require('os');
  try {
    const versionsDir = path.join(os.homedir(), '.minecraft_custom', 'versions');
    const versionId = `${modpackTitle.replace(/[^a-zA-Z0-9]/g, '_')}-${versionName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const versionDir = path.join(versionsDir, versionId);
    await fs.ensureDir(versionDir);
    const mcVersion = gameVersions[0] || '1.20.1';
    const versionJson = {
      id: versionId,
      name: `${modpackTitle} (${versionName})`,
      inheritsFrom: mcVersion,
      type: 'modpack',
      loader: loader,
      isolated: true,
      modpackFile: filePath,
      gameVersions: gameVersions
    };
    await fs.writeJson(path.join(versionDir, `${versionId}.json`), versionJson, { spaces: 2 });
    const baseJar = path.join(versionsDir, mcVersion, `${mcVersion}.jar`);
    const targetJar = path.join(versionDir, `${versionId}.jar`);
    if (await fs.pathExists(baseJar)) {
      await fs.copy(baseJar, targetJar);
    } else {
      await fs.writeFile(targetJar, '');
    }
    const settingsPath = path.join(os.homedir(), '.minecraft_custom', 'isolation_settings.json');
    let isolatedVersions = [];
    if (await fs.pathExists(settingsPath)) {
      isolatedVersions = await fs.readJson(settingsPath);
    }
    if (!isolatedVersions.includes(versionId)) {
      isolatedVersions.push(versionId);
      await fs.writeJson(settingsPath, isolatedVersions, { spaces: 2 });
    }
    const instanceDir = path.join(os.homedir(), '.minecraft_custom', 'instances', versionId);
    await fs.ensureDir(instanceDir);
    await fs.ensureDir(path.join(instanceDir, 'mods'));
    await fs.ensureDir(path.join(instanceDir, 'config'));
    await fs.ensureDir(path.join(instanceDir, 'saves'));
    await fs.ensureDir(path.join(instanceDir, 'resourcepacks'));
    await fs.ensureDir(path.join(instanceDir, 'shaderpacks'));
    await fs.ensureDir(path.join(instanceDir, 'screenshots'));
    await fs.ensureDir(path.join(instanceDir, 'logs'));
    return { success: true, versionId };
  } catch (error) {
    console.error('Error creating modpack version:', error);
    return { success: false, error: error.message };
  }
});