/**
 * VersionSyncInfo — сравнение локальной и удалённой версии.
 * Аналог VersionSyncInfo из Legacy Launcher.
 */
class VersionSyncInfo {
  /**
   * @param {Object} localVersion  - локальная версия {id, time, releaseTime, type} или null
   * @param {Object} remoteVersion - удалённая версия {id, time, releaseTime, type} или null
   */
  constructor(localVersion, remoteVersion) {
    this.localVersion = localVersion || null;
    this.remoteVersion = remoteVersion || null;

    if (localVersion === null && remoteVersion === null) {
      throw new Error('Cannot create sync info from NULLs!');
    }

    if (localVersion !== null && remoteVersion !== null) {
      // Синхронизируем versionList (не используется в нашем случае, но для совместимости)
    }
  }

  /**
   * @returns {string} ID версии
   */
  getID() {
    return this.localVersion?.id || this.remoteVersion?.id || null;
  }

  /**
   * @returns {Object} локальная версия
   */
  getLocal() {
    return this.localVersion;
  }

  /**
   * @returns {Object} удалённая версия
   */
  getRemote() {
    return this.remoteVersion;
  }

  /**
   * @returns {Object} самая свежая версия (удалённая, если есть, иначе локальная)
   */
  getLatestVersion() {
    return this.remoteVersion || this.localVersion;
  }

  /**
   * @returns {Object} доступная версия (локальная, если есть, иначе удалённая)
   */
  getAvailableVersion() {
    return this.localVersion || this.remoteVersion;
  }

  /**
   * Установлена ли версия локально?
   * @returns {boolean}
   */
  isInstalled() {
    return this.localVersion !== null;
  }

  /**
   * Есть ли удалённая версия?
   * @returns {boolean}
   */
  hasRemote() {
    return this.remoteVersion !== null;
  }

  /**
   * Актуальна ли локальная версия?
   * @returns {boolean}
   */
  isUpToDate() {
    if (!this.localVersion) return false;
    if (!this.remoteVersion) return true;
    const localTime = new Date(this.localVersion.time || 0).getTime();
    const remoteTime = new Date(this.remoteVersion.time || 0).getTime();
    return localTime >= remoteTime;
  }

  /**
   * Требуется ли обновление?
   * @returns {boolean}
   */
  needsUpdate() {
    return this.isInstalled() && !this.isUpToDate();
  }

  /**
   * @returns {string} человекочитаемое описание
   */
  toString() {
    const id = this.getID();
    const local = this.localVersion ? this.localVersion.id : 'none';
    const remote = this.remoteVersion ? this.remoteVersion.id : 'none';
    return `VersionSyncInfo{id='${id}', local=${local}, remote=${remote}, installed=${this.isInstalled()}, upToDate=${this.isUpToDate()}}`;
  }

  /**
   * Создаёт пустой объект (для версий, которых нет ни локально, ни удалённо).
   * @returns {VersionSyncInfo}
   */
  static createEmpty() {
    return new VersionSyncInfo(null, null);
  }
}

module.exports = VersionSyncInfo;
