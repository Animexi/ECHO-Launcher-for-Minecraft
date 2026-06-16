const { ipcRenderer } = require('electron');

window.ipcRenderer = ipcRenderer;

let currentConfig = {
  username: 'Player',
  memory: 2048,
  lastVersion: null,
  optimizationProfile: 'balanced',
  selectedGPU: 0,
  elyAuth: null,
  preferredJava: null,
  language: 'ru'
};

let availableVersions = [];
let installedVersions = [];
let allVersionsData = {
  vanilla: [],
  forge: [],
  fabric: [],
  optifine: [],
  neoforge: [],
  quilt: []
};
let currentFilter = 'vanilla';
let runningInstances = [];
let isolatedVersions = new Set();
let systemInfo = null;
let autoSaveTimeout = null;
let localizationManager;

function notify(key, params = {}, type = 'info') {
  let message = localizationManager ? localizationManager.t(key, params) : key;
  if (typeof showNotification === 'function') {
    showNotification(message, type);
  } else {
    console.log(`[${type}] ${message}`);
  }
}

function t(key, params = {}) {
  return localizationManager ? localizationManager.t(key, params) : key;
}

function updateSliderFill(slider) {
  if (!slider) return;
  const min = parseFloat(slider.min) || 0;
  const max = parseFloat(slider.max) || 100;
  const val = parseFloat(slider.value) || 0;
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.setProperty('--range-pct', pct + '%');
}

function initLocalization() {
  if (typeof LocalizationManager !== 'undefined') {
    localizationManager = new LocalizationManager();
    window.localizationManager = localizationManager;

    if (currentConfig.language) {
      localizationManager.setLanguage(currentConfig.language);
    }

    if (typeof setTranslateFunction === 'function') {
      setTranslateFunction((key) => localizationManager.t(key));
    }

    localizationManager.applyTranslations();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  initLocalization();
  await loadConfig();
  await loadSystemMemory();
  await loadSystemInfo();
  await loadVersions();
  await loadRunningInstances();
  await loadIsolationSettings();
  setupEventListeners();
  updateUI();
  await initElyByAuth();
  await initAccountsTab();
  await initModsTab();
  await initMediaTab();
  await initToolsTab();
  await initFileManager();

  setInterval(async () => {
    await loadRunningInstances();
  }, 5000);
});

async function loadSystemInfo() {
  try {
    systemInfo = await ipcRenderer.invoke('get-system-info');
    displaySystemInfo();
    displayGPUSelection();
    await loadJavaInfo();
  } catch (error) {
    console.error('Error loading system info:', error);
    systemInfo = {
      platform: 'win32',
      arch: 'x64',
      cpu: 'Unknown CPU',
      cpuCores: 8,
      totalMemoryGB: 16,
      gpus: ['Intel UHD Graphics', 'NVIDIA GeForce RTX 3060']
    };
    displaySystemInfo();
    displayGPUSelection();
  }
}

function displaySystemInfo() {
  const container = document.getElementById('systemInfo');
  if (!container) return;
  if (!systemInfo) {
    container.innerHTML = `<div class="system-info-loading">${t('common_error')}</div>`;
    return;
  }
  let osName = 'Windows';
  if (systemInfo.platform === 'win32') osName = 'Windows';
  else if (systemInfo.platform === 'darwin') osName = 'macOS';
  else if (systemInfo.platform === 'linux') osName = 'Linux';
  const architecture = systemInfo.arch === 'x64' ? '64-bit' : systemInfo.arch;
  let cpuName = systemInfo.cpu.replace(/\s+/g, ' ').trim();
  cpuName = cpuName.replace(/@.*/, '').trim().replace(/CPU /, '').trim();
  container.innerHTML = `
    <div class="system-info-item">
      <div class="system-info-label">💻 ${t('settings_system_info')}</div>
      <div class="system-info-value">${cpuName}</div>
    </div>
    <div class="system-info-item">
      <div class="system-info-label">⚡ ${t('common_cores')}</div>
      <div class="system-info-value">${systemInfo.cpuCores} ${t('common_cores')}</div>
    </div>
    <div class="system-info-item">
      <div class="system-info-label">🎮 RAM</div>
      <div class="system-info-value">${systemInfo.totalMemoryGB} GB</div>
    </div>
    <div class="system-info-item">
      <div class="system-info-label">🖥️ ${t('settings_system_info')}</div>
      <div class="system-info-value">${osName} ${architecture}</div>
    </div>
  `;
}

function displayGPUSelection() {
  const container = document.getElementById('gpuSelection');
  if (!container) return;
  if (!systemInfo || !systemInfo.gpus || systemInfo.gpus.length === 0) {
    container.innerHTML = `<div class="system-info-loading">${t('gpu_not_detected')}</div>`;
    return;
  }
  container.innerHTML = '';
  systemInfo.gpus.forEach((gpu, index) => {
    const option = document.createElement('div');
    option.className = 'gpu-option';
    if (index === (currentConfig.selectedGPU || 0)) option.classList.add('active');
    const isIntegrated = gpu.toLowerCase().includes('intel') &&
                        (gpu.toLowerCase().includes('uhd') ||
                         gpu.toLowerCase().includes('hd graphics') ||
                         gpu.toLowerCase().includes('iris'));
    option.innerHTML = `
      <div class="gpu-radio"></div>
      <div class="gpu-info">
        <div class="gpu-name">${gpu}</div>
        <div class="gpu-type">${isIntegrated ? t('gpu_integrated') : t('gpu_discrete')}</div>
      </div>
    `;
    option.addEventListener('click', () => {
      document.querySelectorAll('.gpu-option').forEach(opt => opt.classList.remove('active'));
      option.classList.add('active');
      currentConfig.selectedGPU = index;
      autoSaveConfig();
    });
    container.appendChild(option);
  });
}

async function loadSystemMemory() {
  try {
    const memInfo = await ipcRenderer.invoke('get-system-memory');
    const memorySlider = document.getElementById('memorySlider');
    const memoryInput = document.getElementById('memoryInput');
    if (!memorySlider || !memoryInput) return;
    memorySlider.max = memInfo.maxAllocation;
    memoryInput.max = memInfo.maxAllocation;
    if (currentConfig.memory === 2048 || currentConfig.memory > memInfo.maxAllocation) {
      currentConfig.memory = memInfo.recommendedAllocation;
      memorySlider.value = memInfo.recommendedAllocation;
      memoryInput.value = memInfo.recommendedAllocation;
      updateSliderFill(memorySlider);
    }
    const memoryLabel = document.querySelector('label[for="memoryInput"] .setting-description');
    if (memoryLabel) {
      memoryLabel.textContent = `${t('settings_memory_available')}: ${Math.floor(memInfo.totalMemoryMB / 1024)} GB | ${t('settings_memory_recommended')}: ${memInfo.recommendedAllocation} MB`;
    }
  } catch (error) {
    console.error('Error loading system memory:', error);
    const memorySlider = document.getElementById('memorySlider');
    const memoryInput = document.getElementById('memoryInput');
    if (memorySlider) memorySlider.max = 16384;
    if (memoryInput) memoryInput.max = 16384;
  }
}

async function loadIsolationSettings() {
  try {
    const settings = await ipcRenderer.invoke('get-isolation-settings');
    if (settings) isolatedVersions = new Set(settings);
  } catch (error) {
    console.error('Error loading isolation settings:', error);
  }
}

async function saveIsolationSettings() {
  try {
    await ipcRenderer.invoke('save-isolation-settings', Array.from(isolatedVersions));
  } catch (error) {
    console.error('Error saving isolation settings:', error);
  }
}

function autoSaveConfig() {
  if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
  autoSaveTimeout = setTimeout(async () => {
    try {
      await ipcRenderer.invoke('save-config', currentConfig);
      await saveIsolationSettings();
      console.log('Auto-saved config');
    } catch (error) {
      console.error('Auto-save error:', error);
    }
  }, 1000);
}

async function loadConfig() {
  try {
    currentConfig = await ipcRenderer.invoke('get-config');
    if (!currentConfig.preferredJava) currentConfig.preferredJava = null;
    if (!currentConfig.language) currentConfig.language = 'ru';
  } catch (error) {
    console.error('Error loading config:', error);
    currentConfig = {
      username: 'Player',
      memory: 2048,
      lastVersion: null,
      optimizationProfile: 'balanced',
      selectedGPU: 0,
      preferredJava: null,
      language: 'ru'
    };
  }

  if (localizationManager && currentConfig.language) {
    localizationManager.setLanguage(currentConfig.language);
    localizationManager.applyTranslations();
    if (typeof setTranslateFunction === 'function') {
      setTranslateFunction((key) => localizationManager.t(key));
    }
  }

  const languageSelect = document.getElementById('languageSelect');
  if (languageSelect) {
    languageSelect.value = currentConfig.language;
  }
}

async function loadRunningInstances() {
  try {
    runningInstances = await ipcRenderer.invoke('get-running-instances');
    updateRunningInstancesUI();
  } catch (error) {
    console.error('Error loading instances:', error);
    runningInstances = [];
    updateRunningInstancesUI();
  }
}

function updateRunningInstancesUI() {
  const container = document.getElementById('runningInstances');
  const list = document.getElementById('instancesList');
  if (!container || !list) return;
  if (runningInstances.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  list.innerHTML = '';
  runningInstances.forEach(instance => {
    const item = document.createElement('div');
    item.className = 'instance-item';
    item.innerHTML = `
      <div class="instance-info">
        <div class="instance-status"></div>
        <div>
          <span class="instance-name">${instance.version}</span>
          <span class="instance-pid">PID: ${instance.pid}</span>
        </div>
      </div>
      <button class="kill-instance-btn" data-instance-id="${instance.id}">${t('common_close')}</button>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll('.kill-instance-btn').forEach(btn => {
    btn.onclick = async () => await killInstance(btn.dataset.instanceId);
  });
}

async function killInstance(instanceId) {
  try {
    const result = await ipcRenderer.invoke('kill-instance', instanceId);
    if (result.success) {
      await loadRunningInstances();
      notify('process_killed_success', {}, 'success');
    } else {
      notify('process_kill_error', {}, 'error');
    }
  } catch (error) {
    console.error('Error killing instance:', error);
    notify('process_kill_error', {}, 'error');
  }
}

async function loadVersions() {
  try {
    installedVersions = await ipcRenderer.invoke('get-installed-versions');
    allVersionsData = await ipcRenderer.invoke('get-all-versions');
    filterByType(currentFilter);
    populateVersionSelect();
  } catch (error) {
    console.error('Error loading versions:', error);
    installedVersions = ['1.20.4', '1.19.2'];
    allVersionsData = {
      vanilla: [{ id: '1.20.4', type: 'release' }, { id: '1.19.2', type: 'release' }],
      forge: [], fabric: [], optifine: [], neoforge: [], quilt: []
    };
    filterByType(currentFilter);
    populateVersionSelect();
  }
}

function populateVersionSelect() {
  const versionSelect = document.getElementById('versionSelect');
  if (!versionSelect) return;
  versionSelect.innerHTML = '';
  if (installedVersions.length === 0) {
    versionSelect.innerHTML = `<option value="">${t('versions_no_installed')}</option>`;
    return;
  }
  installedVersions.forEach(version => {
    const option = document.createElement('option');
    option.value = version;
    option.textContent = `Minecraft ${version}`;
    if (version === currentConfig.lastVersion) option.selected = true;
    versionSelect.appendChild(option);
  });
  if (!currentConfig.lastVersion && installedVersions.length > 0) {
    versionSelect.value = installedVersions[0];
  }
}

function populateVersionsList() {
  const versionsList = document.getElementById('versionsList');
  if (!versionsList) return;
  versionsList.innerHTML = '';
  if (!availableVersions || availableVersions.length === 0) {
    versionsList.innerHTML = `<div class="loading-spinner">${t('versions_no_versions')}</div>`;
    return;
  }
  const displayVersions = currentFilter === 'vanilla'
    ? availableVersions.filter(v => v.type === 'release')
    : availableVersions;
  if (displayVersions.length === 0) {
    versionsList.innerHTML = `<div class="loading-spinner">${t('versions_no_versions')}</div>`;
    return;
  }
  displayVersions.forEach(version => {
    const card = document.createElement('div');
    card.className = 'version-card';
    const loaderType = version.loader || 'vanilla';
    card.setAttribute('data-version-type', loaderType);
    const isInstalled = installedVersions.includes(version.id);
    if (isInstalled) card.classList.add('installed');
    let versionName = version.id;
    let versionBadge = loaderType;
    if (version.mcVersion) {
      versionName = `${version.mcVersion}`;
      if (loaderType === 'forge') versionBadge = `Forge ${version.forgeVersion}`;
      else if (loaderType === 'neoforge') versionBadge = `NeoForge ${version.neoforgeVersion}`;
      else if (loaderType === 'fabric') versionBadge = `Fabric ${version.fabricVersion}`;
      else if (loaderType === 'quilt') versionBadge = `Quilt ${version.quiltVersion}`;
      else if (loaderType === 'optifine') versionBadge = `OptiFine ${version.optifineVersion}`;
    }
    card.innerHTML = `
      <div class="version-name">${versionName}</div>
      <div class="version-type ${loaderType}">${versionBadge}</div>
      ${isInstalled ? `<div class="version-status">${t('version_installed_status')}</div>` : `<div class="version-status">${t('version_click_install')}</div>`}
      <div class="version-loader hidden">
        <div class="loader-spinner"></div>
        <span>${t('common_loading')}</span>
      </div>
      ${isInstalled ? `<button class="delete-version-btn" data-version="${version.id}">${t('version_delete_btn')}</button>` : ''}
    `;
    if (!isInstalled) {
      card.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const loader = card.querySelector('.version-loader');
        const status = card.querySelector('.version-status');
        if (status) status.classList.add('hidden');
        if (loader) loader.classList.remove('hidden');
        card.style.pointerEvents = 'none';
        console.log('Downloading version:', version.id);
        await downloadVersion(version.id);
        setTimeout(() => switchTab('play'), 1000);
      });
    } else {
      const deleteBtn = card.querySelector('.delete-version-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await deleteVersion(version.id);
        });
      }
    }
    versionsList.appendChild(card);
  });
}

async function downloadVersion(versionId) {
  const progressContainer = document.getElementById('downloadProgress');
  const progressStage = document.getElementById('progressStage');
  const progressPercent = document.getElementById('progressPercent');
  const progressFill = document.getElementById('progressFill');
  const playBtn = document.getElementById('playBtn');
  if (!progressContainer) return;
  progressContainer.classList.remove('hidden');
  if (playBtn) playBtn.disabled = true;
  ipcRenderer.on('download-progress', (event, progress) => {
    if (progressStage) progressStage.textContent = progress.stage;
    if (progressPercent) progressPercent.textContent = `${Math.round(progress.progress)}%`;
    if (progressFill) progressFill.style.width = `${progress.progress}%`;
  });

  ipcRenderer.on('mod-download-progress', (event, progress) => {
    if (progressContainer) progressContainer.classList.remove('hidden');
    if (progressStage) progressStage.textContent = t('version_downloading', {file: progress.fileName || t('common_file')});
    if (progressPercent) progressPercent.textContent = `${Math.round(progress.percentage || 0)}%`;
    if (progressFill) progressFill.style.width = `${progress.percentage || 0}%`;
  });
  try {
    const result = await ipcRenderer.invoke('download-version', versionId);
    if (result.success) {
      if (progressStage) progressStage.textContent = t('version_download_complete');
      if (progressPercent) progressPercent.textContent = '100%';
      if (progressFill) progressFill.style.width = '100%';
      setTimeout(async () => {
        progressContainer.classList.add('hidden');
        await loadVersions();
        if (playBtn) playBtn.disabled = false;
      }, 2000);
    } else {
      notify('version_download_error', {error: result.error}, 'error');
      progressContainer.classList.add('hidden');
      if (playBtn) playBtn.disabled = false;
    }
  } catch (error) {
    console.error('Download error:', error);
    notify('error_download_version', {}, 'error');
    progressContainer.classList.add('hidden');
    if (playBtn) playBtn.disabled = false;
  }
}

function setupEventListeners() {
  const minimizeBtn = document.getElementById('minimizeBtn');
  const closeBtn = document.getElementById('closeBtn');
  if (minimizeBtn) minimizeBtn.addEventListener('click', () => ipcRenderer.invoke('minimize-window'));
  if (closeBtn) closeBtn.addEventListener('click', () => ipcRenderer.invoke('close-window'));

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      switchTab(tabName);
    });
  });

  const playBtn = document.getElementById('playBtn');
  if (playBtn) playBtn.addEventListener('click', async () => await launchGame());

  const memorySlider = document.getElementById('memorySlider');
  const memoryInput = document.getElementById('memoryInput');
  if (memorySlider) memorySlider.addEventListener('input', (e) => {
    if (memoryInput) memoryInput.value = e.target.value;
    currentConfig.memory = parseInt(e.target.value);
    updateSliderFill(memorySlider);
    autoSaveConfig();
  });
  if (memoryInput) memoryInput.addEventListener('input', (e) => {
    if (memorySlider) memorySlider.value = e.target.value;
    currentConfig.memory = parseInt(e.target.value);
    updateSliderFill(memorySlider);
    autoSaveConfig();
  });

  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', async () => await saveSettings());

  const languageSelect = document.getElementById('languageSelect');
  if (languageSelect) languageSelect.addEventListener('change', (e) => {
    const newLang = e.target.value;
    currentConfig.language = newLang;
    if (localizationManager) {
      localizationManager.setLanguage(newLang);
      localizationManager.applyTranslations();
      if (typeof setTranslateFunction === 'function') {
        setTranslateFunction((key) => localizationManager.t(key));
      }
    }
    autoSaveConfig();
    updateUI();
    loadVersions();
    loadAccounts();
  });

  const openInstanceBtn = document.getElementById('openInstanceBtn');
  if (openInstanceBtn) openInstanceBtn.addEventListener('click', async () => {
    const versionSelect = document.getElementById('versionSelect');
    const selectedVersion = versionSelect ? versionSelect.value : null;
    if (selectedVersion) await ipcRenderer.invoke('open-instance-folder', selectedVersion);
  });

  const deleteVersionBtn = document.getElementById('deleteVersionBtn');
  if (deleteVersionBtn) deleteVersionBtn.addEventListener('click', async () => {
    const versionSelect = document.getElementById('versionSelect');
    const selectedVersion = versionSelect ? versionSelect.value : null;
    if (!selectedVersion) {
      notify('version_select_first', {}, 'error');
      return;
    }
    await deleteVersion(selectedVersion);
  });

  const isolationBtn = document.getElementById('isolationBtn');
  if (isolationBtn) isolationBtn.addEventListener('click', async () => {
    const versionSelect = document.getElementById('versionSelect');
    const selectedVersion = versionSelect ? versionSelect.value : null;
    if (!selectedVersion) {
      notify('version_select_first', {}, 'error');
      return;
    }
    const wasIsolated = isolatedVersions.has(selectedVersion);
    const willBeIsolated = !wasIsolated;
    try {
      const result = await ipcRenderer.invoke('toggle-isolation', { version: selectedVersion, isolated: willBeIsolated });
      if (result.success) {
        if (willBeIsolated) {
          isolatedVersions.add(selectedVersion);
          notify('isolation_enabled', {}, 'success');
        } else {
          isolatedVersions.delete(selectedVersion);
          notify('isolation_disabled', {}, 'info');
        }
        saveIsolationSettings();
        updateIsolationUI();
      } else {
        notify('error_general', {error: result.error}, 'error');
      }
    } catch (error) {
      console.error('Toggle isolation error:', error);
      notify('error_switch_isolation', {}, 'error');
    }
  });

  const versionSelect = document.getElementById('versionSelect');
  if (versionSelect) versionSelect.addEventListener('change', () => updateIsolationUI());

  document.querySelectorAll('.optimization-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.optimization-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentConfig.optimizationProfile = btn.getAttribute('data-profile');
      autoSaveConfig();
    });
  });

  const versionSearch = document.getElementById('versionSearch');
  if (versionSearch) versionSearch.addEventListener('input', (e) => filterVersions(e.target.value));

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.getAttribute('data-filter');
      filterByType(filter);
    });
  });
}

function filterByType(type) {
  currentFilter = type;
  if (type === 'vanilla') availableVersions = allVersionsData.vanilla || [];
  else if (type === 'forge') availableVersions = allVersionsData.forge || [];
  else if (type === 'neoforge') availableVersions = allVersionsData.neoforge || [];
  else if (type === 'fabric') availableVersions = allVersionsData.fabric || [];
  else if (type === 'quilt') availableVersions = allVersionsData.quilt || [];
  else if (type === 'optifine') availableVersions = allVersionsData.optifine || [];
  else if (type === 'all') {
    availableVersions = [
      ...(allVersionsData.vanilla || []),
      ...(allVersionsData.forge || []),
      ...(allVersionsData.neoforge || []),
      ...(allVersionsData.fabric || []),
      ...(allVersionsData.quilt || []),
      ...(allVersionsData.optifine || [])
    ];
  }
  populateVersionsList();
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  const tabBtn = document.querySelector(`[data-tab="${tabName}"]`);
  const tabContent = document.getElementById(`${tabName}Tab`);
  if (tabBtn) tabBtn.classList.add('active');
  if (tabContent) tabContent.classList.add('active');
  if (tabName === 'stats') loadStats();
}

async function updateUI() {
  const displayUsername = document.getElementById('displayUsername');
  const memorySlider = document.getElementById('memorySlider');
  const memoryInput = document.getElementById('memoryInput');
  const activeAccountResult = await ipcRenderer.invoke('accounts-get-active');
  if (activeAccountResult.success && activeAccountResult.account) {
    const activeAccount = activeAccountResult.account;
    if (displayUsername) displayUsername.textContent = activeAccount.username;
    const userSubtitle = document.querySelector('.user-subtitle');
    if (userSubtitle) {
      userSubtitle.textContent = activeAccount.type === 'ely' ? t('accounts_ely') : t('accounts_local');
    }
  } else {
    if (displayUsername) displayUsername.textContent = t('accounts_empty');
    const userSubtitle = document.querySelector('.user-subtitle');
    if (userSubtitle) {
      userSubtitle.textContent = t('accounts_select');
    }
  }
  if (memorySlider) { memorySlider.value = currentConfig.memory; updateSliderFill(memorySlider); }
  if (memoryInput) memoryInput.value = currentConfig.memory;
  const profile = currentConfig.optimizationProfile || 'balanced';
  document.querySelectorAll('.optimization-btn').forEach(btn => {
    if (btn.getAttribute('data-profile') === profile) btn.classList.add('active');
    else btn.classList.remove('active');
  });
  updateIsolationUI();
}

function updateIsolationUI() {
  const versionSelect = document.getElementById('versionSelect');
  const isolationBtn = document.getElementById('isolationBtn');
  const isolationStatus = document.getElementById('isolationStatus');
  if (!versionSelect || !isolationBtn || !isolationStatus) return;
  const selectedVersion = versionSelect.value;
  if (!selectedVersion) {
    isolationBtn.classList.remove('active');
    isolationStatus.classList.remove('isolated');
    const textSpan = isolationStatus.querySelector('.isolation-text');
    if (textSpan) textSpan.textContent = t('play_shared_folder');
    return;
  }
  if (isolatedVersions.has(selectedVersion)) {
    isolationBtn.classList.add('active');
    isolationStatus.classList.add('isolated');
    const textSpan = isolationStatus.querySelector('.isolation-text');
    if (textSpan) textSpan.textContent = t('play_isolated_folder');
  } else {
    isolationBtn.classList.remove('active');
    isolationStatus.classList.remove('isolated');
    const textSpan = isolationStatus.querySelector('.isolation-text');
    if (textSpan) textSpan.textContent = t('play_shared_folder');
  }
}

async function launchGame() {
  const versionSelect = document.getElementById('versionSelect');
  const selectedVersion = versionSelect ? versionSelect.value : null;
  if (!selectedVersion) {
    notify('launch_no_version', {}, 'error');
    return;
  }
  const activeAccountResult = await ipcRenderer.invoke('accounts-get-active');
  if (!activeAccountResult.success || !activeAccountResult.account) {
    notify('launch_no_account', {}, 'error');
    return;
  }
  const activeAccount = activeAccountResult.account;
  const playBtn = document.getElementById('playBtn');
  const playText = playBtn ? playBtn.querySelector('.play-button-text') : null;
  if (playBtn) playBtn.disabled = true;
  if (playText) playText.textContent = t('launch_checking');
  try {
    const isReady = await ipcRenderer.invoke('check-version-ready', selectedVersion);
    if (!isReady) {
      notify('launch_version_not_ready', {}, 'error');
      if (playText) playText.textContent = t('play_button');
      if (playBtn) playBtn.disabled = false;
      return;
    }
    if (playText) playText.textContent = t('launch_starting');
    const launchConfig = {
      version: selectedVersion,
      username: activeAccount.username,
      memory: currentConfig.memory,
      isolated: isolatedVersions.has(selectedVersion),
      optimizationProfile: currentConfig.optimizationProfile || 'balanced',
      selectedGPU: currentConfig.selectedGPU || 0,
      elyAuth: activeAccount.type === 'ely' ? {
        accessToken: activeAccount.accessToken,
        refreshToken: activeAccount.refreshToken,
        expiresAt: activeAccount.expiresAt,
        username: activeAccount.username,
        uuid: activeAccount.uuid
      } : null,
      preferredJava: currentConfig.preferredJava
    };
    const result = await ipcRenderer.invoke('launch-game', launchConfig);
    if (result.success) {
      notify('launch_success', {}, 'success');
      await ipcRenderer.invoke('minimize-window');
      setTimeout(() => {
        if (playText) playText.textContent = t('play_button');
        if (playBtn) playBtn.disabled = false;
      }, 1000);
      await loadRunningInstances();
    } else {
      notify('error_general', {error: result.error || t('launch_failed')}, 'error');
      if (playText) playText.textContent = t('play_button');
      if (playBtn) playBtn.disabled = false;
    }
  } catch (error) {
    console.error('Launch error:', error);
    if (error.message && !error.message.includes('Java')) {
      notify('error_launch', {}, 'error');
    } else {
      console.warn('Java warning during launch:', error.message);
    }
    if (playText) playText.textContent = t('play_button');
    if (playBtn) playBtn.disabled = false;
  }
}

ipcRenderer.on('instance-started', () => loadRunningInstances());
ipcRenderer.on('instance-stopped', () => loadRunningInstances());

async function saveSettings() {
  const memoryInput = document.getElementById('memoryInput');
  const memory = memoryInput ? parseInt(memoryInput.value) : 2048;
  let memInfo;
  try {
    memInfo = await ipcRenderer.invoke('get-system-memory');
  } catch (e) {
    memInfo = { maxAllocation: 16384 };
  }
  if (memory < 512 || memory > memInfo.maxAllocation) {
    notify('settings_invalid_ram', {max: memInfo.maxAllocation}, 'error');
    return;
  }
  currentConfig.memory = memory;
  currentConfig.optimizationProfile = currentConfig.optimizationProfile || 'balanced';
  currentConfig.selectedGPU = currentConfig.selectedGPU || 0;
  try {
    await ipcRenderer.invoke('save-config', currentConfig);
    await saveIsolationSettings();
    notify('settings_saved', {}, 'success');
    updateUI();
  } catch (error) {
    console.error('Save error:', error);
    notify('settings_save_error', {}, 'error');
  }
}

function filterVersions(searchTerm) {
  const cards = document.querySelectorAll('.version-card');
  const lowerSearch = searchTerm.toLowerCase();
  cards.forEach(card => {
    const versionName = card.querySelector('.version-name');
    if (versionName && versionName.textContent.toLowerCase().includes(lowerSearch)) card.style.display = 'flex';
    else card.style.display = 'none';
  });
}

async function deleteVersion(versionId) {
  const confirmed = await CustomDialog.confirm(
    t('account_delete_confirm_title'),
    t('dialog_delete_confirm', {version: versionId})
  );
  if (!confirmed) return;
  try {
    const result = await ipcRenderer.invoke('delete-version', versionId);
    if (result.success) {
      notify('version_delete_success', {version: versionId}, 'success');
      await loadVersions();
    } else {
      notify('error_delete', {error: result.error}, 'error');
    }
  } catch (error) {
    console.error('Error deleting version:', error);
    notify('account_delete_error', {}, 'error');
  }
}

async function loadStats() {
  try {
    const stats = await ipcRenderer.invoke('get-stats');
    const favorite = await ipcRenderer.invoke('get-favorite-version');
    document.getElementById('totalPlaytime').textContent = formatPlaytime(stats.totalPlaytime);
    document.getElementById('totalLaunches').textContent = stats.totalLaunches;
    document.getElementById('favoriteVersion').textContent = favorite ? favorite.version : '-';
    displayLaunchHistory(stats.launchHistory);
    displayVersionStats(stats.versions);
  } catch (error) {
    console.error('Error loading stats:', error);
    document.getElementById('totalPlaytime').textContent = t('stats_no_data');
    document.getElementById('totalLaunches').textContent = '0';
    document.getElementById('favoriteVersion').textContent = '-';
    document.getElementById('launchHistory').innerHTML = `<div class="empty-state">${t('stats_history_empty')}</div>`;
    document.getElementById('versionStats').innerHTML = `<div class="empty-state">${t('stats_no_data')}</div>`;
  }
}

function formatPlaytime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const lang = localizationManager ? localizationManager.getLanguage() : 'ru';
  if (lang === 'en') return `${hours}h ${mins}m`;
  return `${hours} ч ${mins} м`;
}

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 1000 / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return t('time_just_now');
  if (diffMins < 60) return `${diffMins} ${t('time_min_ago')}`;
  if (diffHours < 24) return `${diffHours} ${t('time_h_ago')}`;
  if (diffDays === 1) return t('time_yesterday');
  if (diffDays < 7) return `${diffDays} ${t('time_d_ago')}`;
  return date.toLocaleDateString(localizationManager ? (localizationManager.getLanguage() === 'en' ? 'en-US' : 'ru-RU') : 'ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function displayLaunchHistory(history) {
  const container = document.getElementById('launchHistory');
  if (!container) return;
  if (!history || history.length === 0) {
    container.innerHTML = `<div class="empty-state">${t('stats_history_empty')}</div>`;
    return;
  }
  container.innerHTML = '';
  history.slice(0, 20).forEach(item => {
    const div = document.createElement('div');
    div.className = 'launch-item';
    div.innerHTML = `<div><div class="launch-version">${item.version}</div><div class="launch-time">${formatTimestamp(item.timestamp)} • ${item.duration} ${t('stats_minutes')}</div></div>`;
    container.appendChild(div);
  });
}

function displayVersionStats(versions) {
  const container = document.getElementById('versionStats');
  if (!container) return;
  if (!versions || Object.keys(versions).length === 0) {
    container.innerHTML = `<div class="empty-state">${t('stats_no_data')}</div>`;
    return;
  }
  container.innerHTML = '';
  const sortedVersions = Object.entries(versions).sort((a, b) => b[1].playtime - a[1].playtime);
  sortedVersions.forEach(([version, data]) => {
    const card = document.createElement('div');
    card.className = 'version-stat-card';
    let loaderType = 'vanilla';
    if (version.includes('-forge-')) loaderType = 'forge';
    else if (version.includes('-fabric-')) loaderType = 'fabric';
    else if (version.includes('-neoforge-')) loaderType = 'neoforge';
    else if (version.includes('-quilt-')) loaderType = 'quilt';
    else if (version.includes('-optifine-')) loaderType = 'optifine';
    card.innerHTML = `
      <div class="version-stat-header">
        <div class="version-stat-name">${version}</div>
        <div class="version-stat-badge ${loaderType}">${loaderType}</div>
      </div>
      <div class="version-stat-info">
        <div class="version-stat-row"><span>${t('stats_total_time')}</span><span>${formatPlaytime(data.playtime)}</span></div>
        <div class="version-stat-row"><span>${t('stats_total_launches')}</span><span>${data.launches}</span></div>
        <div class="version-stat-row"><span>${t('stats_last_played')}</span><span>${formatTimestamp(data.lastPlayed)}</span></div>
      </div>
    `;
    container.appendChild(card);
  });
}

async function initElyByAuth() {
  const elyLoginBtn = document.getElementById('elyLoginBtn');
  const elyLogoutBtn = document.getElementById('elyLogoutBtn');
  if (elyLoginBtn) elyLoginBtn.addEventListener('click', async () => await handleElyLogin());
  if (elyLogoutBtn) elyLogoutBtn.addEventListener('click', async () => await handleElyLogout());
  await updateElyAuthUI();
}

async function handleElyLogin() {
  const loginBtn = document.getElementById('elyLoginBtn');
  if (!loginBtn) return;
  const originalText = loginBtn.innerHTML;
  loginBtn.disabled = true;
  loginBtn.innerHTML = `<span>${t('ely_opening_browser')}</span>`;
  try {
    const result = await ipcRenderer.invoke('ely-start-oauth');
    if (result.success && result.tokens) {
      const expiresAt = Date.now() + (result.tokens.expiresIn * 1000);
      const accountResult = await ipcRenderer.invoke('ely-get-account-info', result.tokens.accessToken);
      if (accountResult.success) {
        currentConfig.elyAuth = {
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          expiresAt: expiresAt,
          username: accountResult.accountInfo.username,
          uuid: accountResult.accountInfo.uuid
        };
        currentConfig.username = accountResult.accountInfo.username;
        await autoSaveConfig();
        await updateElyAuthUI();
        notify('ely_oauth_success', {}, 'success');
      } else {
        throw new Error(t('ely_account_info_error'));
      }
    } else {
      throw new Error(result.error || t('error_auth'));
    }
  } catch (error) {
    console.error('Login failed:', error);
    notify('ely_oauth_error', {error: error.message}, 'error');
    loginBtn.innerHTML = originalText;
    loginBtn.disabled = false;
  }
}

async function handleElyLogout() {
  const confirmed = await CustomDialog.confirm(
    t('account_delete_confirm_title'),
    t('ely_logout_confirm')
  );
  if (!confirmed) return;
  try {
    if (currentConfig.elyAuth && currentConfig.elyAuth.accessToken) {
      await ipcRenderer.invoke('ely-logout', currentConfig.elyAuth.accessToken);
    }
    currentConfig.elyAuth = null;
    await autoSaveConfig();
    await updateElyAuthUI();
    notify('ely_logout_success', {}, 'info');
  } catch (error) {
    console.error('Logout failed:', error);
    notify('error_logout', {}, 'error');
  }
}

async function updateElyAuthUI() {
  const notLoggedIn = document.getElementById('elyNotLoggedIn');
  const loggedIn = document.getElementById('elyLoggedIn');
  if (!notLoggedIn || !loggedIn) return;
  if (currentConfig.elyAuth) {
    const isExpired = Date.now() >= currentConfig.elyAuth.expiresAt;
    if (isExpired && currentConfig.elyAuth.refreshToken) {
      try {
        const result = await ipcRenderer.invoke('ely-refresh-token', currentConfig.elyAuth.refreshToken);
        if (result.success && result.tokens) {
          currentConfig.elyAuth.accessToken = result.tokens.accessToken;
          currentConfig.elyAuth.refreshToken = result.tokens.refreshToken;
          currentConfig.elyAuth.expiresAt = Date.now() + (result.tokens.expiresIn * 1000);
          await autoSaveConfig();
        } else {
          currentConfig.elyAuth = null;
          await autoSaveConfig();
          notLoggedIn.classList.remove('hidden');
          loggedIn.classList.add('hidden');
          return;
        }
      } catch (error) {
        console.error('Token refresh failed:', error);
        currentConfig.elyAuth = null;
        await autoSaveConfig();
        notLoggedIn.classList.remove('hidden');
        loggedIn.classList.add('hidden');
        return;
      }
    }
    notLoggedIn.classList.add('hidden');
    loggedIn.classList.remove('hidden');
    const usernameEl = document.getElementById('elyAccountUsername');
    const emailEl = document.getElementById('elyAccountEmail');
    if (usernameEl) usernameEl.textContent = currentConfig.elyAuth.username;
    if (emailEl) emailEl.textContent = currentConfig.elyAuth.uuid || '-';
  } else {
    notLoggedIn.classList.remove('hidden');
    loggedIn.classList.add('hidden');
  }
}

let allAccounts = [];
let selectedAccountId = null;

async function initAccountsTab() {
  const addAccountBtn = document.getElementById('addAccountBtn');
  const selectAccountBtn = document.getElementById('selectAccountBtn');
  const editAccountBtn = document.getElementById('editAccountBtn');
  const removeAccountBtn = document.getElementById('removeAccountBtn');
  const skinFileInput = document.getElementById('skinFileInput');
  if (addAccountBtn) addAccountBtn.addEventListener('click', () => showAddAccountDialog());
  if (selectAccountBtn) selectAccountBtn.addEventListener('click', async () => {
    if (selectedAccountId) await setActiveAccount(selectedAccountId);
  });
  if (editAccountBtn) editAccountBtn.addEventListener('click', () => {
    if (skinFileInput) skinFileInput.click();
  });
  if (removeAccountBtn) removeAccountBtn.addEventListener('click', async () => {
    if (selectedAccountId) await removeAccount(selectedAccountId);
  });
  if (skinFileInput) skinFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file && selectedAccountId) await uploadAccountSkin(selectedAccountId, file);
  });
  await loadAccounts();
}

async function loadAccounts() {
  try {
    const result = await ipcRenderer.invoke('accounts-get-all');
    if (result.success) {
      allAccounts = result.accounts;
      await displayAccounts();
      const activeResult = await ipcRenderer.invoke('accounts-get-active');
      if (activeResult.success && activeResult.account) {
        currentConfig.username = activeResult.account.username;
        currentConfig.elyAuth = activeResult.account.type === 'ely' ? {
          accessToken: activeResult.account.accessToken,
          refreshToken: activeResult.account.refreshToken,
          expiresAt: activeResult.account.expiresAt,
          username: activeResult.account.username,
          uuid: activeResult.account.uuid
        } : null;
      }
    }
  } catch (error) {
    console.error('Error loading accounts:', error);
  }
}

async function displayAccounts() {
  const accountsList = document.getElementById('accountsList');
  if (!accountsList) return;
  if (allAccounts.length === 0) {
    accountsList.innerHTML = `<div class="empty-state">${t('accounts_empty')}</div>`;
    return;
  }
  accountsList.innerHTML = '';
  const activeResult = await ipcRenderer.invoke('accounts-get-active');
  const activeAccountId = activeResult.success && activeResult.account ? activeResult.account.id : null;
  allAccounts.forEach(account => {
    const item = document.createElement('div');
    item.className = 'account-item';
    if (account.id === activeAccountId) item.classList.add('active');
    const avatarHtml = account.skin
      ? `<img src="${account.skin}" alt="${account.username}">`
      : `<svg width="48" height="48" viewBox="0 0 48 48" fill="currentColor">
           <rect width="48" height="48" fill="#2a2a2a"/>
           <path d="M24 8C18.5 8 14 12.5 14 18C14 23.5 18.5 28 24 28C29.5 28 34 23.5 34 18C34 12.5 29.5 8 24 8ZM24 40C17.3 40 11.8 36.8 8 32C8 26 20 22.7 24 22.7C28 22.7 40 26 40 32C36.2 36.8 30.7 40 24 40Z" fill="#666"/>
         </svg>`;
    item.innerHTML = `
      <div class="account-item-avatar">${avatarHtml}</div>
      <div class="account-item-info">
        <div class="account-item-name">${account.username}</div>
        <div class="account-item-type">${account.type === 'ely' ? 'Ely.by' : t('accounts_local')}</div>
      </div>
    `;
    item.addEventListener('click', () => selectAccount(account.id));
    accountsList.appendChild(item);
  });
}

async function selectAccount(accountId) {
  selectedAccountId = accountId;
  const account = allAccounts.find(acc => acc.id === accountId);
  if (!account) return;
  document.querySelectorAll('.account-item').forEach(item => item.classList.remove('selected'));
  const selectedItem = Array.from(document.querySelectorAll('.account-item')).find(item => {
    return item.querySelector('.account-item-name').textContent === account.username;
  });
  if (selectedItem) selectedItem.classList.add('selected');
  const detailsEmpty = document.querySelector('.account-details-empty');
  const details = document.getElementById('accountDetails');
  if (detailsEmpty) detailsEmpty.style.display = 'none';
  if (details) details.classList.remove('hidden');
  const nameEl = document.getElementById('accountNameLarge');
  const typeBadge = document.getElementById('accountTypeBadge');
  const uuidDisplay = document.getElementById('accountUuidDisplay');
  const avatarLarge = document.getElementById('accountAvatarLarge');
  const skinPreview = document.getElementById('skinPreviewLarge');
  if (nameEl) nameEl.textContent = account.username;
  if (typeBadge) {
    typeBadge.textContent = account.type === 'ely' ? 'Ely.by' : t('accounts_local');
    typeBadge.className = 'account-type-badge';
    if (account.type === 'ely') typeBadge.classList.add('ely');
  }
  if (uuidDisplay) uuidDisplay.textContent = `UUID: ${account.uuid}`;
  if (avatarLarge) {
    if (account.skin) avatarLarge.innerHTML = `<img src="${account.skin}" alt="${account.username}">`;
    else avatarLarge.innerHTML = `<svg width="96" height="96" viewBox="0 0 96 96" fill="currentColor"><rect width="96" height="96" fill="#2a2a2a"/><path d="M48 16C37 16 28 25 28 36C28 47 37 56 48 56C59 56 68 47 68 36C68 25 59 16 48 16ZM48 80C34.7 80 23.5 73.5 16 64C16 52 40 45.3 48 45.3C56 45.3 80 52 80 64C72.5 73.5 61.3 80 48 80Z" fill="#666"/></svg>`;
  }
  if (skinPreview) {
    if (account.skin) skinPreview.innerHTML = `<img src="${account.skin}" alt="${account.username}">`;
    else skinPreview.innerHTML = `<div class="skin-placeholder">${t('accounts_no_skin')}</div>`;
  }

  const selectAccountBtn = document.getElementById('selectAccountBtn');
  if (selectAccountBtn) {
    const activeResult = await ipcRenderer.invoke('accounts-get-active');
    const activeAccountId = activeResult.success && activeResult.account ? activeResult.account.id : null;
    if (account.id === activeAccountId) {
      selectAccountBtn.disabled = true;
      selectAccountBtn.style.opacity = '0.5';
      const span = selectAccountBtn.querySelector('span');
      if (span) span.textContent = t('account_active');
    } else {
      selectAccountBtn.disabled = false;
      selectAccountBtn.style.opacity = '1';
      const span = selectAccountBtn.querySelector('span');
      if (span) span.textContent = t('accounts_select_btn');
    }
  }
}

async function setActiveAccount(accountId) {
  try {
    const result = await ipcRenderer.invoke('accounts-set-active', accountId);
    if (result.success) {
      notify('account_selected_success', {}, 'success');
      await loadAccounts();
      await displayAccounts();
      updateUI();
      if (selectedAccountId === accountId) {
        const selectAccountBtn = document.getElementById('selectAccountBtn');
        if (selectAccountBtn) {
          selectAccountBtn.disabled = true;
          selectAccountBtn.style.opacity = '0.5';
          const span = selectAccountBtn.querySelector('span');
          if (span) span.textContent = t('account_active');
        }
      }
    } else {
      notify('account_select_error', {}, 'error');
    }
  } catch (error) {
    console.error('Error setting active account:', error);
    notify('account_select_error', {}, 'error');
  }
}

async function removeAccount(accountId) {
  const confirmed = await CustomDialog.confirm(
    t('account_delete_confirm_title'),
    t('account_delete_confirm_message')
  );
  if (!confirmed) return;
  try {
    const result = await ipcRenderer.invoke('accounts-remove', accountId);
    if (result.success) {
      notify('account_delete_success', {}, 'success');
      selectedAccountId = null;
      const detailsEmpty = document.querySelector('.account-details-empty');
      const details = document.getElementById('accountDetails');
      if (detailsEmpty) detailsEmpty.style.display = 'flex';
      if (details) details.classList.add('hidden');
      await loadAccounts();
      await displayAccounts();
    } else {
      notify('error_general', {error: result.error}, 'error');
    }
  } catch (error) {
    console.error('Error removing account:', error);
    notify('account_delete_error', {}, 'error');
  }
}

async function uploadAccountSkin(accountId, file) {
  try {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result;
      const img = new Image();
      img.onload = async () => {
        if ((img.width === 64 && (img.height === 64 || img.height === 32)) || (img.width === 128 && (img.height === 128 || img.height === 64))) {
          const result = await ipcRenderer.invoke('accounts-update-skin', accountId, base64);
          if (result.success) {
            notify('skin_updated', {}, 'success');
            await loadAccounts();
            selectAccount(accountId);
          } else {
            notify('error_save_skin', {}, 'error');
          }
        } else {
          notify('skin_invalid_size', {}, 'error');
        }
      };
      img.src = base64;
    };
    reader.readAsDataURL(file);
  } catch (error) {
    console.error('Error uploading skin:', error);
    notify('error_load_skin', {}, 'error');
  }
}

function showAddAccountDialog() {
  const dialog = document.createElement('div');
  dialog.className = 'modal-overlay';
  dialog.innerHTML = `
    <div class="modal-content account-dialog">
      <h3>${t('accounts_add')}</h3>
      <div class="account-type-selection">
        <button class="account-type-option" data-type="local">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="currentColor">
            <path d="M16 4C10.5 4 6 8.5 6 14C6 19.5 10.5 24 16 24C21.5 24 26 19.5 26 14C26 8.5 21.5 4 16 4ZM16 8C17.7 8 19 9.3 19 11C19 12.7 17.7 14 16 14C14.3 14 13 12.7 13 11C13 9.3 14.3 8 16 8ZM16 28C12.7 28 9.8 26.4 8 24C8 20.7 14.7 18.7 16 18.7C17.3 18.7 24 20.7 24 24C22.2 26.4 19.3 28 16 28Z"/>
          </svg>
          <span>${t('accounts_local')}</span>
          <p>${t('accounts_local_desc')}</p>
        </button>
        <button class="account-type-option" data-type="ely">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="currentColor">
            <path d="M16 2C8.3 2 2 8.3 2 16C2 23.7 8.3 30 16 30C23.7 30 30 23.7 30 16C30 8.3 23.7 2 16 2ZM16 6C18.2 6 20 7.8 20 10C20 12.2 18.2 14 16 14C13.8 14 12 12.2 12 10C12 7.8 13.8 6 16 6ZM16 26C12 26 8.6 23.6 7 20C7 16.7 13.3 14.7 16 14.7C18.7 14.7 25 16.7 25 20C23.4 23.6 20 26 16 26Z"/>
          </svg>
          <span>Ely.by</span>
          <p>${t('accounts_ely_desc')}</p>
        </button>
      </div>
      <button class="modal-close-btn">${t('common_cancel')}</button>
    </div>
  `;
  document.body.appendChild(dialog);
  const localBtn = dialog.querySelector('[data-type="local"]');
  const elyBtn = dialog.querySelector('[data-type="ely"]');
  const closeBtn = dialog.querySelector('.modal-close-btn');
  localBtn.addEventListener('click', async () => {
    dialog.remove();
    await showAddLocalAccountDialog();
  });
  elyBtn.addEventListener('click', async () => {
    dialog.remove();
    await addElyByAccount();
  });
  closeBtn.addEventListener('click', () => dialog.remove());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.remove();
  });
}

async function showAddLocalAccountDialog() {
  const dialog = document.createElement('div');
  dialog.className = 'modal-overlay';
  dialog.innerHTML = `
    <div class="modal-content local-account-dialog">
      <h3>${t('accounts_add_local')}</h3>
      <div class="dialog-body">
        <label>
          <span>${t('account_username')}</span>
          <input type="text" id="localAccountUsername" class="styled-input" placeholder="${t('account_username_placeholder')}" maxlength="16">
        </label>
      </div>
      <div class="dialog-actions">
        <button class="modal-close-btn">${t('common_cancel')}</button>
        <button class="modal-confirm-btn" id="confirmAddLocal">${t('accounts_add')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  const input = dialog.querySelector('#localAccountUsername');
  const confirmBtn = dialog.querySelector('#confirmAddLocal');
  const closeBtn = dialog.querySelector('.modal-close-btn');
  confirmBtn.addEventListener('click', async () => {
    const username = input.value.trim();
    if (!username) {
      notify('account_invalid_username', {}, 'error');
      return;
    }
    try {
      const result = await ipcRenderer.invoke('accounts-add-local', username);
      if (result.success) {
        notify('account_local_add_success', {}, 'success');
        dialog.remove();
        await loadAccounts();
        await displayAccounts();
      } else {
        notify('error_general', {error: result.error}, 'error');
      }
    } catch (error) {
      console.error('Error adding local account:', error);
      notify('account_add_error', {}, 'error');
    }
  });
  closeBtn.addEventListener('click', () => dialog.remove());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.remove();
  });
  input.focus();
}

async function addElyByAccount() {
  const dialog = document.createElement('div');
  dialog.className = 'modal-overlay';
  dialog.innerHTML = `
    <div class="modal-content ely-login-dialog">
      <h3>${t('ely_login_title')}</h3>
      <div class="dialog-body">
        <label>
          <span>${t('ely_username')}</span>
          <input type="text" id="elyUsername" class="styled-input" placeholder="${t('ely_username_placeholder')}">
        </label>
        <label>
          <span>${t('ely_password')}</span>
          <input type="password" id="elyPassword" class="styled-input" placeholder="${t('ely_password_placeholder')}">
        </label>
        <div class="ely-login-note">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1C4.1 1 1 4.1 1 8C1 11.9 4.1 15 8 15C11.9 15 15 11.9 15 8C15 4.1 11.9 1 8 1ZM8 3C8.6 3 9 3.4 9 4C9 4.6 8.6 5 8 5C7.4 5 7 4.6 7 4C7 3.4 7.4 3 8 3ZM9 12H7V7H9V12Z"/>
          </svg>
          <span>${t('ely_no_account')} <a href="https://ely.by" target="_blank">${t('ely_register')}</a></span>
        </div>
      </div>
      <div class="dialog-actions">
        <button class="modal-close-btn">${t('common_cancel')}</button>
        <button class="modal-confirm-btn" id="confirmElyLogin">${t('common_login')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  const usernameInput = dialog.querySelector('#elyUsername');
  const passwordInput = dialog.querySelector('#elyPassword');
  const confirmBtn = dialog.querySelector('#confirmElyLogin');
  const closeBtn = dialog.querySelector('.modal-close-btn');
  confirmBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      notify('ely_login_fields_required', {}, 'error');
      return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = t('ely_login_processing');
    try {
      const result = await ipcRenderer.invoke('ely-login-username-password', username, password);
      if (result.success && result.tokens) {
        const expiresAt = Date.now() + (result.tokens.expiresIn * 1000);
        const accountData = {
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          expiresAt: expiresAt,
          username: result.tokens.username || username,
          uuid: result.tokens.uuid
        };
        const addResult = await ipcRenderer.invoke('accounts-add-ely', accountData);
        if (addResult.success) {
          notify('ely_account_add_success', {}, 'success');
          dialog.remove();
          await loadAccounts();
          await displayAccounts();
        } else {
          notify('error_general', {error: addResult.error}, 'error');
          confirmBtn.disabled = false;
          confirmBtn.textContent = t('common_login');
        }
      } else {
        throw new Error(result.error || t('error_auth'));
      }
    } catch (error) {
      console.error('Error adding Ely.by account:', error);
      notify('error_general', {error: error.message}, 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = t('common_login');
    }
  });
  closeBtn.addEventListener('click', () => dialog.remove());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.remove();
  });
  usernameInput.focus();
}

async function loadJavaInfo() {
  const container = document.getElementById('javaVersionsList');
  if (!container) return;
  container.innerHTML = `<div class="system-info-loading">${t('java_info_error')}</div>`;
  try {
    const result = await ipcRenderer.invoke('java-get-all-info');
    if (!result.success) {
      container.innerHTML = `<div class="system-info-loading">${t('error_java_load')}</div>`;
      return;
    }
    const javaVersions = [
      { version: 8, description: t('java_8_desc'), required: true },
      { version: 17, description: t('java_17_desc'), required: true },
      { version: 21, description: t('java_21_desc'), required: true },
      { version: 25, description: t('java_25_desc') || 'For Minecraft 26.x and newer', required: true }
    ];
    container.innerHTML = '';
    for (const javaVer of javaVersions) {
      const isInstalled = result.installed.some(j => j.version === javaVer.version);
      const isSystem = result.system && result.system.version === javaVer.version;
      const isPreferred = currentConfig.preferredJava === javaVer.version;
      const item = document.createElement('div');
      item.className = `java-version-item ${isInstalled || isSystem ? 'installed' : ''}`;
      item.innerHTML = `
        <div class="java-version-info">
          <div class="java-version-icon">${javaVer.version}</div>
          <div class="java-version-details">
            <div class="java-version-name">Java ${javaVer.version}</div>
            <div class="java-version-description">${javaVer.description}</div>
            <div class="java-version-status">
              <span class="java-status-indicator"></span>
              <span>${isInstalled ? t('common_installed') : isSystem ? t('java_system') : t('java_not_installed')}</span>
            </div>
          </div>
        </div>
        <div class="java-version-actions">
          ${!isInstalled && !isSystem ? `
            <button class="java-download-btn" data-version="${javaVer.version}">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 1v9M8 10l3-3M8 10L5 7"/>
                <path d="M2 12v2h12v-2"/>
              </svg>
              <span>${t('java_download_btn')}</span>
            </button>
          ` : ''}
          ${(isInstalled || isSystem) ? `
            <button class="java-use-btn ${isPreferred ? 'active' : ''}" data-version="${javaVer.version}">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="4 8 7 11 12 4"/>
              </svg>
              <span>${isPreferred ? t('java_active') : t('java_use')}</span>
            </button>
          ` : ''}
          ${isInstalled && !isSystem ? `
            <button class="java-delete-btn" data-version="${javaVer.version}">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 4h12M6 4v-1h4v1M4 4v9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4"/>
                <line x1="6" y1="7" x2="6" y2="11"/>
                <line x1="10" y1="7" x2="10" y2="11"/>
              </svg>
              <span>${t('java_delete_btn')}</span>
            </button>
          ` : ''}
        </div>
      `;
      container.appendChild(item);
    }
    container.querySelectorAll('.java-download-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const version = parseInt(btn.dataset.version);
        await downloadJava(version);
      });
    });
    container.querySelectorAll('.java-use-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const version = parseInt(btn.dataset.version);
        await setPreferredJava(version);
      });
    });
    container.querySelectorAll('.java-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const version = parseInt(btn.dataset.version);
        await deleteJava(version);
      });
    });
  } catch (error) {
    console.error('Error loading Java info:', error);
    container.innerHTML = `<div class="system-info-loading">${t('common_error')}</div>`;
  }
}

async function downloadJava(version) {
  const progressContainer = document.getElementById('javaDownloadProgress');
  const progressStage = document.getElementById('javaProgressStage');
  const progressPercent = document.getElementById('javaProgressPercent');
  const progressFill = document.getElementById('javaProgressFill');
  progressContainer.classList.remove('hidden');
  progressStage.textContent = t('java_downloading', {version: version});
  progressPercent.textContent = '0%';
  progressFill.style.width = '0%';
  try {
    const result = await ipcRenderer.invoke('java-download', version);
    if (result.success) {
      notify('java_install_success', {version: version}, 'success');
      await loadJavaInfo();
    } else {
      notify('java_install_error', {version: version, error: result.error}, 'error');
    }
  } catch (error) {
    console.error(`Error downloading Java ${version}:`, error);
    notify('error_general', {error: error.message}, 'error');
  } finally {
    setTimeout(() => {
      progressContainer.classList.add('hidden');
    }, 2000);
  }
}

async function deleteJava(version) {
  const confirmed = await CustomDialog.confirm(
    t('java_delete_confirm_title'),
    t('java_delete_confirm_message', {version: version})
  );
  if (!confirmed) return;
  try {
    const result = await ipcRenderer.invoke('java-delete', version);
    if (result.success) {
      notify('java_delete_success', {version: version}, 'success');
      await loadJavaInfo();
    } else {
      notify('error_general', {error: result.error}, 'error');
    }
  } catch (error) {
    console.error(`Error deleting Java ${version}:`, error);
    notify('error_general', {error: error.message}, 'error');
  }
}

async function setPreferredJava(version) {
  try {
    currentConfig.preferredJava = version;
    await ipcRenderer.invoke('save-config', currentConfig);
    notify('java_set_preferred_success', {version: version}, 'success');
    await loadJavaInfo();
  } catch (error) {
    console.error(`Error setting preferred Java ${version}:`, error);
    notify('error_general', {error: error.message}, 'error');
  }
}

ipcRenderer.on('java-download-progress', (event, progress) => {
  const progressContainer = document.getElementById('javaDownloadProgress');
  const progressStage = document.getElementById('javaProgressStage');
  const progressPercent = document.getElementById('javaProgressPercent');
  const progressFill = document.getElementById('javaProgressFill');
  if (progressContainer.classList.contains('hidden')) {
    progressContainer.classList.remove('hidden');
  }
  progressStage.textContent = progress.message || t('java_downloading', {version: ''});
  progressPercent.textContent = `${progress.progress || 0}%`;
  progressFill.style.width = `${progress.progress || 0}%`;
});

let currentModsPage = 0;
let currentModsQuery = '';
let currentModsFilters = {};
let totalModsResults = 0;
const modsPerPage = 20;
let currentContentType = 'mod';

async function initModsTab() {
  const searchBtn = document.getElementById('modsSearchBtn');
  const searchInput = document.getElementById('modsSearchInput');
  const versionFilter = document.getElementById('modsVersionFilter');
  const loaderFilter = document.getElementById('modsLoaderFilter');
  const sortFilter = document.getElementById('modsSortFilter');
  const prevBtn = document.getElementById('modsPrevBtn');
  const nextBtn = document.getElementById('modsNextBtn');
  await loadModsVersionFilter();
  initContentTypeTabs();
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      currentModsPage = 0;
      searchContentByType();
    });
  }
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        currentModsPage = 0;
        searchContentByType();
      }
    });
  }
  [versionFilter, loaderFilter, sortFilter].forEach(filter => {
    if (filter) {
      filter.addEventListener('change', () => {
        currentModsPage = 0;
        if (searchInput && searchInput.value.trim()) {
          searchContentByType();
        } else {
          loadContentByType();
        }
      });
    }
  });
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentModsPage > 0) {
        currentModsPage--;
        if (searchInput && searchInput.value.trim()) {
          searchContentByType();
        } else {
          loadContentByType();
        }
      }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if ((currentModsPage + 1) * modsPerPage < totalModsResults) {
        currentModsPage++;
        if (searchInput && searchInput.value.trim()) {
          searchContentByType();
        } else {
          loadContentByType();
        }
      }
    });
  }
  loadContentByType();
}

function initContentTypeTabs() {
  const contentTypeBtns = document.querySelectorAll('.content-type-btn');
  const loaderFilterGroup = document.getElementById('loaderFilterGroup');
  const searchInput = document.getElementById('modsSearchInput');
  contentTypeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      contentTypeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentContentType = btn.dataset.contentType;
      if (loaderFilterGroup) {
        loaderFilterGroup.style.display = currentContentType === 'mod' ? 'flex' : 'none';
      }
      if (searchInput) {
        const placeholders = {
          mod: t('mods_search_placeholder_mod') || t('mods_search_placeholder'),
          modpack: t('mods_search_placeholder_modpack') || t('mods_search_placeholder'),
          resourcepack: t('mods_search_placeholder_resourcepack') || t('mods_search_placeholder'),
          shader: t('mods_search_placeholder_shader') || t('mods_search_placeholder')
        };
        searchInput.placeholder = placeholders[currentContentType] || t('mods_search_placeholder');
      }
      currentModsPage = 0;
      loadContentByType();
    });
  });
}

async function loadContentByType() {
  const resultsContainer = document.getElementById('modsResults');
  if (!resultsContainer) return;
  resultsContainer.innerHTML = `<div class="mod-loading">${t('common_loading')}</div>`;
  try {
    const versionFilter = document.getElementById('modsVersionFilter');
    const sortFilter = document.getElementById('modsSortFilter');
    const filters = {
      gameVersion: versionFilter?.value || '',
      sortBy: sortFilter?.value || 'downloads',
      limit: modsPerPage,
      offset: currentModsPage * modsPerPage
    };
    if (currentContentType === 'mod') {
      const loaderFilter = document.getElementById('modsLoaderFilter');
      filters.loader = loaderFilter?.value || '';
    }
    const result = await ipcRenderer.invoke('modrinth-search-content', '', currentContentType, filters);
    if (result.success) {
      totalModsResults = result.total;
      displayModsResults(result.hits);
      updateModsPagination();
    } else {
      resultsContainer.innerHTML = `<div class="mods-placeholder"><p>${t('mods_load_error')}</p></div>`;
    }
  } catch (error) {
    console.error('Error loading content:', error);
    resultsContainer.innerHTML = `<div class="mods-placeholder"><p>${t('mods_load_error')}</p></div>`;
  }
}

async function searchContentByType() {
  const searchInput = document.getElementById('modsSearchInput');
  const versionFilter = document.getElementById('modsVersionFilter');
  const sortFilter = document.getElementById('modsSortFilter');
  const resultsContainer = document.getElementById('modsResults');
  if (!searchInput || !resultsContainer) return;
  const query = searchInput.value.trim();
  currentModsFilters = {
    gameVersion: versionFilter?.value || '',
    sortBy: sortFilter?.value || 'relevance',
    limit: modsPerPage,
    offset: currentModsPage * modsPerPage
  };
  if (currentContentType === 'mod') {
    const loaderFilter = document.getElementById('modsLoaderFilter');
    currentModsFilters.loader = loaderFilter?.value || '';
  }
  resultsContainer.innerHTML = `<div class="mod-loading">${t('common_loading')}</div>`;
  try {
    const result = await ipcRenderer.invoke('modrinth-search-content', query, currentContentType, currentModsFilters);
    if (result.success) {
      totalModsResults = result.total;
      displayModsResults(result.hits);
      updateModsPagination();
    } else {
      resultsContainer.innerHTML = `<div class="mods-placeholder"><p>${t('mods_load_error')}</p></div>`;
    }
  } catch (error) {
    console.error('Content search error:', error);
    resultsContainer.innerHTML = `<div class="mods-placeholder"><p>${t('mods_load_error')}</p></div>`;
  }
}

async function loadModsVersionFilter() {
  const versionFilter = document.getElementById('modsVersionFilter');
  if (!versionFilter) return;
  try {
    const versions = await ipcRenderer.invoke('get-installed-versions');
    versions.forEach(version => {
      const option = document.createElement('option');
      option.value = version;
      option.textContent = version;
      versionFilter.appendChild(option);
    });
    if (versions.length > 0) {
      versionFilter.value = versions[0];
    }
  } catch (error) {
    console.error('Error loading versions for mods filter:', error);
  }
}

function displayModsResults(mods) {
  const resultsContainer = document.getElementById('modsResults');
  if (!resultsContainer) return;
  if (mods.length === 0) {
    resultsContainer.innerHTML = `<div class="mods-placeholder"><p>${t('mods_not_found')}</p><p class="mods-placeholder-hint">${t('mods_try_again')}</p></div>`;
    return;
  }
  resultsContainer.innerHTML = '';
  resultsContainer.scrollTop = 0;
  mods.forEach(mod => {
    const card = document.createElement('div');
    card.className = 'mod-card';
    const iconUrl = mod.icon_url || mod.gallery?.[0]?.url || '';
    const downloads = formatNumber(mod.downloads);
    const author = mod.author || 'Unknown';
    card.innerHTML = `
      <div class="mod-card-header">
        <div class="mod-icon">${iconUrl ? `<img src="${iconUrl}" alt="${mod.title}">` : ''}</div>
        <div class="mod-info">
          <h3 class="mod-title">${mod.title}</h3>
          <div class="mod-author">by ${author}</div>
          <div class="mod-downloads"><svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M7 0.5V8.5M7 8.5L4.5 6M7 8.5L9.5 6"/><rect x="1" y="10" width="12" height="2" rx="0.5"/></svg><span>${downloads} ${t('mod_downloads')}</span></div>
        </div>
      </div>
      <div class="mod-description">${mod.description || t('mod_no_description')}</div>
      <div class="mod-actions">
        <button class="mod-download-btn" data-project-id="${mod.project_id}" data-mod-title="${mod.title}"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1V11M8 11L5 8M8 11L11 8M2 13V14H14V13"/></svg><span>${t('common_download')}</span></button>
        <button class="mod-details-btn" data-project-id="${mod.project_id}">${t('mod_details')}</button>
      </div>
    `;
    resultsContainer.appendChild(card);
  });
  resultsContainer.querySelectorAll('.mod-download-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const projectId = btn.dataset.projectId;
      const modTitle = btn.dataset.modTitle;
      await downloadMod(projectId, modTitle);
    });
  });
  resultsContainer.querySelectorAll('.mod-details-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const projectId = btn.dataset.projectId;
      await showModDetails(projectId);
    });
  });
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function updateModsPagination() {
  const pagination = document.getElementById('modsPagination');
  const prevBtn = document.getElementById('modsPrevBtn');
  const nextBtn = document.getElementById('modsNextBtn');
  const paginationInfo = document.getElementById('modsPaginationInfo');
  if (!pagination) return;
  if (totalModsResults === 0) { pagination.style.display = 'none'; return; }
  pagination.style.display = 'flex';
  const totalPages = Math.ceil(totalModsResults / modsPerPage);
  const currentPageDisplay = currentModsPage + 1;
  if (paginationInfo) paginationInfo.textContent = `${t('mod_page')} ${currentPageDisplay} ${t('mod_of')} ${totalPages}`;
  if (prevBtn) prevBtn.disabled = currentModsPage === 0;
  if (nextBtn) nextBtn.disabled = currentModsPage >= totalPages - 1;
}

async function downloadMod(projectId, modTitle) {
  try {
    const versionFilter = document.getElementById('modsVersionFilter');
    const loaderFilter = document.getElementById('modsLoaderFilter');
    const filters = { gameVersion: versionFilter?.value || '' };
    if (currentContentType === 'mod') filters.loader = loaderFilter?.value || '';
    const downloadBtn = document.querySelector(`[data-project-id="${projectId}"]`);
    const originalBtnContent = downloadBtn ? downloadBtn.innerHTML : '';
    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="6" stroke-opacity="0.3"/><path d="M8 2 A6 6 0 0 1 14 8" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1s" repeatCount="indefinite"/></path></svg><span>${t('common_downloading')}</span>`;
      downloadBtn.style.opacity = '0.6';
    }
    if (currentContentType === 'modpack') {
      const versionsResult = await ipcRenderer.invoke('modrinth-get-versions', projectId, filters);
      if (!versionsResult.success || versionsResult.versions.length === 0) {
        notify('modpack_no_versions', {}, 'error');
        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.innerHTML = originalBtnContent;
          downloadBtn.style.opacity = '1';
        }
        return;
      }
      const selectedVersion = await showModpackVersionDialog(versionsResult.versions, modTitle);
      if (!selectedVersion) {
        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.innerHTML = originalBtnContent;
          downloadBtn.style.opacity = '1';
        }
        return;
      }
      const file = selectedVersion.files.find(f => f.primary) || selectedVersion.files[0];
      if (!file) {
        notify('mod_no_file', {}, 'error');
        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.innerHTML = originalBtnContent;
          downloadBtn.style.opacity = '1';
        }
        return;
      }
      notify('modpack_installing', {title: modTitle}, 'info');
      switchTab('play');
      const progressContainer = document.getElementById('downloadProgress');
      const progressStage = document.getElementById('progressStage');
      const progressPercent = document.getElementById('progressPercent');
      const progressFill = document.getElementById('progressFill');
      if (progressContainer) progressContainer.classList.remove('hidden');
      if (progressStage) progressStage.textContent = t('modpack_installing', {title: modTitle});
      if (progressPercent) progressPercent.textContent = '0%';
      if (progressFill) progressFill.style.width = '0%';
      const result = await ipcRenderer.invoke('modrinth-install-modpack', projectId, file.url, file.filename, selectedVersion.game_versions);
      if (result.success) {
        if (progressStage) progressStage.textContent = t('modpack_install_success');
        if (progressPercent) progressPercent.textContent = '100%';
        if (progressFill) progressFill.style.width = '100%';
        notify('modpack_install_success', {}, 'success');
        setTimeout(async () => {
          if (progressContainer) progressContainer.classList.add('hidden');
          await loadVersions();
        }, 2000);
        if (downloadBtn) {
          downloadBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 8 7 11 12 4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${t('common_installed')}</span>`;
          setTimeout(() => {
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = originalBtnContent;
            downloadBtn.style.opacity = '1';
          }, 2000);
        }
      } else {
        if (progressContainer) progressContainer.classList.add('hidden');
        notify('modpack_install_error', {error: result.error}, 'error');
        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.innerHTML = originalBtnContent;
          downloadBtn.style.opacity = '1';
        }
      }
      return;
    }
    const installedVersions = await ipcRenderer.invoke('get-versions-with-isolation');
    if (!installedVersions || installedVersions.length === 0) {
      notify('mod_no_versions', {}, 'error');
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = originalBtnContent;
        downloadBtn.style.opacity = '1';
      }
      return;
    }
    const targetVersion = await showTargetVersionDialog(installedVersions, currentContentType);
    if (!targetVersion) {
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = originalBtnContent;
        downloadBtn.style.opacity = '1';
      }
      return;
    }
    const targetFilters = { gameVersion: versionFilter?.value || '' };
    if (currentContentType === 'mod') {
      let detectedLoader = '';
      if (targetVersion.includes('-fabric-')) detectedLoader = 'fabric';
      else if (targetVersion.includes('-forge-')) detectedLoader = 'forge';
      else if (targetVersion.includes('-neoforge-')) detectedLoader = 'neoforge';
      else if (targetVersion.includes('-quilt-')) detectedLoader = 'quilt';
      if (detectedLoader) {
        targetFilters.loader = detectedLoader;
      } else if (loaderFilter?.value) {
        targetFilters.loader = loaderFilter.value;
      }
    }
    const versionsResult = await ipcRenderer.invoke('modrinth-get-versions', projectId, targetFilters);
    if (!versionsResult.success || versionsResult.versions.length === 0) {
      notify('mod_no_versions', {}, 'error');
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = originalBtnContent;
        downloadBtn.style.opacity = '1';
      }
      return;
    }
    const latestVersion = versionsResult.versions[0];
    const file = latestVersion.files.find(f => f.primary) || latestVersion.files[0];
    if (!file) {
      notify('mod_no_file', {}, 'error');
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = originalBtnContent;
        downloadBtn.style.opacity = '1';
      }
      return;
    }
    const contentTypeNames = { mod: t('mods_type_mod'), modpack: t('mods_type_modpack'), resourcepack: t('mods_type_resourcepack'), shader: t('mods_type_shader') };
    const typeName = contentTypeNames[currentContentType] || t('common_file');
    switchTab('play');
    const progressContainer = document.getElementById('downloadProgress');
    const progressStage = document.getElementById('progressStage');
    const progressPercent = document.getElementById('progressPercent');
    const progressFill = document.getElementById('progressFill');
    if (progressContainer) progressContainer.classList.remove('hidden');
    if (progressStage) progressStage.textContent = t('mod_downloading', {title: modTitle});
    if (progressPercent) progressPercent.textContent = '0%';
    if (progressFill) progressFill.style.width = '0%';
    notify('mod_downloading', {title: modTitle}, 'info');
    let ipcHandler = 'modrinth-download-mod';
    if (currentContentType === 'resourcepack') ipcHandler = 'modrinth-download-resourcepack';
    else if (currentContentType === 'shader') ipcHandler = 'modrinth-download-shader';
    const result = await ipcRenderer.invoke(ipcHandler, file.url, file.filename, targetVersion);
    if (result.success) {
      if (progressStage) progressStage.textContent = t('mod_download_success', {title: modTitle, version: targetVersion});
      if (progressPercent) progressPercent.textContent = '100%';
      if (progressFill) progressFill.style.width = '100%';
      notify('mod_download_success', {title: modTitle, version: targetVersion}, 'success');
      setTimeout(async () => {
        if (progressContainer) progressContainer.classList.add('hidden');
        await loadVersions();
      }, 2000);
      if (downloadBtn) {
        downloadBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 8 7 11 12 4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${t('common_installed')}</span>`;
        setTimeout(() => {
          downloadBtn.disabled = false;
          downloadBtn.innerHTML = originalBtnContent;
          downloadBtn.style.opacity = '1';
        }, 2000);
      }
    } else {
      if (progressContainer) progressContainer.classList.add('hidden');
      notify('mod_download_failed', {error: result.error}, 'error');
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = originalBtnContent;
        downloadBtn.style.opacity = '1';
      }
    }
  } catch (error) {
    console.error('Download mod error:', error);
    notify('mod_download_general_error', {}, 'error');
  }
}

async function showModDetails(projectId) {
  try {
    const loadingDialog = document.createElement('div');
    loadingDialog.className = 'modal-overlay';
    loadingDialog.innerHTML = `<div class="modal-content"><div class="mod-loading">${t('common_loading')}</div></div>`;
    document.body.appendChild(loadingDialog);
    const result = await ipcRenderer.invoke('modrinth-get-mod', projectId);
    if (!result.success || !result.mod) {
      loadingDialog.remove();
      notify('mod_details_error', {error: result.error || 'Unknown'}, 'error');
      return;
    }
    const mod = result.mod;
    loadingDialog.remove();
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    const galleryImages = [];
    if (mod.gallery && Array.isArray(mod.gallery)) {
      mod.gallery.forEach(g => { if (g.url) galleryImages.push(g.url); });
    }
    if (galleryImages.length === 0 && mod.icon_url) {
      galleryImages.push(mod.icon_url);
    }
    const iconUrl = mod.icon_url || '';
    const downloads = formatNumber(mod.downloads || 0);
    const followers = formatNumber(mod.followers || 0);
    const categories = mod.categories && mod.categories.length ? mod.categories.join(', ') : t('mod_no_categories');
    const license = mod.license?.name || mod.license?.id || t('mod_unknown_license');
    const sourceUrl = mod.source_url || mod.issues_url || mod.wiki_url || mod.discord_url || '';
    let description = mod.body || mod.description || t('mod_no_description');
    if (description.length > 1500) description = description.substring(0, 1500) + '...';
    let galleryHtml = '';
    if (galleryImages.length > 0) {
      galleryHtml = `
        <div class="mod-gallery">
          <div class="mod-gallery-main">
            <img src="${galleryImages[0]}" alt="${mod.title}" class="mod-gallery-image" id="galleryMainImage">
            ${galleryImages.length > 1 ? `
              <button class="gallery-arrow gallery-arrow-left" id="galleryPrev">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15 18l-6-6 6-6"/>
                </svg>
              </button>
              <button class="gallery-arrow gallery-arrow-right" id="galleryNext">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </button>
              <div class="gallery-counter">
                <span id="galleryCurrentIndex">1</span> / ${galleryImages.length}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }
    dialog.innerHTML = `
      <div class="modal-content mod-details-modal">
        <button class="modal-close-x" title="${t('common_close')}">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <div class="mod-details-header">
          <div class="mod-header-top">
            ${iconUrl ? `<img src="${iconUrl}" alt="${mod.title}" class="mod-details-icon">` : ''}
            <div class="mod-details-title-section">
              <h2>${mod.title}</h2>
              <div class="mod-details-author">by ${mod.team || mod.author || 'Unknown'}</div>
              <div class="mod-details-stats">
                <span>📥 ${downloads}</span>
                <span>❤️ ${followers}</span>
              </div>
            </div>
          </div>
          ${galleryHtml}
        </div>
        <div class="mod-details-body">
          <div class="mod-details-section">
            <h3>${t('mod_description')}</h3>
            <p class="mod-details-description">${description.replace(/\n/g, '<br>')}</p>
          </div>
          <div class="mod-details-section">
            <h3>${t('mod_info')}</h3>
            <div class="mod-details-info-grid">
              <div class="mod-info-item"><span class="mod-info-label">${t('mod_categories')}</span><span class="mod-info-value">${categories}</span></div>
              <div class="mod-info-item"><span class="mod-info-label">${t('mod_license')}</span><span class="mod-info-value">${license}</span></div>
              <div class="mod-info-item"><span class="mod-info-label">${t('mod_updated')}</span><span class="mod-info-value">${new Date(mod.updated).toLocaleDateString(localizationManager ? (localizationManager.getLanguage() === 'en' ? 'en-US' : 'ru-RU') : 'ru-RU')}</span></div>
              <div class="mod-info-item"><span class="mod-info-label">${t('mod_published')}</span><span class="mod-info-value">${new Date(mod.published).toLocaleDateString(localizationManager ? (localizationManager.getLanguage() === 'en' ? 'en-US' : 'ru-RU') : 'ru-RU')}</span></div>
            </div>
          </div>
          ${sourceUrl ? `
            <div class="mod-details-section">
              <a href="${sourceUrl}" class="mod-source-link" target="_blank">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
                ${t('mod_source_link')}
              </a>
            </div>
          ` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    if (galleryImages.length > 1) {
      let currentImageIndex = 0;
      const mainImage = dialog.querySelector('#galleryMainImage');
      const prevBtn = dialog.querySelector('#galleryPrev');
      const nextBtn = dialog.querySelector('#galleryNext');
      const counter = dialog.querySelector('#galleryCurrentIndex');
      const updateGallery = () => {
        mainImage.src = galleryImages[currentImageIndex];
        counter.textContent = currentImageIndex + 1;
      };
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentImageIndex = (currentImageIndex - 1 + galleryImages.length) % galleryImages.length;
        updateGallery();
      });
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentImageIndex = (currentImageIndex + 1) % galleryImages.length;
        updateGallery();
      });
    }
    const closeX = dialog.querySelector('.modal-close-x');
    closeX.addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
  } catch (error) {
    console.error('Error showing mod details:', error);
    notify('mod_details_error', {error: error.message}, 'error');
  }
}

function showModpackVersionDialog(versions, modpackTitle) {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    const versionFilter = document.getElementById('modsVersionFilter');
    const selectedMinecraftVersion = versionFilter?.value || '';
    let filteredVersions = versions;
    if (selectedMinecraftVersion) {
      filteredVersions = versions.filter(v => v.game_versions && v.game_versions.includes(selectedMinecraftVersion));
    }
    if (filteredVersions.length === 0) filteredVersions = versions;
    const versionsHtml = filteredVersions.map((v, idx) => {
      const gameVersions = v.game_versions.join(', ');
      const loaders = v.loaders.map(l => l.charAt(0).toUpperCase() + l.slice(1)).join(', ');
      const date = new Date(v.date_published).toLocaleDateString(localizationManager ? (localizationManager.getLanguage() === 'en' ? 'en-US' : 'ru-RU') : 'ru-RU');
      return `
        <div class="version-item" data-index="${idx}">
          <div class="version-info">
            <div class="version-name">${v.name}</div>
            <div class="version-meta">Minecraft: ${gameVersions} | ${loaders}</div>
            <div class="version-date">${t('mod_published')}: ${date}</div>
          </div>
          <button class="version-select-btn" data-index="${idx}">${t('common_select')}</button>
        </div>
      `;
    }).join('');
    const filterInfo = selectedMinecraftVersion
      ? `<div class="version-filter-info">${t('modpack_filter_info', {version: selectedMinecraftVersion})} <span class="show-all-versions">${t('modpack_show_all') || 'Show all versions'}</span></div>`
      : '';
    dialog.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header">
          <h2>${t('modpack_select_version_title')}</h2>
          <div class="modal-subtitle">${modpackTitle}</div>
          <button class="modal-close-x">×</button>
        </div>
        ${filterInfo}
        <div class="version-list" style="max-height: 400px; overflow-y: auto;">
          ${versionsHtml}
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    const close = () => { dialog.remove(); resolve(null); };
    dialog.querySelector('.modal-close-x').addEventListener('click', close);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
    const showAllLink = dialog.querySelector('.show-all-versions');
    if (showAllLink) {
      showAllLink.addEventListener('click', () => {
        dialog.remove();
        showModpackVersionDialogAll(versions, modpackTitle).then(resolve);
      });
    }
    dialog.querySelectorAll('.version-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        dialog.remove();
        resolve(filteredVersions[idx]);
      });
    });
  });
}

function showModpackVersionDialogAll(versions, modpackTitle) {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    const versionsHtml = versions.map((v, idx) => {
      const gameVersions = v.game_versions.join(', ');
      const loaders = v.loaders.map(l => l.charAt(0).toUpperCase() + l.slice(1)).join(', ');
      const date = new Date(v.date_published).toLocaleDateString(localizationManager ? (localizationManager.getLanguage() === 'en' ? 'en-US' : 'ru-RU') : 'ru-RU');
      return `
        <div class="version-item" data-index="${idx}">
          <div class="version-info">
            <div class="version-name">${v.name}</div>
            <div class="version-meta">Minecraft: ${gameVersions} | ${loaders}</div>
            <div class="version-date">${t('mod_published')}: ${date}</div>
          </div>
          <button class="version-select-btn" data-index="${idx}">${t('common_select')}</button>
        </div>
      `;
    }).join('');
    dialog.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header">
          <h2>${t('modpack_all_versions')}</h2>
          <div class="modal-subtitle">${modpackTitle}</div>
          <button class="modal-close-x">×</button>
        </div>
        <div class="version-list" style="max-height: 400px; overflow-y: auto;">
          ${versionsHtml}
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    const close = () => { dialog.remove(); resolve(null); };
    dialog.querySelector('.modal-close-x').addEventListener('click', close);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
    dialog.querySelectorAll('.version-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        dialog.remove();
        resolve(versions[idx]);
      });
    });
  });
}

function showTargetVersionDialog(versions, contentType) {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    const contentTypeNames = { mod: t('mods_type_mod'), resourcepack: t('mods_type_resourcepack'), shader: t('mods_type_shader') };
    const typeName = contentTypeNames[contentType] || t('common_file');
    const isolatedVersions = versions.filter(v => v.isolated);
    const sharedVersion = versions.find(v => !v.isolated);
    let versionsHtml = '';
    if (isolatedVersions.length > 0) {
      versionsHtml += `<div class="version-group"><h3>${t('isolated_versions')}</h3>`;
      isolatedVersions.forEach(v => {
        let loaderType = 'vanilla';
        if (v.version.includes('-forge-')) loaderType = 'forge';
        else if (v.version.includes('-fabric-')) loaderType = 'fabric';
        else if (v.version.includes('-neoforge-')) loaderType = 'neoforge';
        else if (v.version.includes('-quilt-')) loaderType = 'quilt';
        versionsHtml += `
          <div class="version-item" data-version="${v.version}">
            <div class="version-info">
              <div class="version-name">${v.version}</div>
              <div class="version-badge ${loaderType}">${loaderType}</div>
            </div>
            <button class="version-select-btn" data-version="${v.version}">${t('common_select')}</button>
          </div>
        `;
      });
      versionsHtml += '</div>';
    }
    if (sharedVersion) {
      versionsHtml += `<div class="version-group"><h3>${t('shared_version')}</h3>`;
      versionsHtml += `
        <div class="version-item" data-version="${sharedVersion.version}">
          <div class="version-info">
            <div class="version-name">${sharedVersion.version}</div>
            <div class="version-meta">${t('shared_version_desc')}</div>
          </div>
          <button class="version-select-btn" data-version="${sharedVersion.version}">${t('common_select')}</button>
        </div>
      `;
      versionsHtml += '</div>';
    }
    dialog.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header">
          <h2>${t('mod_select_target_version_title', {type: typeName})}</h2>
          <button class="modal-close-x">×</button>
        </div>
        <div class="version-list" style="max-height: 400px; overflow-y: auto;">
          ${versionsHtml}
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    const close = () => { dialog.remove(); resolve(null); };
    dialog.querySelector('.modal-close-x').addEventListener('click', close);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
    dialog.querySelectorAll('.version-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const version = btn.dataset.version;
        dialog.remove();
        resolve(version);
      });
    });
  });
}

async function initMediaTab() {
  const openScreenshotsFolderBtn = document.getElementById('openScreenshotsFolder');
  const refreshScreenshotsBtn = document.getElementById('refreshScreenshots');
  if (openScreenshotsFolderBtn) {
    openScreenshotsFolderBtn.addEventListener('click', async () => {
      await ipcRenderer.invoke('open-screenshots-folder');
    });
  }
  if (refreshScreenshotsBtn) {
    refreshScreenshotsBtn.addEventListener('click', async () => {
      await loadScreenshots();
    });
  }
  await loadScreenshots();
}

async function loadScreenshots() {
  const grid = document.getElementById('screenshotsGrid');
  if (!grid) return;
  grid.innerHTML = `<div class="loading-spinner">${t('media_loading')}</div>`;
  try {
    const result = await ipcRenderer.invoke('get-screenshots');
    if (!result.success || result.screenshots.length === 0) {
      grid.innerHTML = `<div class="empty-state">${t('screenshots_empty')}</div>`;
      return;
    }
    grid.innerHTML = '';
    result.screenshots.forEach(screenshot => {
      const card = document.createElement('div');
      card.className = 'screenshot-card';
      card.innerHTML = `
        <img src="file:///${screenshot.path.replace(/\\/g, '/')}" class="screenshot-img" alt="${screenshot.name}">
        <div class="screenshot-info">
          <div class="screenshot-name" title="${screenshot.name}">${screenshot.name}</div>
          <button class="screenshot-delete" data-path="${screenshot.path}">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 4V14C3 14.55 3.45 15 4 15H12C12.55 15 13 14.55 13 14V4H3ZM6 13H5V6H6V13ZM8.5 13H7.5V6H8.5V13ZM11 13H10V6H11V13ZM13 2H10L9 1H7L6 2H3V3H13V2Z"/>
            </svg>
          </button>
        </div>
      `;
      card.querySelector('.screenshot-img').addEventListener('click', () => {
        showScreenshotViewer(screenshot.path);
      });
      card.querySelector('.screenshot-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await CustomDialog.confirm(
          t('screenshot_delete_confirm_title'),
          t('screenshot_delete_confirm_message', {name: screenshot.name})
        );
        if (confirmed) {
          const deleteResult = await ipcRenderer.invoke('delete-screenshot', screenshot.path);
          if (deleteResult.success) {
            notify('screenshot_delete_success', {}, 'success');
            await loadScreenshots();
          } else {
            notify('screenshot_delete_error', {}, 'error');
          }
        }
      });
      grid.appendChild(card);
    });
  } catch (error) {
    console.error('Error loading screenshots:', error);
    grid.innerHTML = `<div class="empty-state">${t('common_error')}</div>`;
  }
}

function showScreenshotViewer(imagePath) {
  const viewer = document.createElement('div');
  viewer.className = 'modal-overlay';
  viewer.innerHTML = `
    <div class="modal-content" style="max-width: 90%; max-height: 90%;">
      <button class="modal-close-x">×</button>
      <img src="file:///${imagePath.replace(/\\/g, '/')}" style="max-width: 100%; max-height: 80vh; object-fit: contain;">
    </div>
  `;
  document.body.appendChild(viewer);
  viewer.querySelector('.modal-close-x').addEventListener('click', () => viewer.remove());
  viewer.addEventListener('click', (e) => { if (e.target === viewer) viewer.remove(); });
}

async function initToolsTab() {
  const checkIntegrityBtn = document.getElementById('checkIntegrityBtn');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const optimizeBtn = document.getElementById('optimizeBtn');
  const openLogsFolderBtn = document.getElementById('openLogsFolder');
  const analyzeLogsBtn = document.getElementById('analyzeLogs');
  if (checkIntegrityBtn) {
    checkIntegrityBtn.addEventListener('click', async () => {
      notify('integrity_check_start', {}, 'info');
      const result = await ipcRenderer.invoke('check-integrity');
      if (result.success) {
        showDetailedDialog(t('integrity_title'), result.message, result.type || 'info');
      } else {
        notify('error_general', {error: result.error}, 'error');
      }
    });
  }
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', async () => {
      const confirmed = await CustomDialog.confirm(
        t('cache_clear_confirm_title'),
        t('cache_clear_confirm_message')
      );
      if (!confirmed) return;
      notify('cache_clear_start', {}, 'info');
      const result = await ipcRenderer.invoke('clear-cache');
      if (result.success) {
        showDetailedDialog(t('cache_clear_title'), `${t('cache_clear_success')}\n\n${t('cache_freed_space', {space: result.freedSpace || '0'})}`, 'success');
      } else {
        notify('error_general', {error: result.error}, 'error');
      }
    });
  }
  if (optimizeBtn) {
    optimizeBtn.addEventListener('click', async () => {
      notify('optimize_start', {}, 'info');
      const result = await ipcRenderer.invoke('optimize-settings');
      if (result.success) {
        showDetailedDialog(t('optimize_title'), result.message, result.type || 'success');
      } else {
        notify('error_general', {error: result.error}, 'error');
      }
    });
  }
  if (openLogsFolderBtn) {
    openLogsFolderBtn.addEventListener('click', async () => {
      await ipcRenderer.invoke('open-logs-folder');
    });
  }
  if (analyzeLogsBtn) {
    analyzeLogsBtn.addEventListener('click', async () => {
      await analyzeLogs();
    });
  }
}

async function analyzeLogs() {
  const viewer = document.getElementById('logsViewer');
  if (!viewer) return;
  viewer.innerHTML = `<div class="loading-spinner">${t('logs_analyze_start')}</div>`;
  try {
    const result = await ipcRenderer.invoke('analyze-logs');
    if (!result.success) {
      viewer.innerHTML = `<div class="logs-placeholder">${t('logs_analyze_error')}</div>`;
      return;
    }
    viewer.innerHTML = '';
    if (result.logs.length === 0) {
      viewer.innerHTML = `<div class="logs-placeholder">Логи не найдены. Запустите игру хотя бы раз, чтобы появились логи.</div>`;
      return;
    }
    result.logs.forEach(log => {
      const line = document.createElement('div');
      line.className = `log-line ${log.type}`;
      line.textContent = `[${log.time}] ${log.message}`;
      viewer.appendChild(line);
    });
    if (result.errors && result.errors.length > 0) {
      const summary = document.createElement('div');
      summary.style.cssText = 'margin-top: 16px; padding: 12px; background: rgba(255, 107, 107, 0.1); border-left: 3px solid #ff6b6b; border-radius: 4px;';
      summary.innerHTML = `<strong>${t('logs_errors_found', {count: result.errors.length})}</strong><br>${result.errors.slice(0, 3).join('<br>')}`;
      viewer.appendChild(summary);
    }
  } catch (error) {
    console.error('Error analyzing logs:', error);
    viewer.innerHTML = `<div class="logs-placeholder">${t('logs_analyze_error')}</div>`;
  }
}

function showDetailedDialog(title, message, type = 'info') {
  const dialog = document.createElement('div');
  dialog.className = 'modal-overlay';
  const iconColor = type === 'success' ? '#4a9eff' : type === 'error' ? '#ff6b6b' : '#ffc107';
  const icon = type === 'success'
    ? '<path d="M12 2L2 7V13C2 18.55 6.84 23.74 12 25C17.16 23.74 22 18.55 22 13V7L12 2ZM10 17L5 12L6.41 10.59L10 14.17L17.59 6.58L19 8L10 17Z"/>'
    : type === 'error'
    ? '<path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z"/>'
    : '<path d="M1 21H23L12 2L1 21ZM13 18H11V16H13V18ZM13 14H11V10H13V14Z"/>';
  dialog.innerHTML = `
    <div class="modal-content detailed-dialog" style="max-width: 700px;">
      <div class="modal-header" style="background: #1a1a1a; border-bottom: 1px solid #2a2a2a; padding: 16px 20px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="${iconColor}">
            ${icon}
          </svg>
          <h2 style="margin: 0; color: #fff; font-size: 18px; font-weight: 600;">${title}</h2>
        </div>
        <button class="modal-close-x">×</button>
      </div>
      <div class="detailed-content" style="padding: 20px; background: #0a0a0a; max-height: 400px; overflow-y: auto;">
        ${message.split('\n').map(line => `<div class="detail-line" style="color: #ccc; line-height: 1.6; margin-bottom: 8px; font-size: 14px;">${line}</div>`).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.querySelector('.modal-close-x').addEventListener('click', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
}

async function initFileManager() {
  console.log('renderer.js: Calling file manager init...');
  setTimeout(() => {
    if (typeof initFileManagerNow === 'function') {
      initFileManagerNow();
    } else {
      console.error('initFileManagerNow function not found');
    }
  }, 500);
}