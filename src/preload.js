const { contextBridge, ipcRenderer } = require('electron');

const VALID_INVOKE_CHANNELS = new Set([
  'get-system-info', 'get-system-memory', 'get-isolation-settings',
  'save-isolation-settings', 'save-config', 'get-config',
  'get-running-instances', 'kill-instance', 'get-installed-versions',
  'get-all-versions', 'download-version', 'minimize-window', 'close-window',
  'open-instance-folder', 'toggle-isolation', 'accounts-get-active',
  'check-version-ready', 'launch-game', 'delete-version', 'get-stats',
  'get-favorite-version', 'ely-start-oauth', 'ely-get-account-info',
  'ely-logout', 'ely-refresh-token', 'accounts-get-all', 'accounts-set-active',
  'accounts-remove', 'accounts-update-skin', 'accounts-add-local',
  'ely-login-username-password', 'accounts-add-ely', 'java-get-all-info',
  'java-download', 'java-delete', 'java-get-for-minecraft',
  'java-get-required-version', 'modrinth-search-content',
  'modrinth-get-categories', 'modrinth-get-versions',
  'modrinth-install-modpack', 'get-versions-with-isolation',
  'modrinth-get-mod', 'get-available-minecraft-versions',
  'open-screenshots-folder', 'get-screenshots', 'delete-screenshot',
  'check-integrity', 'clear-cache', 'optimize-settings', 'open-logs-folder',
  'run-diagnostics', 'auto-fix-java', 'analyze-logs', 'export-logs',
  'export-profile', 'import-profile', 'get-servers', 'ping-server',
  'remove-server', 'add-server', 'get-jvm-presets', 'get-crash-reports',
  'check-launcher-update', 'check-mod-compatibility', 'get-minecraft-root',
  'list-directory', 'get-parent-directory', 'open-file',
  'show-item-in-folder', 'file-operation', 'rename-item', 'delete-items',
  'get-item-properties', 'create-folder', 'complete-first-setup',
  'discord-set-client-id', 'discord-get-status', 'discord-set-images',
  'open-folder', 'get-minecraft-files', 'save-skin', 'get-skin',
  'remove-skin', 'toggle-fullscreen', 'resize-launcher', 'get-game-logs',
  'create-modpack-version', 'save-jvm-preset', 'delete-jvm-preset',
  'check-mod-updates', 'ely-validate-token', 'ely-authenticate-for-game',
  'accounts-get', 'modrinth-download-mod', 'modrinth-download-resourcepack',
  'modrinth-download-shader', 'modrinth-search', 'get-versions',
  'modrinth-get-tags', 'modpack-get-versions',
  'get-language-config', 'save-language-config', 'write-dropped-files',
  'read-file-content', 'write-file-content', 'import-external-files'
]);

const VALID_ON_CHANNELS = new Set([
  'download-progress', 'mod-download-progress', 'java-download-progress',
  'instance-started', 'instance-stopped'
]);

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, ...args) => {
    if (!VALID_INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error('IPC channel not allowed: ' + channel));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, callback) => {
    if (!VALID_ON_CHANNELS.has(channel)) return () => {};
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  }
});
