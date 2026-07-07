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
    this.sortField = 'name';
    this.sortAsc = true;

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
    this.fileListContent = document.getElementById('fileListContent');
    this.fileStatusText = document.getElementById('fileStatusText');
    this.fileStatusSelection = document.getElementById('fileStatusSelection');
    this.contextMenu = document.getElementById('fileContextMenu');
    this.sortName = document.getElementById('sortName');
    this.sortSize = document.getElementById('sortSize');
    this.sortDate = document.getElementById('sortDate');
  }

  attachEventListeners() {
    this.navBackBtn.addEventListener('click', () => this.navigateBack());
    this.navForwardBtn.addEventListener('click', () => this.navigateForward());
    this.navUpBtn.addEventListener('click', () => this.navigateUp());
    this.navRefreshBtn.addEventListener('click', () => this.refresh());
    this.newFolderBtn.addEventListener('click', () => this.createNewFolder());
    this.viewListBtn.addEventListener('click', () => this.setViewMode('list'));
    this.viewGridBtn.addEventListener('click', () => this.setViewMode('grid'));

    if (this.sortName) this.sortName.addEventListener('click', () => this.toggleSort('name'));
    if (this.sortSize) this.sortSize.addEventListener('click', () => this.toggleSort('size'));
    if (this.sortDate) this.sortDate.addEventListener('click', () => this.toggleSort('date'));

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
        CustomDialog.alert(t('error_general', {error: result.error}), t('common_error_occurred'));
      }
    });
  }

  toggleSort(field) {
    if (this.sortField === field) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortField = field;
      this.sortAsc = true;
    }
    this.updateSortHeaders();
    if (this.currentFiles) {
      this.renderFileList(this.currentFiles);
    }
  }

  updateSortHeaders() {
    [this.sortName, this.sortSize, this.sortDate].forEach(el => {
      if (el) {
        el.classList.remove('sorted');
        const arrow = el.querySelector('.sort-arrow');
        if (arrow) arrow.textContent = '';
      }
    });
    const active = this.sortField === 'name' ? this.sortName : this.sortField === 'size' ? this.sortSize : this.sortDate;
    if (active) {
      active.classList.add('sorted');
      const arrow = active.querySelector('.sort-arrow');
      if (arrow) arrow.textContent = this.sortAsc ? '▲' : '▼';
    }
  }

  async loadRootDirectory() {
    if (this.fileListContent) this.fileListContent.innerHTML = '';
    const result = await window.ipcRenderer.invoke('get-minecraft-root');
    if (result.success) {
      await this.navigateTo(result.path);
    } else {
      CustomDialog.alert(t('error_load_root'), t('common_error_occurred'));
    }
  }

  async navigateTo(dirPath) {
    this.updateStatus(t('common_loading'));
    const result = await window.ipcRenderer.invoke('list-directory', dirPath);
    if (!result.success) {
      CustomDialog.alert(t('file_manager_open_error', {error: result.error}), t('common_error_occurred'));
      return;
    }
    if (this.historyIndex < this.navigationHistory.length - 1) {
      this.navigationHistory = this.navigationHistory.slice(0, this.historyIndex + 1);
    }
    this.navigationHistory.push(dirPath);
    this.historyIndex++;
    this.currentPath = dirPath;
    this.currentFiles = result.files;
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
      CustomDialog.alert(t('file_manager_open_error', {error: result.error}), t('common_error_occurred'));
      return;
    }
    this.currentPath = dirPath;
    this.currentFiles = result.files;
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
          <svg width="56" height="56" viewBox="0 0 64 64" fill="currentColor">
            <path d="M8 12C6.9 12 6 12.9 6 14V50C6 51.1 6.9 52 8 52H56C57.1 52 58 51.1 58 50V20C58 18.9 57.1 18 56 18H28L24 12H8Z"/>
          </svg>
          <span>${t('common_empty_folder')}</span>
        </div>
      `;
      return;
    }

    const sorted = [...files].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      let cmp = 0;
      if (this.sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (this.sortField === 'size') cmp = a.size - b.size;
      else if (this.sortField === 'date') cmp = a.modified - b.modified;
      return this.sortAsc ? cmp : -cmp;
    });

    this.fileListContent.innerHTML = '';
    const fragment = document.createDocumentFragment();
    sorted.forEach(file => fragment.appendChild(this.createFileItem(file)));
    this.fileListContent.appendChild(fragment);
  }

  createFileItem(file) {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.draggable = true;
    item.dataset.path = file.path;
    item.dataset.isDirectory = file.isDirectory;
    item.dataset.name = file.name;

    const iconType = this.getFileIconType(file);
    item.innerHTML = `
      <div class="file-item-name">
        ${this.getFileIcon(iconType)}
        <span class="file-item-text">${file.name}</span>
      </div>
      <div class="file-item-size">${file.isDirectory ? '—' : this.formatFileSize(file.size)}</div>
      <div class="file-item-date">${this.formatDate(file.modified)}</div>
    `;
    return item;
  }

  getFileIconType(file) {
    if (file.isDirectory) return 'folder';
    const lastDot = file.name.lastIndexOf('.');
    if (lastDot === -1) return 'file';
    const ext = file.name.substring(lastDot).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)) return 'image';
    if (['.zip', '.rar', '.7z', '.tar', '.gz', '.jar'].includes(ext)) return 'archive';
    if (['.txt', '.log', '.json', '.xml', '.yml', '.yaml', '.properties', '.cfg', '.ini', '.toml', '.md'].includes(ext)) return 'text';
    if (['.js', '.ts', '.py', '.java', '.css', '.html', '.sh', '.bat', '.cmd', '.ps1'].includes(ext)) return 'code';
    return 'file';
  }

  getFileIcon(type) {
    const icons = {
      folder: '<svg class="file-item-icon folder" width="22" height="22" viewBox="0 0 20 20" fill="currentColor"><path d="M2 4C2 2.9 2.9 2 4 2H8L10 4H16C17.1 4 18 4.9 18 6V16C18 17.1 17.1 18 16 18H4C2.9 18 2 17.1 2 16V4Z"/></svg>',
      file: '<svg class="file-item-icon file" width="22" height="22" viewBox="0 0 20 20" fill="currentColor"><path d="M4 2C2.9 2 2 2.9 2 4V16C2 17.1 2.9 18 4 18H16C17.1 18 18 17.1 18 16V8L12 2H4Z"/></svg>',
      image: '<svg class="file-item-icon image" width="22" height="22" viewBox="0 0 20 20" fill="currentColor"><path d="M4 3C2.9 3 2 3.9 2 5V15C2 16.1 2.9 17 4 17H16C17.1 17 18 16.1 18 15V5C18 3.9 17.1 3 16 3H4ZM4 15L7 11L9 13.5L12 9.5L16 15H4Z"/></svg>',
      archive: '<svg class="file-item-icon archive" width="22" height="22" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2V4H12V6H10V8H12V10H10V12H12V14H10V16H8V14H6V12H8V10H6V8H8V6H6V4H8V2H10ZM2 4V18H18V4H2Z"/></svg>',
      text: '<svg class="file-item-icon text" width="22" height="22" viewBox="0 0 20 20" fill="currentColor"><path d="M4 2C2.9 2 2 2.9 2 4V16C2 17.1 2.9 18 4 18H16C17.1 18 18 17.1 18 16V4C18 2.9 17.1 2 16 2H4ZM6 6H14V8H6V6ZM6 10H14V12H6V10ZM6 14H11V16H6V14Z"/></svg>',
      code: '<svg class="file-item-icon code" width="22" height="22" viewBox="0 0 20 20" fill="currentColor"><path d="M7 5L2 10L7 15V12L4.5 10L7 8V5ZM13 5L18 10L13 15V12L15.5 10L13 8V5Z"/></svg>'
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
    const locale = window.localizationManager ? (window.localizationManager.getLanguage() === 'en' ? 'en-US' : 'ru-RU') : 'ru-RU';
    if (diff < 86400000) {
      return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  handleFileListClick(e) {
    const item = e.target.closest('.file-item');
    if (!item) {
      if (!e.ctrlKey) this.clearSelection();
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
      this.openFileViewer(item.dataset.path, item.dataset.name);
    }
  }

  async openFileViewer(filePath, fileName) {
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    const viewableText = ['.txt', '.log', '.json', '.xml', '.yml', '.yaml', '.properties', '.cfg', '.ini', '.toml', '.md', '.js', '.ts', '.py', '.java', '.css', '.html', '.sh', '.bat', '.cmd', '.ps1', '.mcmeta', '.lang'];
    const viewableImage = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];

    if (viewableImage.includes(ext)) {
      this.showImageViewer(filePath, fileName);
      return;
    }

    if (viewableText.includes(ext)) {
      const result = await window.ipcRenderer.invoke('read-file-text', filePath);
      if (result.success) {
        this.showTextViewer(result.content, fileName, ext, filePath);
      } else {
        this.openFileExternal(filePath);
      }
      return;
    }

    this.openFileExternal(filePath);
  }

  showTextViewer(content, fileName, ext, filePath) {
    const existing = document.querySelector('.file-viewer-overlay');
    if (existing) existing.remove();

    const lines = content.split('\n');
    const lineCount = lines.length;
    const sizeKB = (new Blob([content]).size / 1024).toFixed(1);

    const highlighted = lines.map((line, i) => {
      const num = `<span class="line-number">${i + 1}</span>`;
      const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      let colored = escaped;
      if (ext === '.json') {
        colored = escaped
          .replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, '<span style="color:#a5d6ff">"$1"</span>')
          .replace(/\b(true|false|null)\b/g, '<span style="color:#ff7b72">$1</span>')
          .replace(/\b(-?\d+\.?\d*)\b/g, '<span style="color:#79c0ff">$1</span>');
      } else if (ext === '.log') {
        colored = escaped
          .replace(/\b(ERROR|FATAL|SEVERE)\b/gi, '<span style="color:#f87171;font-weight:700">$1</span>')
          .replace(/\b(WARN|WARNING)\b/gi, '<span style="color:#fbbf24">$1</span>')
          .replace(/\b(INFO)\b/gi, '<span style="color:#34d399">$1</span>')
          .replace(/\b(DEBUG|TRACE)\b/gi, '<span style="color:#60a5fa">$1</span>');
      } else if (ext === '.properties' || ext === '.cfg' || ext === '.ini' || ext === '.toml') {
        colored = escaped
          .replace(/^([^#=]+)(=)/, '<span style="color:#a5d6ff">$1</span><span style="color:#8b949e">$2</span>')
          .replace(/^([^#=]+)(:)/, '<span style="color:#a5d6ff">$1</span><span style="color:#8b949e">$2</span>');
      }
      return `<div>${num}<span class="line-content">${colored}</span></div>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'file-viewer-overlay';
    overlay.innerHTML = `
      <div class="file-viewer-container">
        <div class="file-viewer-header">
          <div class="file-viewer-title">
            ${this.getFileIcon(this.getFileIconType({ name: fileName }))}
            <span>${fileName}</span>
            <span class="file-viewer-modified-badge" id="viewerModifiedBadge" style="display:none;">• не сохранено</span>
          </div>
          <div class="file-viewer-actions">
            <button class="file-viewer-btn" id="viewerEditBtn">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12.146 0.146a0.5 0.5 0 0 1 0.708 0l3 3a0.5 0.5 0 0 1 0 0.708l-10 10a0.5 0.5 0 0 1-0.168 0.11l-5 2a0.5 0.5 0 0 1-0.65-0.65l2-5a0.5 0.5 0 0 1 0.11-0.168l10-10zM11.207 2.5L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5z"/></svg>
              Редактировать
            </button>
            <button class="file-viewer-btn file-viewer-save-btn" id="viewerSaveBtn" style="display:none;">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0L2 4V6H0V16H16V6H14V4L8 0ZM8 2.83L12 5.5V6H4V5.5L8 2.83ZM2 14V8H14V14H2Z"/></svg>
              Сохранить
            </button>
            <button class="file-viewer-btn" id="viewerExternalBtn">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M9 2L14 7L9 12V9C4 9 1 11 0 14C1 10 3 6 9 6V2Z"/></svg>
              Внешний
            </button>
            <button class="file-viewer-close" id="viewerCloseBtn">×</button>
          </div>
        </div>
        <div class="file-viewer-body">
          <div class="file-viewer-content" id="viewerContent">
            <div class="file-viewer-text" id="viewerText">${highlighted}</div>
            <textarea class="file-viewer-editor" id="viewerEditor" style="display:none;" spellcheck="false"></textarea>
          </div>
        </div>
        <div class="file-viewer-footer">
          <span id="viewerStats">${lineCount} строк · ${sizeKB} KB</span>
          <span>${filePath}</span>
        </div>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.viewerClose();
    });

    document.body.appendChild(overlay);

    this._viewerFilePath = filePath;
    this._viewerOriginalContent = content;
    this._viewerIsEditing = false;

    const self = this;
    document.getElementById('viewerEditBtn').addEventListener('click', () => self.viewerToggleEdit());
    document.getElementById('viewerSaveBtn').addEventListener('click', () => self.viewerSave());
    document.getElementById('viewerExternalBtn').addEventListener('click', () => self.openFileExternal(filePath));
    document.getElementById('viewerCloseBtn').addEventListener('click', () => self.viewerClose());

    const editor = document.getElementById('viewerEditor');
    if (editor) {
      editor.value = content;
      editor.addEventListener('input', () => {
        const badge = document.getElementById('viewerModifiedBadge');
        const saveBtn = document.getElementById('viewerSaveBtn');
        if (badge) badge.style.display = 'inline';
        if (saveBtn) saveBtn.style.display = 'flex';
      });
    }
  }

  viewerToggleEdit() {
    const text = document.getElementById('viewerText');
    const editor = document.getElementById('viewerEditor');
    const editBtn = document.getElementById('viewerEditBtn');
    const saveBtn = document.getElementById('viewerSaveBtn');

    if (!text || !editor) return;

    this._viewerIsEditing = !this._viewerIsEditing;

    if (this._viewerIsEditing) {
      text.style.display = 'none';
      editor.style.display = 'block';
      editor.value = this._viewerOriginalContent;
      if (saveBtn) saveBtn.style.display = 'flex';
      editBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7 3L2 8L7 13V10L4.5 8L7 6V3ZM9 3L14 8L9 13V10L11.5 8L9 6V3Z"/></svg>
        Просмотр
      `;
      editor.focus();
    } else {
      text.style.display = 'block';
      editor.style.display = 'none';
      if (saveBtn) saveBtn.style.display = 'none';
      editBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12.146 0.146a0.5 0.5 0 0 1 0.708 0l3 3a0.5 0.5 0 0 1 0 0.708l-10 10a0.5 0.5 0 0 1-0.168 0.11l-5 2a0.5 0.5 0 0 1-0.65-0.65l2-5a0.5 0.5 0 0 1 0.11-0.168l10-10zM11.207 2.5L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5z"/></svg>
        Редактировать
      `;
    }
  }

  async viewerSave() {
    const editor = document.getElementById('viewerEditor');
    if (!editor || !this._viewerFilePath) return;

    const content = editor.value;
    const result = await window.ipcRenderer.invoke('write-file-text', this._viewerFilePath, content);

    if (result.success) {
      this._viewerOriginalContent = content;
      const badge = document.getElementById('viewerModifiedBadge');
      if (badge) badge.style.display = 'none';

      const lineCount = content.split('\n').length;
      const sizeKB = (new Blob([content]).size / 1024).toFixed(1);
      const stats = document.getElementById('viewerStats');
      if (stats) stats.textContent = `${lineCount} строк · ${sizeKB} KB`;

      this.updateStatus('Файл сохранён: ' + getBasename(this._viewerFilePath));
    } else {
      CustomDialog.alert('Ошибка сохранения: ' + result.error, 'Ошибка');
    }
  }

  async viewerClose() {
    if (this._viewerIsEditing) {
      const editor = document.getElementById('viewerEditor');
      if (editor && editor.value !== this._viewerOriginalContent) {
        const confirmed = await CustomDialog.confirm('Файл изменён. Закрыть без сохранения?', 'Внимание');
        if (!confirmed) return;
      }
    }
    const overlay = document.querySelector('.file-viewer-overlay');
    if (overlay) overlay.remove();
    this._viewerIsEditing = false;
    this._viewerFilePath = null;
  }

  showImageViewer(filePath, fileName) {
    const existing = document.querySelector('.file-viewer-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'file-viewer-overlay';
    overlay.innerHTML = `
      <div class="file-viewer-container">
        <div class="file-viewer-header">
          <div class="file-viewer-title">
            ${this.getFileIcon('image')}
            <span>${fileName}</span>
          </div>
          <div class="file-viewer-actions">
            <button class="file-viewer-btn" id="imgExternalBtn">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M9 2L14 7L9 12V9C4 9 1 11 0 14C1 10 3 6 9 6V2Z"/></svg>
              Открыть внешним
            </button>
            <button class="file-viewer-close" id="imgCloseBtn">×</button>
          </div>
        </div>
        <div class="file-viewer-body">
          <div class="file-viewer-image">
            <img src="file://${filePath}" alt="${fileName}" />
          </div>
        </div>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);

    document.getElementById('imgExternalBtn').addEventListener('click', () => this.openFileExternal(filePath));
    document.getElementById('imgCloseBtn').addEventListener('click', () => overlay.remove());
  }

  async openFileExternal(filePath) {
    const result = await window.ipcRenderer.invoke('open-file', filePath);
    if (!result.success) {
      CustomDialog.alert(t('error_open_file', {error: result.error}), t('common_error_occurred'));
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
      pasteItem.setAttribute('disabled', (!this.clipboard || this.clipboard.length === 0) ? 'true' : 'false');
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
      case 'open': this.openSelected(); break;
      case 'openExplorer': this.openInExplorer(); break;
      case 'edit': this.editSelected(); break;
      case 'cut': this.cutSelected(); break;
      case 'copy': this.copySelected(); break;
      case 'paste': this.paste(); break;
      case 'rename': this.renameSelected(); break;
      case 'delete': this.deleteSelected(); break;
      case 'properties': this.showProperties(); break;
    }
  }

  openSelected() {
    if (this.selectedItems.size === 0) return;
    const firstItem = Array.from(this.selectedItems)[0];
    const item = this.fileListContent.querySelector(`[data-path="${firstItem}"]`);
    if (item && item.dataset.isDirectory === 'true') {
      this.navigateTo(firstItem);
    } else {
      const name = item ? item.dataset.name : getBasename(firstItem);
      this.openFileViewer(firstItem, name);
    }
  }

  editSelected() {
    if (this.selectedItems.size === 0) return;
    const firstItem = Array.from(this.selectedItems)[0];
    const item = this.fileListContent.querySelector(`[data-path="${firstItem}"]`);
    const name = item ? item.dataset.name : getBasename(firstItem);
    this.openFileViewer(firstItem, name);
  }

  async openInExplorer() {
    if (this.selectedItems.size === 0) return;
    const firstItem = Array.from(this.selectedItems)[0];
    const result = await window.ipcRenderer.invoke('show-item-in-folder', firstItem);
    if (!result.success) {
      CustomDialog.alert(t('error_general', {error: result.error}), t('common_error_occurred'));
    }
  }

  cutSelected() {
    if (this.selectedItems.size === 0) return;
    this.clipboard = Array.from(this.selectedItems);
    this.clipboardOperation = 'cut';
    this.fileListContent.querySelectorAll('.file-item').forEach(item => {
      item.classList.toggle('cut', this.clipboard.includes(item.dataset.path));
    });
    this.updateStatus(t('file_manager_items_cut', {count: this.clipboard.length}));
  }

  copySelected() {
    if (this.selectedItems.size === 0) return;
    this.clipboard = Array.from(this.selectedItems);
    this.clipboardOperation = 'copy';
    this.fileListContent.querySelectorAll('.file-item.cut').forEach(item => item.classList.remove('cut'));
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
    } else {
      CustomDialog.alert(t('error_general', {error: result.error}), t('common_error_occurred'));
    }
  }

  renameSelected() {
    if (this.selectedItems.size !== 1) return;
    const itemPath = Array.from(this.selectedItems)[0];
    const item = this.fileListContent.querySelector(`[data-path="${itemPath}"]`);
    if (!item) return;
    const nameContainer = item.querySelector('.file-item-name');
    const textElement = item.querySelector('.file-item-text');
    if (!nameContainer || !textElement) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'file-item-rename-input';
    input.value = item.dataset.name;
    textElement.style.display = 'none';
    nameContainer.appendChild(input);
    input.focus();
    input.select();

    let renamed = false;
    const finishRename = async () => {
      if (renamed) return;
      const newName = input.value.trim();
      if (input.parentNode) input.remove();
      textElement.style.display = '';
      if (newName && newName !== item.dataset.name) {
        renamed = true;
        const result = await window.ipcRenderer.invoke('rename-item', { oldPath: itemPath, newName });
        if (result.success) this.refresh();
        else {
          CustomDialog.alert(t('error_rename', {error: result.error}));
        }
      }
    };
    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { renamed = true; input.remove(); textElement.style.display = ''; }
    });
  }

  async deleteSelected() {
    if (this.selectedItems.size === 0) return;
    const count = this.selectedItems.size;
    const confirmMsg = count === 1 ? t('file_manager_delete_selected') : t('file_manager_delete_multiple', {count});
    const confirmed = await CustomDialog.confirm(confirmMsg, t('common_confirm'));
    if (!confirmed) return;
    const result = await window.ipcRenderer.invoke('delete-items', { items: Array.from(this.selectedItems) });
    if (result.success) {
      this.refresh();
      this.updateStatus(t('file_manager_items_deleted', {count}));
    } else {
      CustomDialog.alert(t('error_delete', {error: result.error}));
    }
  }

  async showProperties() {
    if (this.selectedItems.size !== 1) return;
    const itemPath = Array.from(this.selectedItems)[0];
    const result = await window.ipcRenderer.invoke('get-item-properties', itemPath);
    if (!result.success) return;

    const props = result.properties;
    const existing = document.querySelector('.props-overlay');
    if (existing) existing.remove();

    const isFolder = props.isDirectory;
    const iconSvg = isFolder
      ? '<svg width="64" height="64" viewBox="0 0 64 64" fill="#ffd966"><path d="M4 12C4 8.69 6.69 6 10 6H24L30 12H54C57.31 12 60 14.69 60 18V52C60 55.31 57.31 58 54 58H10C6.69 58 4 55.31 4 52V12Z"/></svg>'
      : this.getFileIcon(this.getFileIconType({ name: props.name }));

    const locale = window.localizationManager ? (window.localizationManager.getLanguage() === 'en' ? 'en-US' : 'ru-RU') : 'ru-RU';

    const overlay = document.createElement('div');
    overlay.className = 'props-overlay';
    overlay.innerHTML = `
      <div class="props-container">
        <div class="props-header">
          <h3>Свойства</h3>
          <button class="props-close" onclick="this.closest('.props-overlay').remove()">×</button>
        </div>
        <div class="props-icon">${iconSvg}</div>
        <div class="props-body">
          <div class="props-name">${props.name}</div>
          <div class="props-grid">
            <div class="props-row">
              <span class="props-label">Тип</span>
              <span class="props-value">${isFolder ? 'Папка' : 'Файл'}</span>
            </div>
            <div class="props-row">
              <span class="props-label">Расширение</span>
              <span class="props-value">${isFolder ? '—' : (props.name.includes('.') ? props.name.substring(props.name.lastIndexOf('.')) : 'нет')}</span>
            </div>
            <div class="props-separator"></div>
            <div class="props-row">
              <span class="props-label">Размер</span>
              <span class="props-value">${isFolder ? '—' : this.formatFileSize(props.size)}</span>
            </div>
            <div class="props-row">
              <span class="props-label">Создан</span>
              <span class="props-value">${new Date(props.created).toLocaleString(locale)}</span>
            </div>
            <div class="props-row">
              <span class="props-label">Изменён</span>
              <span class="props-value">${new Date(props.modified).toLocaleString(locale)}</span>
            </div>
            <div class="props-separator"></div>
            <div class="props-row">
              <span class="props-label">Путь</span>
              <span class="props-value" title="${props.path}">${props.path}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
  }

  async createNewFolder() {
    const name = await CustomDialog.prompt(t('file_manager_new_folder_prompt'), 'Новая папка');
    if (!name) return;
    const result = await window.ipcRenderer.invoke('create-folder', { path: this.currentPath, name });
    if (result.success) {
      this.refresh();
      this.updateStatus(t('file_manager_folder_created', {name}));
    } else {
      CustomDialog.alert(t('error_create_folder', {error: result.error}));
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
    e.dataTransfer.setData('text/uri-list', 'file:///' + item.dataset.path.replace(/\\/g, '/'));
  }

  handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    const item = e.target.closest('.file-item');
    if (item && item.dataset.isDirectory === 'true') {
      item.classList.add('drag-over');
    }
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
    } else {
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
    }
  }

  handleDragLeave(e) {
    if (!this.fileListContent.contains(e.relatedTarget)) {
      this.fileListContent.querySelectorAll('.file-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    }
  }

  async handleDrop(e) {
    e.preventDefault();
    const item = e.target.closest('.file-item');
    if (item) item.classList.remove('drag-over');
    let destination = this.currentPath;
    if (item && item.dataset.isDirectory === 'true') destination = item.dataset.path;

    // External files dragged from OS
    const externalFiles = e.dataTransfer.files;
    if (externalFiles && externalFiles.length > 0) {
      const filePaths = [];
      for (let i = 0; i < externalFiles.length; i++) {
        if (externalFiles[i].path) filePaths.push(externalFiles[i].path);
      }
      if (filePaths.length > 0) {
        const result = await window.ipcRenderer.invoke('copy-external-files', {
          files: filePaths,
          destination: destination
        });
        if (result.success) {
          this.refresh();
          this.updateStatus(`Скопировано файлов: ${filePaths.length}`);
        } else {
          CustomDialog.alert('Ошибка копирования: ' + result.error, 'Ошибка');
        }
      }
      return;
    }

    // Internal drag
    try {
      const sources = JSON.parse(e.dataTransfer.getData('text/plain'));
      const operation = e.ctrlKey ? 'copy' : 'cut';
      const result = await window.ipcRenderer.invoke('file-operation', { operation, sources, destination });
      if (result.success) {
        this.refresh();
        this.updateStatus(result.message || t('files_operation_done'));
      }
    } catch (err) {
      console.error('Drop error:', err);
    }
  }

  handleKeyDown(e) {
    const filesTab = document.getElementById('filesTab');
    if (!filesTab || !filesTab.classList.contains('active')) return;
    if (e.key === 'Escape') {
      const viewer = document.querySelector('.file-viewer-overlay');
      if (viewer) { fileManager.viewerClose(); return; }
      const props = document.querySelector('.props-overlay');
      if (props) { props.remove(); return; }
    }
    if (e.ctrlKey && e.key === 'a') { e.preventDefault(); this.selectAll(); }
    else if (e.ctrlKey && e.key === 'c') { e.preventDefault(); this.copySelected(); }
    else if (e.ctrlKey && e.key === 'x') { e.preventDefault(); this.cutSelected(); }
    else if (e.ctrlKey && e.key === 'v') { e.preventDefault(); this.paste(); }
    else if (e.key === 'F2') { e.preventDefault(); this.renameSelected(); }
    else if (e.key === 'Delete') { e.preventDefault(); this.deleteSelected(); }
    else if (e.key === 'F5') { e.preventDefault(); this.refresh(); }
    else if (e.key === 'Enter') { e.preventDefault(); this.openSelected(); }
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
    this.fileListContent.querySelectorAll('.file-item.selected').forEach(item => item.classList.remove('selected'));
    this.fileListContent.querySelectorAll('.file-item.cut').forEach(item => item.classList.remove('cut'));
    this.updateSelectionStatus();
  }

  updateSelectionStatus() {
    this.fileStatusSelection.textContent = this.selectedItems.size > 0 ? t('files_selected_count', {count: this.selectedItems.size}) : '';
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
  const fileListContent = document.getElementById('fileListContent');
  if (filesTab && fileListContent) {
    try {
      fileManager = new FileManager();
      window.fileManager = fileManager;
      return true;
    } catch (error) {
      console.error('Error initializing File Manager:', error);
      return false;
    }
  }
  return false;
}

if (typeof window !== 'undefined') {
  window.initFileManagerNow = initFileManagerNow;
  window.FileManager = FileManager;
}
