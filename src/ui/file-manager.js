function t(key, params = {}) {
  if (window.localizationManager && typeof window.localizationManager.t === 'function') {
    return window.localizationManager.t(key, params);
  }
  return key;
}

function getBasename(filePath) {
  const separator = filePath.includes('\\') ? '\\' : '/';
  const parts = filePath.split(separator);
  return parts[parts.length - 1] || parts[parts.length - 2] || '';
}

function joinPath(dir, file) {
  const separator = dir.includes('\\') ? '\\' : '/';
  return dir + separator + file;
}

class FileManager {
  constructor() {
    this.currentPath = '';
    this.navigationHistory = [];
    this.historyIndex = -1;
    this.selectedItems = new Set();
    this.clipboard = null;
    this.clipboardOperation = null;
    this.viewMode = 'list';

    this.initializeElements();
    this.attachEventListeners();
    this.loadRootDirectory();
  }

  initializeElements() {
    this.navBackBtn = document.getElementById('navBackBtn');
    this.navForwardBtn = document.getElementById('navForwardBtn');
    this.navUpBtn = document.getElementById('navUpBtn');
    this.navRefreshBtn = document.getElementById('navRefreshBtn');

    this.breadcrumb = document.getElementById('breadcrumb');

    this.newFolderBtn = document.getElementById('newFolderBtn');
    this.viewListBtn = document.getElementById('viewListBtn');
    this.viewGridBtn = document.getElementById('viewGridBtn');

    this.fileTree = document.getElementById('fileTree');
    this.fileListContent = document.getElementById('fileListContent');

    this.fileStatusText = document.getElementById('fileStatusText');
    this.fileStatusSelection = document.getElementById('fileStatusSelection');

    this.contextMenu = document.getElementById('fileContextMenu');
  }

  attachEventListeners() {
    this.navBackBtn.addEventListener('click', () => this.navigateBack());
    this.navForwardBtn.addEventListener('click', () => this.navigateForward());
    this.navUpBtn.addEventListener('click', () => this.navigateUp());
    this.navRefreshBtn.addEventListener('click', () => this.refresh());

    this.newFolderBtn.addEventListener('click', () => this.createNewFolder());

    this.viewListBtn.addEventListener('click', () => this.setViewMode('list'));
    this.viewGridBtn.addEventListener('click', () => this.setViewMode('grid'));

    this.fileListContent.addEventListener('click', (e) => this.handleFileListClick(e));
    this.fileListContent.addEventListener('dblclick', (e) => this.handleFileListDblClick(e));
    this.fileListContent.addEventListener('contextmenu', (e) => this.handleContextMenu(e));

    this.fileListContent.addEventListener('dragstart', (e) => this.handleDragStart(e));
    this.fileListContent.addEventListener('dragover', (e) => this.handleDragOver(e));
    this.fileListContent.addEventListener('dragleave', (e) => this.handleDragLeave(e));
    this.fileListContent.addEventListener('drop', (e) => this.handleDrop(e));

    this.contextMenu.addEventListener('click', (e) => this.handleContextMenuClick(e));

    document.addEventListener('click', (e) => {
      if (!this.contextMenu.contains(e.target)) {
        this.contextMenu.classList.add('hidden');
      }
    });

    document.addEventListener('keydown', (e) => this.handleKeyDown(e));

    window.ipcRenderer.on('file-operation-result', (event, result) => {
      if (result.success) {
        this.refresh();
        this.updateStatus(result.message || t('file_manager_operation_success'));
      } else {
        alert(t('error_general', {error: result.error}));
      }
    });
  }

  async loadRootDirectory() {
    if (this.fileTree) {
      this.fileTree.innerHTML = '';
    }
    if (this.fileListContent) {
      this.fileListContent.innerHTML = '';
    }

    const result = await window.ipcRenderer.invoke('get-minecraft-root');
    if (result.success) {
      await this.navigateTo(result.path);
    } else {
      console.error('Failed to get root directory:', result.error);
      await CustomDialog.alert(t('error_load_root'), t('common_error_occurred'));
    }
  }

  async navigateTo(dirPath) {
    this.updateStatus(t('common_loading'));

    const result = await window.ipcRenderer.invoke('list-directory', dirPath);
    if (!result.success) {
      await CustomDialog.alert(t('file_manager_open_error', {error: result.error}), t('common_error_occurred'));
      return;
    }

    if (this.historyIndex < this.navigationHistory.length - 1) {
      this.navigationHistory = this.navigationHistory.slice(0, this.historyIndex + 1);
    }
    this.navigationHistory.push(dirPath);
    this.historyIndex++;

    this.currentPath = dirPath;
    this.selectedItems.clear();
    this.updateNavigationButtons();
    this.updateBreadcrumb();
    this.renderFileList(result.files);
    this.updateStatus(t('files_items_count', {count: result.files.length}));
  }

  navigateBack() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.currentPath = this.navigationHistory[this.historyIndex];
      this.loadDirectory(this.currentPath);
      this.updateNavigationButtons();
    }
  }

  navigateForward() {
    if (this.historyIndex < this.navigationHistory.length - 1) {
      this.historyIndex++;
      this.currentPath = this.navigationHistory[this.historyIndex];
      this.loadDirectory(this.currentPath);
      this.updateNavigationButtons();
    }
  }

  async navigateUp() {
    if (!this.currentPath) return;

    const result = await window.ipcRenderer.invoke('get-parent-directory', this.currentPath);
    if (result.success && result.parent) {
      this.navigateTo(result.parent);
    }
  }

  async refresh() {
    if (this.currentPath) {
      await this.loadDirectory(this.currentPath);
    }
  }

  async loadDirectory(dirPath) {
    this.updateStatus(t('common_loading'));

    const result = await window.ipcRenderer.invoke('list-directory', dirPath);

    if (!result.success) {
      await CustomDialog.alert(t('file_manager_open_error', {error: result.error}), t('common_error_occurred'));
      return;
    }

    this.currentPath = dirPath;
    this.selectedItems.clear();

    this.updateBreadcrumb();
    this.renderFileList(result.files);
    this.updateStatus(t('files_items_count', {count: result.files.length}));
  }

  updateNavigationButtons() {
    this.navBackBtn.disabled = this.historyIndex <= 0;
    this.navForwardBtn.disabled = this.historyIndex >= this.navigationHistory.length - 1;
    this.navUpBtn.disabled = !this.currentPath;
  }

  updateBreadcrumb() {
    const separator = this.currentPath.includes('\\') ? '\\' : '/';
    const parts = this.currentPath.split(separator).filter(p => p);

    this.breadcrumb.innerHTML = '';

    parts.forEach((part, index) => {
      const item = document.createElement('span');
      item.className = 'breadcrumb-item';
      item.textContent = part;

      if (index === parts.length - 1) {
        item.classList.add('active');
      } else {
        item.addEventListener('click', () => {
          const targetPath = parts.slice(0, index + 1).join(separator);
          this.navigateTo(targetPath);
        });
      }

      this.breadcrumb.appendChild(item);
    });
  }

  renderFileList(files) {
    const loadingSpinners = this.fileListContent.querySelectorAll('.loading-spinner');
    loadingSpinners.forEach(spinner => spinner.remove());

    if (files.length === 0) {
      this.fileListContent.innerHTML = `
        <div class="empty-state">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="currentColor">
            <path d="M8 12C6.9 12 6 12.9 6 14V50C6 51.1 6.9 52 8 52H56C57.1 52 58 51.1 58 50V20C58 18.9 57.1 18 56 18H28L24 12H8Z"/>
          </svg>
          <span>${t('common_empty_folder')}</span>
        </div>
      `;
      return;
    }

    files.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    this.fileListContent.innerHTML = '';
    const fragment = document.createDocumentFragment();
    files.forEach((file) => {
      const item = this.createFileItem(file);
      fragment.appendChild(item);
    });
    this.fileListContent.appendChild(fragment);
  }

  createFileItem(file) {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.draggable = true;
    item.dataset.path = file.path;
    item.dataset.isDirectory = file.isDirectory;
    item.dataset.name = file.name;

    item.style.cssText = 'display: grid; grid-template-columns: 1fr 100px 150px; gap: 16px; align-items: center; padding: 10px 16px; color: #ccc; font-size: 13px; border-bottom: 1px solid #2a2a2a;';

    const iconType = this.getFileIconType(file);

    item.innerHTML = `
      <div class="file-item-name" style="display: flex; align-items: center; gap: 10px;">
        ${this.getFileIcon(iconType)}
        <span class="file-item-text" style="color: #fff;">${file.name}</span>
      </div>
      <div class="file-item-size" style="color: #888;">${file.isDirectory ? '-' : this.formatFileSize(file.size)}</div>
      <div class="file-item-date" style="color: #888;">${this.formatDate(file.modified)}</div>
    `;

    return item;
  }

  getFileIconType(file) {
    if (file.isDirectory) return 'folder';

    const lastDot = file.name.lastIndexOf('.');
    if (lastDot === -1) return 'file';

    const ext = file.name.substring(lastDot).toLowerCase();

    if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext)) return 'image';
    if (['.zip', '.rar', '.7z', '.tar', '.gz', '.jar'].includes(ext)) return 'archive';
    if (['.txt', '.log', '.json', '.xml', '.yml', '.yaml', '.properties'].includes(ext)) return 'text';

    return 'file';
  }

  getFileIcon(type) {
    const icons = {
      folder: '<svg class="file-item-icon folder" width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3C1.45 3 1 3.45 1 4V16C1 16.55 1.45 17 2 17H18C18.55 17 19 16.55 19 16V6C19 5.45 18.55 5 18 5H9L8 3H2Z"/></svg>',
      file: '<svg class="file-item-icon file" width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M4 2C2.9 2 2 2.9 2 4V16C2 17.1 2.9 18 4 18H16C17.1 18 18 17.1 18 16V8L12 2H4Z"/></svg>',
      image: '<svg class="file-item-icon image" width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M4 3C2.9 3 2 3.9 2 5V15C2 16.1 2.9 17 4 17H16C17.1 17 18 16.1 18 15V5C18 3.9 17.1 3 16 3H4ZM4 15L7 11L9 13.5L12 9.5L16 15H4Z"/></svg>',
      archive: '<svg class="file-item-icon archive" width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M8 2V4H6V6H8V8H6V10H8V12H6V14H8V16H12V14H10V12H12V10H10V8H12V6H10V4H12V2H8ZM4 4V18H16V4H14V18H10V4H4Z"/></svg>',
      text: '<svg class="file-item-icon text" width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M4 2C2.9 2 2 2.9 2 4V16C2 17.1 2.9 18 4 18H16C17.1 18 18 17.1 18 16V4C18 2.9 17.1 2 16 2H4ZM6 6H14V8H6V6ZM6 10H14V12H6V10ZM6 14H11V16H6V14Z"/></svg>'
    };

    return icons[type] || icons.file;
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 86400000) {
      return date.toLocaleTimeString(window.localizationManager ? (window.localizationManager.getLanguage() === 'en' ? 'en-US' : 'ru-RU') : 'ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    return date.toLocaleDateString(window.localizationManager ? (window.localizationManager.getLanguage() === 'en' ? 'en-US' : 'ru-RU') : 'ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  handleFileListClick(e) {
    const item = e.target.closest('.file-item');
    if (!item) {
      if (!e.ctrlKey) {
        this.clearSelection();
      }
      return;
    }

    if (e.ctrlKey) {
      if (this.selectedItems.has(item.dataset.path)) {
        this.selectedItems.delete(item.dataset.path);
        item.classList.remove('selected');
      } else {
        this.selectedItems.add(item.dataset.path);
        item.classList.add('selected');
      }
    } else if (e.shiftKey && this.selectedItems.size > 0) {
      this.clearSelection();
      this.selectedItems.add(item.dataset.path);
      item.classList.add('selected');
    } else {
      this.clearSelection();
      this.selectedItems.add(item.dataset.path);
      item.classList.add('selected');
    }

    this.updateSelectionStatus();
  }

  handleFileListDblClick(e) {
    const item = e.target.closest('.file-item');
    if (!item) return;

    if (item.dataset.isDirectory === 'true') {
      this.navigateTo(item.dataset.path);
    } else {
      this.openFile(item.dataset.path);
    }
  }

  async openFile(filePath) {
    const result = await window.ipcRenderer.invoke('open-file', filePath);
    if (!result.success) {
      await CustomDialog.alert(t('error_open_file', {error: result.error}), t('common_error_occurred'));
    }
  }

  handleContextMenu(e) {
    e.preventDefault();

    const item = e.target.closest('.file-item');

    if (item && !this.selectedItems.has(item.dataset.path)) {
      this.clearSelection();
      this.selectedItems.add(item.dataset.path);
      item.classList.add('selected');
      this.updateSelectionStatus();
    }

    const pasteItem = this.contextMenu.querySelector('[data-action="paste"]');
    if (pasteItem) {
      if (this.clipboard && this.clipboard.length > 0) {
        pasteItem.removeAttribute('disabled');
      } else {
        pasteItem.setAttribute('disabled', 'true');
      }
    }

    this.contextMenu.style.left = e.clientX + 'px';
    this.contextMenu.style.top = e.clientY + 'px';
    this.contextMenu.classList.remove('hidden');
  }

  handleContextMenuClick(e) {
    const actionItem = e.target.closest('[data-action]');
    if (!actionItem || actionItem.hasAttribute('disabled')) return;

    const action = actionItem.dataset.action;
    this.contextMenu.classList.add('hidden');

    switch (action) {
      case 'open':
        this.openSelected();
        break;
      case 'openExplorer':
        this.openInExplorer();
        break;
      case 'cut':
        this.cutSelected();
        break;
      case 'copy':
        this.copySelected();
        break;
      case 'paste':
        this.paste();
        break;
      case 'rename':
        this.renameSelected();
        break;
      case 'delete':
        this.deleteSelected();
        break;
      case 'properties':
        this.showProperties();
        break;
    }
  }

  openSelected() {
    if (this.selectedItems.size === 0) return;

    const firstItem = Array.from(this.selectedItems)[0];
    const item = this.fileListContent.querySelector(`[data-path="${firstItem}"]`);

    if (item.dataset.isDirectory === 'true') {
      this.navigateTo(firstItem);
    } else {
      this.openFile(firstItem);
    }
  }

  async openInExplorer() {
    if (this.selectedItems.size === 0) return;

    const firstItem = Array.from(this.selectedItems)[0];
    const result = await window.ipcRenderer.invoke('show-item-in-folder', firstItem);

    if (!result.success) {
      await CustomDialog.alert(t('error_general', {error: result.error}), t('common_error_occurred'));
    }
  }

  cutSelected() {
    if (this.selectedItems.size === 0) return;

    this.clipboard = Array.from(this.selectedItems);
    this.clipboardOperation = 'cut';

    this.fileListContent.querySelectorAll('.file-item').forEach(item => {
      if (this.clipboard.includes(item.dataset.path)) {
        item.classList.add('cut');
      } else {
        item.classList.remove('cut');
      }
    });

    this.updateStatus(t('file_manager_items_cut', {count: this.clipboard.length}));
  }

  copySelected() {
    if (this.selectedItems.size === 0) return;

    this.clipboard = Array.from(this.selectedItems);
    this.clipboardOperation = 'copy';

    this.fileListContent.querySelectorAll('.file-item.cut').forEach(item => {
      item.classList.remove('cut');
    });

    this.updateStatus(t('file_manager_items_copied', {count: this.clipboard.length}));
  }

  async paste() {
    if (!this.clipboard || this.clipboard.length === 0) return;

    const result = await window.ipcRenderer.invoke('file-operation', {
      operation: this.clipboardOperation,
      sources: this.clipboard,
      destination: this.currentPath
    });

    if (result.success) {
      if (this.clipboardOperation === 'cut') {
        this.clipboard = null;
        this.clipboardOperation = null;
      }
      this.refresh();
      this.updateStatus(result.message || t('file_manager_operation_success'));
    } else {
      await CustomDialog.alert(t('error_general', {error: result.error}), t('common_error_occurred'));
    }
  }

  renameSelected() {
    if (this.selectedItems.size !== 1) return;

    const itemPath = Array.from(this.selectedItems)[0];
    const item = this.fileListContent.querySelector(`[data-path="${itemPath}"]`);
    const textElement = item.querySelector('.file-item-text');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'file-item-rename-input';
    input.value = item.dataset.name;

    textElement.replaceWith(input);
    input.focus();
    input.select();

    const finishRename = async () => {
      const newName = input.value.trim();

      if (newName && newName !== item.dataset.name) {
        const result = await window.ipcRenderer.invoke('rename-item', {
          oldPath: itemPath,
          newName: newName
        });

        if (result.success) {
          this.refresh();
        } else {
          alert(t('error_rename', {error: result.error}));
          input.replaceWith(textElement);
        }
      } else {
        input.replaceWith(textElement);
      }
    };

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        finishRename();
      } else if (e.key === 'Escape') {
        input.replaceWith(textElement);
      }
    });
  }

  async deleteSelected() {
    if (this.selectedItems.size === 0) return;

    const count = this.selectedItems.size;
    const confirmMsg = count === 1
      ? t('file_manager_delete_selected')
      : t('file_manager_delete_multiple', {count});

    if (!confirm(confirmMsg)) return;

    const result = await window.ipcRenderer.invoke('delete-items', {
      items: Array.from(this.selectedItems)
    });

    if (result.success) {
      this.refresh();
      this.updateStatus(t('file_manager_items_deleted', {count}));
    } else {
      alert(t('error_delete', {error: result.error}));
    }
  }

  async showProperties() {
    if (this.selectedItems.size !== 1) return;

    const itemPath = Array.from(this.selectedItems)[0];
    const result = await window.ipcRenderer.invoke('get-item-properties', itemPath);

    if (result.success) {
      const props = result.properties;
      const message = `
${t('file_manager_properties_name', {name: props.name})}
${t('file_manager_properties_path', {path: props.path})}
${t('file_manager_properties_type', {type: props.isDirectory ? t('common_folder') : t('common_file')})}
${t('file_manager_properties_size', {size: props.isDirectory ? '-' : this.formatFileSize(props.size)})}
${t('file_manager_properties_created', {date: new Date(props.created).toLocaleString(window.localizationManager ? (window.localizationManager.getLanguage() === 'en' ? 'en-US' : 'ru-RU') : 'ru-RU')})}
${t('file_manager_properties_modified', {date: new Date(props.modified).toLocaleString(window.localizationManager ? (window.localizationManager.getLanguage() === 'en' ? 'en-US' : 'ru-RU') : 'ru-RU')})}
      `.trim();

      alert(message);
    }
  }

  async createNewFolder() {
    const name = prompt(t('file_manager_new_folder_prompt'));
    if (!name) return;

    const result = await window.ipcRenderer.invoke('create-folder', {
      path: this.currentPath,
      name: name
    });

    if (result.success) {
      this.refresh();
      this.updateStatus(t('file_manager_folder_created', {name}));
    } else {
      alert(t('error_create_folder', {error: result.error}));
    }
  }

  handleDragStart(e) {
    const item = e.target.closest('.file-item');
    if (!item) return;

    if (!this.selectedItems.has(item.dataset.path)) {
      this.clearSelection();
      this.selectedItems.add(item.dataset.path);
      item.classList.add('selected');
      this.updateSelectionStatus();
    }

    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', JSON.stringify(Array.from(this.selectedItems)));
  }

  handleDragOver(e) {
    e.preventDefault();

    const item = e.target.closest('.file-item');
    if (item && item.dataset.isDirectory === 'true') {
      item.classList.add('drag-over');
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
    } else {
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
    }
  }

  handleDragLeave(e) {
    const item = e.target.closest('.file-item');
    if (item) {
      item.classList.remove('drag-over');
    }
  }

  async handleDrop(e) {
    e.preventDefault();

    const item = e.target.closest('.file-item');
    if (item) {
      item.classList.remove('drag-over');
    }

    let destination = this.currentPath;

    if (item && item.dataset.isDirectory === 'true') {
      destination = item.dataset.path;
    }

    try {
      const sources = JSON.parse(e.dataTransfer.getData('text/plain'));
      const operation = e.ctrlKey ? 'copy' : 'cut';

      const result = await window.ipcRenderer.invoke('file-operation', {
        operation: operation,
        sources: sources,
        destination: destination
      });

      if (result.success) {
        this.refresh();
        this.updateStatus(result.message || t('files_operation_done'));
      } else {
        alert(t('error_general', {error: result.error}));
      }
    } catch (err) {
      console.error('Drop error:', err);
    }
  }

  handleKeyDown(e) {
    const filesTab = document.getElementById('filesTab');
    if (!filesTab || !filesTab.classList.contains('active')) return;

    if (e.ctrlKey && e.key === 'a') {
      e.preventDefault();
      this.selectAll();
    } else if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      this.copySelected();
    } else if (e.ctrlKey && e.key === 'x') {
      e.preventDefault();
      this.cutSelected();
    } else if (e.ctrlKey && e.key === 'v') {
      e.preventDefault();
      this.paste();
    } else if (e.key === 'F2') {
      e.preventDefault();
      this.renameSelected();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      this.deleteSelected();
    } else if (e.key === 'F5') {
      e.preventDefault();
      this.refresh();
    }
  }

  selectAll() {
    this.clearSelection();
    this.fileListContent.querySelectorAll('.file-item').forEach(item => {
      this.selectedItems.add(item.dataset.path);
      item.classList.add('selected');
    });
    this.updateSelectionStatus();
  }

  clearSelection() {
    this.selectedItems.clear();
    this.fileListContent.querySelectorAll('.file-item.selected').forEach(item => {
      item.classList.remove('selected');
    });
    this.fileListContent.querySelectorAll('.file-item.cut').forEach(item => {
      item.classList.remove('cut');
    });
    this.updateSelectionStatus();
  }

  updateSelectionStatus() {
    if (this.selectedItems.size === 0) {
      this.fileStatusSelection.textContent = '';
    } else {
      this.fileStatusSelection.textContent = t('files_selected_count', {count: this.selectedItems.size});
    }
  }

  updateStatus(text) {
    this.fileStatusText.textContent = text;
  }

  setViewMode(mode) {
    this.viewMode = mode;

    if (mode === 'list') {
      this.fileListContent.classList.remove('grid-view');
      this.viewListBtn.classList.add('active');
      this.viewGridBtn.classList.remove('active');
    } else {
      this.fileListContent.classList.add('grid-view');
      this.viewGridBtn.classList.add('active');
      this.viewListBtn.classList.remove('active');
    }
  }
}
let fileManager;

function initFileManagerNow() {
  const filesTab = document.getElementById('filesTab');
  const fileTree = document.getElementById('fileTree');
  const fileListContent = document.getElementById('fileListContent');
  if (filesTab && fileTree && fileListContent) {
    try {
      fileManager = new FileManager();
      return true;
    } catch (error) {
      console.error('✗ Error initializing File Manager:', error);
      return false;
    }
  } else {
    console.error('✗ File Manager elements not found');
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.initFileManagerNow = initFileManagerNow;
  window.FileManager = FileManager;
}
