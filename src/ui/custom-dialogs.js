function getTranslation(key) {
  if (window.localizationManager) {
    return window.localizationManager.t(key);
  }
  return key;
}

class CustomDialog {
  static alert(message, title = null) {
    if (!title) title = getTranslation('common_attention');
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-dialog" style="max-width: 400px;">
          <div class="modal-header">
            <h3 style="margin: 0;">${title}</h3>
            <button class="modal-close-x">×</button>
          </div>
          <div class="modal-body" style="padding: 20px;">
            <p style="margin: 0; color: #ccc; line-height: 1.5;">${message}</p>
          </div>
          <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px;">
            <button class="btn-primary dialog-ok">${getTranslation('common_ok')}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = () => {
        overlay.remove();
        resolve();
      };

      overlay.querySelector('.modal-close-x').addEventListener('click', close);
      overlay.querySelector('.dialog-ok').addEventListener('click', close);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });

      overlay.querySelector('.dialog-ok').focus();
    });
  }

  static confirm(message, title = null) {
    if (!title) title = getTranslation('common_confirmation');
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-dialog" style="max-width: 400px;">
          <div class="modal-header">
            <h3 style="margin: 0;">${title}</h3>
            <button class="modal-close-x">×</button>
          </div>
          <div class="modal-body" style="padding: 20px;">
            <p style="margin: 0; color: #ccc; line-height: 1.5;">${message}</p>
          </div>
          <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px;">
            <button class="btn-secondary dialog-cancel">${getTranslation('common_cancel')}</button>
            <button class="btn-primary dialog-confirm">${getTranslation('common_ok')}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.querySelector('.modal-close-x').addEventListener('click', () => close(false));
      overlay.querySelector('.dialog-cancel').addEventListener('click', () => close(false));
      overlay.querySelector('.dialog-confirm').addEventListener('click', () => close(true));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(false);
      });

      overlay.querySelector('.dialog-confirm').focus();
    });
  }

  static prompt(message, defaultValue = '', title = null) {
    if (!title) title = getTranslation('common_input');
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-dialog" style="max-width: 400px;">
          <div class="modal-header">
            <h3 style="margin: 0;">${title}</h3>
            <button class="modal-close-x">×</button>
          </div>
          <div class="modal-body" style="padding: 20px;">
            <p style="margin: 0 0 12px 0; color: #ccc; line-height: 1.5;">${message}</p>
            <input type="text" class="styled-input dialog-input" value="${defaultValue}" style="width: 100%;">
          </div>
          <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px;">
            <button class="btn-secondary dialog-cancel">${getTranslation('common_cancel')}</button>
            <button class="btn-primary dialog-ok">${getTranslation('common_ok')}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const input = overlay.querySelector('.dialog-input');

      const close = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.querySelector('.modal-close-x').addEventListener('click', () => close(null));
      overlay.querySelector('.dialog-cancel').addEventListener('click', () => close(null));
      overlay.querySelector('.dialog-ok').addEventListener('click', () => close(input.value));

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          close(input.value);
        } else if (e.key === 'Escape') {
          close(null);
        }
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(null);
      });

      input.focus();
      input.select();
    });
  }

  static showProperties(properties) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';

      const propsHtml = Object.entries(properties)
        .map(([key, value]) => `
          <div style="display: flex; margin-bottom: 12px;">
            <div style="width: 120px; color: #888; font-weight: 600;">${key}:</div>
            <div style="flex: 1; color: #ccc; word-break: break-all;">${value}</div>
          </div>
        `)
        .join('');

      overlay.innerHTML = `
        <div class="modal-dialog" style="max-width: 600px;">
          <div class="modal-header">
            <h3 style="margin: 0;">${getTranslation('common_properties')}</h3>
            <button class="modal-close-x">×</button>
          </div>
          <div class="modal-body" style="padding: 20px;">
            ${propsHtml}
          </div>
          <div class="modal-footer" style="display: flex; justify-content: flex-end;">
            <button class="btn-primary dialog-ok">${getTranslation('common_ok')}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = () => {
        overlay.remove();
        resolve();
      };

      overlay.querySelector('.modal-close-x').addEventListener('click', close);
      overlay.querySelector('.dialog-ok').addEventListener('click', close);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
    });
  }
}

window.CustomDialog = CustomDialog;