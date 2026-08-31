const fs = require('fs-extra');
const path = require('path');
const os = require('os');

/**
 * VersionMerger — правильное слияние версий с учётом правил (rules).
 * Аналог CompleteVersion.resolve() из Legacy Launcher.
 */
class VersionMerger {
  constructor(versionsDir) {
    this.versionsDir = versionsDir;
    this.currentOS = os.platform() === 'win32' ? 'windows' : os.platform() === 'darwin' ? 'macos' : 'linux';
    this.arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  }

  /**
   * Слияние версии с учётом наследования и правил.
   * @param {Object} versionJson - JSON версии
   * @returns {Promise<Object>} слитая версия
   */
  async merge(versionJson) {
    let result = JSON.parse(JSON.stringify(versionJson));
    let current = versionJson;
    const processedParents = new Set();
    const allLibraries = [];

    // Собираем библиотеки из всех родительских версий
    this._collectLibraries(current, allLibraries);

    // Идём по цепочке наследования
    while (current.inheritsFrom && !processedParents.has(current.inheritsFrom)) {
      const parentId = current.inheritsFrom;
      processedParents.add(parentId);

      const parentJsonPath = path.join(this.versionsDir, parentId, `${parentId}.json`);
      if (!await fs.pathExists(parentJsonPath)) break;

      const parentJson = await fs.readJson(parentJsonPath);
      this._collectLibraries(parentJson, allLibraries);

      // Копируем поля от родителя, если их нет в дочерней версии
      this._mergeField(result, parentJson, 'mainClass');
      this._mergeField(result, parentJson, 'assetIndex');
      this._mergeField(result, parentJson, 'assets');
      this._mergeField(result, parentJson, 'javaVersion');
      this._mergeField(result, parentJson, 'minimumLauncherVersion');
      this._mergeField(result, parentJson, 'minecraftArguments');
      this._mergeField(result, parentJson, 'type');

      // Аргументы — сложнее, нужно объединять
      if (parentJson.arguments) {
        if (!result.arguments) {
          result.arguments = JSON.parse(JSON.stringify(parentJson.arguments));
        } else {
          this._mergeArguments(result.arguments, parentJson.arguments);
        }
      }

      current = parentJson;
    }

    // Фильтруем библиотеки по правилам и дедублируем
    result.libraries = this._filterAndDedupLibraries(allLibraries);

    return result;
  }

  /**
   * Собирает библиотеки из версии и всех родителей.
   */
  _collectLibraries(versionObj, libraries) {
    if (versionObj.libraries) {
      for (const lib of versionObj.libraries) {
        libraries.push(lib);
      }
    }
  }

  /**
   * Копирует поле, если его нет в result.
   */
  _mergeField(result, parent, fieldName) {
    if (!result[fieldName] && parent[fieldName]) {
      result[fieldName] = parent[fieldName];
    }
  }

  /**
   * Объединяет аргументы из родительской версии.
   */
  _mergeArguments(resultArgs, parentArgs) {
    for (const argType of ['jvm', 'game']) {
      if (parentArgs[argType]) {
        if (!resultArgs[argType]) {
          resultArgs[argType] = JSON.parse(JSON.stringify(parentArgs[argType]));
        } else {
          // Добавляем новые аргументы, избегая дубликатов строк
          const existing = new Set(resultArgs[argType].filter(a => typeof a === 'string'));
          for (const arg of parentArgs[argType]) {
            if (typeof arg === 'string' && !existing.has(arg)) {
              resultArgs[argType].push(arg);
            } else if (typeof arg === 'object') {
              // Объекты с правилами всегда добавляем
              resultArgs[argType].push(arg);
            }
          }
        }
      }
    }
  }

  /**
   * Фильтрует библиотеки по правилам (rules) и дедублирует.
   * Правила проверяют OS, архитектуру, версию Java и другие условия.
   */
  _filterAndDedupLibraries(libraries) {
    const filtered = [];
    const dedupMap = new Map();

    for (const lib of libraries) {
      // Проверяем правила
      if (!this._isLibraryApplicable(lib)) {
        continue;
      }

      // Дедупликация
      const key = this._getLibraryKey(lib);
      const existing = dedupMap.get(key);

      if (!existing) {
        dedupMap.set(key, lib);
        filtered.push(lib);
      } else {
        // Если есть две версии одной библиотеки, берём более новую
        if (this._isLibraryNewer(lib, existing)) {
          // Удаляем старую из filtered
          const idx = filtered.indexOf(existing);
          if (idx !== -1) filtered.splice(idx, 1);
          dedupMap.set(key, lib);
          filtered.push(lib);
        }
      }
    }

    return filtered;
  }

  /**
   * Проверяет, применима ли библиотека к текущей системе.
   */
  _isLibraryApplicable(library) {
    // Если нет правил — всегда применима
    if (!library.rules) return true;

    // Если есть rules — проверяем каждое правило
    // Правило с action='allow' — библиотека применяется, если хотя бы одно правило совпало
    // Правило с action='disallow' — библиотека НЕ применяется, если правило совпало
    // Логика: если есть disallow-правила, которые совпали — библиотека не применима
    // Иначе: если есть allow-правила, хотя бы одно должно совпасть

    const allowRules = library.rules.filter(r => r.action === 'allow');
    const disallowRules = library.rules.filter(r => r.action === 'disallow');

    // Проверяем disallow правила
    for (const rule of disallowRules) {
      if (this._ruleMatches(rule)) {
        return false; // Библиотека не применима
      }
    }

    // Если нет allow правил — применима (по умолчанию)
    if (allowRules.length === 0) return true;

    // Проверяем allow правила — хотя бы одно должно совпасть
    for (const rule of allowRules) {
      if (this._ruleMatches(rule)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Проверяет, совпадает ли правило с текущей системой.
   */
  _ruleMatches(rule) {
    // Проверка OS
    if (rule.os) {
      if (rule.os.name && rule.os.name !== this.currentOS) {
        return false;
      }
      if (rule.os.version && !this._matchesVersion(rule.os.version)) {
        return false;
      }
      if (rule.os.arch && rule.os.arch !== this.arch) {
        return false;
      }
    }

    // Проверка версии Java
    if (rule.javaVersion) {
      if (!this._matchesJavaVersion(rule.javaVersion)) {
        return false;
      }
    }

    // Проверка feature (например, 'has_custom_resources')
    if (rule.features) {
      // В нашем случае features обычно не используются, считаем что совпадает
      // Можно расширить при необходимости
    }

    return true;
  }

  /**
   * Проверяет совпадение версии (например, '>=1.7.0').
   */
  _matchesVersion(versionPattern) {
    // Простая проверка: если начинается с >=, <=, == — парсим
    if (versionPattern.startsWith('>=')) {
      const required = this._parseVersion(versionPattern.substring(2));
      const current = this._parseVersion(process.version.substring(1));
      return this._compareVersions(current, required) >= 0;
    }
    if (versionPattern.startsWith('<=')) {
      const required = this._parseVersion(versionPattern.substring(2));
      const current = this._parseVersion(process.version.substring(1));
      return this._compareVersions(current, required) <= 0;
    }
    if (versionPattern.startsWith('==')) {
      const required = this._parseVersion(versionPattern.substring(2));
      const current = this._parseVersion(process.version.substring(1));
      return this._compareVersions(current, required) === 0;
    }
    // Если просто число — считаем что совпадает (для простоты)
    return true;
  }

  /**
   * Проверяет версию Java.
   */
  _matchesJavaVersion(javaVersionPattern) {
    // Например: '>=21.0.0' или '>=17'
    let requiredMajor = null;
    if (javaVersionPattern.startsWith('>=')) {
      requiredMajor = parseInt(javaVersionPattern.substring(2).split('.')[0]);
    } else if (javaVersionPattern.startsWith('<=')) {
      requiredMajor = parseInt(javaVersionPattern.substring(2).split('.')[0]);
    }

    if (requiredMajor !== null) {
      const currentMajor = parseInt(process.version.substring(1).split('.')[0]);
      if (javaVersionPattern.startsWith('>=')) {
        return currentMajor >= requiredMajor;
      }
      if (javaVersionPattern.startsWith('<=')) {
        return currentMajor <= requiredMajor;
      }
    }

    return true;
  }

  /**
   * Парсит версию в массив чисел.
   */
  _parseVersion(versionStr) {
    return versionStr.split('.').map(v => parseInt(v) || 0);
  }

  /**
   * Сравнивает две версии.
   */
  _compareVersions(v1, v2) {
    const maxLen = Math.max(v1.length, v2.length);
    for (let i = 0; i < maxLen; i++) {
      const n1 = v1[i] || 0;
      const n2 = v2[i] || 0;
      if (n1 !== n2) return n1 - n2;
    }
    return 0;
  }

  /**
   * Получает уникальный ключ библиотеки для дедупликации.
   */
  _getLibraryKey(library) {
    if (library.downloads?.artifact?.path) {
      return library.downloads.artifact.path;
    }
    if (library.name) {
      return library.name;
    }
    return JSON.stringify(library);
  }

  /**
   * Проверяет, является ли библиотека более новой.
   */
  _isLibraryNewer(newLib, oldLib) {
    const newVer = this._getLibraryVersion(newLib);
    const oldVer = this._getLibraryVersion(oldLib);
    if (!newVer || !oldVer) return false;

    const newParts = newVer.split('.').map(v => parseInt(v) || 0);
    const oldParts = oldVer.split('.').map(v => parseInt(v) || 0);

    return this._compareVersions(newParts, oldParts) > 0;
  }

  /**
   * Получает версию библиотеки из имени.
   */
  _getLibraryVersion(library) {
    if (library.name) {
      const parts = library.name.split(':');
      return parts.length >= 3 ? parts[2] : null;
    }
    if (library.downloads?.artifact?.path) {
      const pathParts = library.downloads.artifact.path.split('/');
      return pathParts[pathParts.length - 2] || null;
    }
    return null;
  }
}

module.exports = VersionMerger;
