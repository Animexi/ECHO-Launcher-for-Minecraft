const path = require('path');
const os = require('os');
const fs = require('fs-extra');

const backendTranslations = {
  ru: {
    integrity_problems: '⚠️ Обнаружены проблемы\n\nПроверено версий: {versions}\nВсего файлов: {total}\nОтсутствует: {missing}\n\nОтсутствующие файлы:\n{details}{more}',
    integrity_ok: '✓ Все файлы в порядке!\n\nПроверено версий: {versions}\nВсего файлов: {total}\nПроблем не найдено',
    integrity_files_more: '\n\n...и ещё {count} файлов',
    optimization_high: '🚀 Максимальная производительность\nВаш ПК может запускать любые модпаки',
    optimization_balanced: '⚖️ Оптимальный баланс производительности\nПодходит для большинства модпаков',
    optimization_low: '📉 Базовые настройки для стабильной работы\nЛегкие модпаки будут работать нормально',
    optimization_minimal: '⚠️ Маломощный ПК\nРекомендуется играть без модов или с легкими модпаками',
    optimization_memory_change: 'Память: {old} MB → {new} MB',
    optimization_profile_change: 'Профиль: {old} → {new}',
    optimization_system_info: '🖥️ Информация о системе:\n\nОЗУ: {ram} MB\nCPU: {cpu}\nЯдер: {cores}\n\n✨ Применены изменения:\n\n{changes}\n\n💡 Рекомендации:\n\n{recommendation}',
    optimization_already_optimal: '✓ Настройки уже оптимальны',
    file_operation_result: '{count} элемент(ов) {operation}',
    file_copied: 'скопировано',
    file_moved: 'перемещено',
    modpack_already_installed: 'Модпак с таким именем уже установлен',
    modpack_invalid_format: 'Неверный формат модпака (отсутствует modrinth.index.json)',
    modpack_java_download_failed: 'Не удалось скачать необходимую версию Java: {error}',
    modpack_base_install_failed: 'Не удалось установить базовую версию {version}',
    modpack_base_install_error: 'Ошибка установки базовой версии: {error}',
    modpack_json_not_found: 'Не найден файл {name}.json',
    modpack_jar_not_found: 'Не найден файл {name}.jar',
    java_already_installed: 'Java {version} уже установлена',
    java_fetching_info: 'Получение информации о Java...',
    java_not_found_for_download: 'Не удалось найти Java {version} для загрузки',
    java_downloading_progress: 'Загрузка Java {version}... {progress}%',
    java_extracting: 'Извлечение файлов...',
    java_jdk_not_found: 'JDK директория не найдена в архиве',
    java_install_complete: 'Java {version} успешно установлена',
    java_using_system: 'Используется системная Java {version}',
    java_not_found: 'Java версия не найдена',
    stage_fabric_profile: 'Загрузка профиля Fabric',
    stage_fabric_libs: 'Загрузка библиотек Fabric',
    stage_fabric_libs_progress: 'Загрузка библиотек Fabric ({current}/{total})',
    stage_preparing: 'Подготовка {loader} для {version}',
    stage_downloading_base: 'Загрузка базовой версии',
    stage_downloading_fabric: 'Загрузка Fabric Loader',
    stage_install_complete: 'Установка завершена',
    stage_downloading_client: 'Загрузка клиента',
    stage_downloading_libs: 'Загрузка библиотек',
    stage_downloading_libs_progress: 'Загрузка библиотек ({current}/{total})',
    stage_downloading_assets: 'Загрузка ассетов',
    stage_downloading_assets_progress: 'Загрузка ассетов ({current}/{total})',
    stage_complete: 'Завершено',
    time_just_now: 'Только что',
    time_min_ago: '{min} мин назад',
    time_h_ago: '{h} ч назад',
    time_yesterday: 'Вчера',
    time_d_ago: '{d} дн назад',
  },
  en: {
    integrity_problems: '⚠️ Problems detected\n\nVersions checked: {versions}\nTotal files: {total}\nMissing: {missing}\n\nMissing files:\n{details}{more}',
    integrity_ok: '✓ All files are OK!\n\nVersions checked: {versions}\nTotal files: {total}\nNo problems found',
    integrity_files_more: '\n\n...and {count} more files',
    optimization_high: '🚀 Maximum performance\nYour PC can run any modpacks',
    optimization_balanced: '⚖️ Optimal performance balance\nSuitable for most modpacks',
    optimization_low: '📉 Basic settings for stable work\nLight modpacks will work fine',
    optimization_minimal: '⚠️ Low-end PC\nRecommended to play without mods or with light modpacks',
    optimization_memory_change: 'Memory: {old} MB → {new} MB',
    optimization_profile_change: 'Profile: {old} → {new}',
    optimization_system_info: '🖥️ System Information:\n\nRAM: {ram} MB\nCPU: {cpu}\nCores: {cores}\n\n✨ Changes applied:\n\n{changes}\n\n💡 Recommendations:\n\n{recommendation}',
    optimization_already_optimal: '✓ Settings are already optimal',
    file_operation_result: '{count} item(s) {operation}',
    file_copied: 'copied',
    file_moved: 'moved',
    modpack_already_installed: 'A modpack with this name is already installed',
    modpack_invalid_format: 'Invalid modpack format (missing modrinth.index.json)',
    modpack_java_download_failed: 'Failed to download required Java version: {error}',
    modpack_base_install_failed: 'Failed to install base version {version}',
    modpack_base_install_error: 'Base version installation error: {error}',
    modpack_json_not_found: 'File {name}.json not found',
    modpack_jar_not_found: 'File {name}.jar not found',
    java_already_installed: 'Java {version} is already installed',
    java_fetching_info: 'Fetching Java information...',
    java_not_found_for_download: 'Could not find Java {version} for download',
    java_downloading_progress: 'Downloading Java {version}... {progress}%',
    java_extracting: 'Extracting files...',
    java_jdk_not_found: 'JDK directory not found in archive',
    java_install_complete: 'Java {version} successfully installed',
    java_using_system: 'Using system Java {version}',
    java_not_found: 'Java version not found',
    stage_fabric_profile: 'Loading Fabric profile',
    stage_fabric_libs: 'Loading Fabric libraries',
    stage_fabric_libs_progress: 'Loading Fabric libraries ({current}/{total})',
    stage_preparing: 'Preparing {loader} for {version}',
    stage_downloading_base: 'Downloading base version',
    stage_downloading_fabric: 'Downloading Fabric Loader',
    stage_install_complete: 'Installation complete',
    stage_downloading_client: 'Downloading client',
    stage_downloading_libs: 'Downloading libraries',
    stage_downloading_libs_progress: 'Downloading libraries ({current}/{total})',
    stage_downloading_assets: 'Downloading assets',
    stage_downloading_assets_progress: 'Downloading assets ({current}/{total})',
    stage_complete: 'Complete',
    time_just_now: 'Just now',
    time_min_ago: '{min} min ago',
    time_h_ago: '{h}h ago',
    time_yesterday: 'Yesterday',
    time_d_ago: '{d}d ago',
  }
};

function getLanguage() {
  try {
    const configPath = path.join(os.homedir(), '.minecraft_custom', 'launcher_config.json');
    if (fs.existsSync(configPath)) {
      const config = fs.readJsonSync(configPath);
      if (config.language && backendTranslations[config.language]) {
        return config.language;
      }
    }
  } catch (e) {}
  return 'ru';
}

function bt(key, params = {}) {
  const lang = getLanguage();
  let str = backendTranslations[lang][key] || backendTranslations['ru'][key] || key;
  Object.keys(params).forEach(p => {
    str = str.replace(new RegExp(`\\{${p}\\}`, 'g'), params[p]);
  });
  return str;
}

module.exports = { bt, getLanguage };
