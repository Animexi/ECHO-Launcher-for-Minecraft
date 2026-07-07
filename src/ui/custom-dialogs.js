function getTranslation(key) {
  if (window.localizationManager) {
    return window.localizationManager.t(key);
  }
  return key;
}

class CustomDialog {
  static _createOverlay(content) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      display: flex; align-items: center; justify-content: center;
      z-index: 10002; animation: fadeIn 0.2s ease-out;
    `;
    overlay.innerHTML = content;
    document.body.appendChild(overlay);
    return overlay;
  }

  static _createDialog(title, body, buttons) {
    const btnsHtml = buttons.map(b =>
      `<button class="dialog-btn ${b.class || ''}" data-action="${b.action}">${b.label}</button>`
    ).join('');

    return `
      <div style="
        background: rgba(20, 20, 26, 0.98);
        border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 20px;
        width: 420px; max-width: 90vw; overflow: hidden;
        box-shadow: 0 32px 100px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.08);
        animation: scaleIn 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      ">
        <div style="padding: 24px 28px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
          <h3 style="color: #fff; font-size: 17px; font-weight: 800; margin: 0; letter-spacing: -0.3px;">${title}</h3>
        </div>
        <div style="padding: 20px 28px;">
          ${body}
        </div>
        <div style="padding: 12px 28px 20px; display: flex; justify-content: flex-end; gap: 10px;">
          ${btnsHtml}
        </div>
      </div>
      <style>
        .dialog-btn {
          height: 38px; padding: 0 22px; border-radius: 10px;
          font-size: 13px; font-weight: 700; cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          border: 1px solid rgba(255, 255, 255, 0.1); font-family: inherit;
        }
        .dialog-btn-primary {
          background: linear-gradient(135deg, #ffffff 0%, #e0e0e0 100%);
          color: #0a0a0a; border-color: rgba(255, 255, 255, 0.25);
          box-shadow: 0 4px 16px rgba(255, 255, 255, 0.15);
        }
        .dialog-btn-primary:hover {
          background: linear-gradient(135deg, #ffffff 0%, #f0f0f0 100%);
          transform: translateY(-1px);
          box-shadow: 0 6px 24px rgba(255, 255, 255, 0.25);
        }
        .dialog-btn-secondary {
          background: rgba(255, 255, 255, 0.07);
          color: rgba(255, 255, 255, 0.75);
        }
        .dialog-btn-secondary:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #fff; border-color: rgba(255, 255, 255, 0.2);
          transform: translateY(-1px);
        }
        .dialog-btn-danger {
          background: rgba(239, 68, 68, 0.12);
          color: #f87171; border-color: rgba(239, 68, 68, 0.3);
        }
        .dialog-btn-danger:hover {
          background: rgba(239, 68, 68, 0.2);
          border-color: rgba(239, 68, 68, 0.5); color: #fca5a5;
          transform: translateY(-1px);
        }
        .dialog-input {
          width: 100%; height: 44px; padding: 0 16px;
          background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 10px; color: #fff; font-size: 14px; font-weight: 500;
          font-family: inherit; outline: none; box-sizing: border-box;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .dialog-input:focus {
          border-color: rgba(255, 255, 255, 0.3);
          background: rgba(255, 255, 255, 0.08);
          box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.06);
        }
        .dialog-input::placeholder { color: rgba(255, 255, 255, 0.3); }
        .dialog-message {
          color: rgba(255, 255, 255, 0.75); font-size: 14px; line-height: 1.6; margin: 0;
        }
      </style>
    `;
  }

  static alert(message, title = null) {
    if (!title) title = getTranslation('common_attention');
    return new Promise((resolve) => {
      const dialogHtml = this._createDialog(
        title,
        `<p class="dialog-message">${message}</p>`,
        [{ label: getTranslation('common_ok'), class: 'dialog-btn-primary', action: 'ok' }]
      );
      const overlay = this._createOverlay(dialogHtml);
      const close = () => { overlay.remove(); resolve(); };
      overlay.querySelector('[data-action="ok"]').addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      overlay.querySelector('[data-action="ok"]').focus();
    });
  }

  static confirm(message, title = null) {
    if (!title) title = getTranslation('common_confirmation');
    return new Promise((resolve) => {
      const dialogHtml = this._createDialog(
        title,
        `<p class="dialog-message">${message}</p>`,
        [
          { label: getTranslation('common_cancel'), class: 'dialog-btn-secondary', action: 'cancel' },
          { label: getTranslation('common_ok'), class: 'dialog-btn-primary', action: 'confirm' }
        ]
      );
      const overlay = this._createOverlay(dialogHtml);
      const close = (result) => { overlay.remove(); resolve(result); };
      overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
      overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => close(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      overlay.querySelector('[data-action="confirm"]').focus();
    });
  }

  static prompt(message, defaultValue = '', title = null) {
    if (!title) title = getTranslation('common_input');
    return new Promise((resolve) => {
      const dialogHtml = this._createDialog(
        title,
        `<p class="dialog-message" style="margin-bottom: 14px;">${message}</p>
         <input type="text" class="dialog-input" value="${defaultValue}">`,
        [
          { label: getTranslation('common_cancel'), class: 'dialog-btn-secondary', action: 'cancel' },
          { label: getTranslation('common_ok'), class: 'dialog-btn-primary', action: 'ok' }
        ]
      );
      const overlay = this._createOverlay(dialogHtml);
      const input = overlay.querySelector('.dialog-input');
      const close = (result) => { overlay.remove(); resolve(result); };
      overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(null));
      overlay.querySelector('[data-action="ok"]').addEventListener('click', () => close(input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') close(input.value);
        else if (e.key === 'Escape') close(null);
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
      input.focus();
      input.select();
    });
  }

  static showProperties(properties) {
    return new Promise((resolve) => {
      const propsHtml = Object.entries(properties)
        .map(([key, value]) => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-radius: 10px;">
            <span style="color: rgba(255,255,255,0.45); font-size: 13px; font-weight: 500;">${key}</span>
            <span style="color: #fff; font-size: 13px; font-weight: 600; text-align: right; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: text;">${value}</span>
          </div>
        `).join('');

      const dialogHtml = this._createDialog(
        getTranslation('common_properties'),
        `<div style="display: flex; flex-direction: column; gap: 2px;">${propsHtml}</div>`,
        [{ label: getTranslation('common_ok'), class: 'dialog-btn-primary', action: 'ok' }]
      );
      const overlay = this._createOverlay(dialogHtml);
      const close = () => { overlay.remove(); resolve(); };
      overlay.querySelector('[data-action="ok"]').addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      overlay.querySelector('[data-action="ok"]').focus();
    });
  }
}

window.CustomDialog = CustomDialog;
