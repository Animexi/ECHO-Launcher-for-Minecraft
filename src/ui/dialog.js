let globalTranslate = (key) => key;

function setTranslateFunction(fn) {
  globalTranslate = fn;
}

function showConfirmDialog(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirmation-overlay';

    overlay.innerHTML = `
      <div class="confirmation-dialog">
        <div class="confirmation-title">${title}</div>
        <div class="confirmation-message">${message}</div>
        <div class="confirmation-buttons">
          <button class="confirmation-btn cancel">${globalTranslate('common_cancel')}</button>
          <button class="confirmation-btn confirm">${globalTranslate('common_delete')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cancelBtn = overlay.querySelector('.cancel');
    const confirmBtn = overlay.querySelector('.confirm');

    cancelBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });

    confirmBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 16px 24px;
    background: ${type === 'error' ? '#c41e3a' : type === 'success' ? '#2ecc71' : '#fff'};
    color: ${type === 'info' ? '#0a0a0a' : '#fff'};
    border-radius: 4px;
    font-size: 14px;
    font-weight: 500;
    z-index: 10000;
    animation: slideInUp 0.3s ease;
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOutDown 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

window.showConfirmDialog = showConfirmDialog;
window.showNotification = showNotification;
window.setTranslateFunction = setTranslateFunction;