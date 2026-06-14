const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');

class ModpackInstaller {
  constructor() {
    this.minecraftDir = path.join(os.homedir(), '.minecraft_custom');
    this.versionsDir = path.join(this.minecraftDir, 'versions');
    this.modpacksDir = path.join(this.minecraftDir, 'modpacks');
  }

  async installModpack(modpackPath, modpackName, selectedVersion) {
    try {
      console.log(`Installing modpack: ${modpackName} from ${modpackPath}`);

      // Создаём имя для версии (убираем расширение .mrpack)
      const versionName = modpackName.replace('.mrpack', '');
      const versionDir = path.join(this.versionsDir, versionName);

      // Проверяем существует ли уже такая версия
      if (await fs.pathExists(versionDir)) {
        return { success: false, error: 'Модпак с таким именем уже установлен' };
      }

      // Создаём директорию для версии
      await fs.ensureDir(versionDir);

      // Распаковываем modpack
      const zip = new AdmZip(modpackPath);
      const zipEntries = zip.getEntries();

      // Ищем manifest
      let manifest = null;
      const manifestEntry = zipEntries.find(e => e.entryName === 'modrinth.index.json');

      if (manifestEntry) {
        manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
      } else {
        return { success: false, error: 'Неверный формат модпака (отсутствует modrinth.index.json)' };
      }

      console.log('Modpack manifest:', manifest);

      // Получаем версию Minecraft из манифеста
      const minecraftVersion = manifest.dependencies?.minecraft || selectedVersion;
      const fabricVersion = manifest.dependencies?.['fabric-loader'];
      const forgeVersion = manifest.dependencies?.forge;
      const neoforgeVersion = manifest.dependencies?.neoforge;
      const quiltVersion = manifest.dependencies?.quilt;

      // Определяем загрузчик
      let loader = 'vanilla';
      let loaderVersion = '';

      if (fabricVersion) {
        loader = 'fabric';
        loaderVersion = fabricVersion;
      } else if (forgeVersion) {
        loader = 'forge';
        loaderVersion = forgeVersion;
      } else if (neoforgeVersion) {
        loader = 'neoforge';
        loaderVersion = neoforgeVersion;
      } else if (quiltVersion) {
        loader = 'quilt';
        loaderVersion = quiltVersion;
      }

      // Автоматически скачиваем необходимую версию Java
      const JavaManager = require('./JavaManager');
      const javaManager = new JavaManager();

      console.log(`Checking Java for Minecraft ${minecraftVersion}...`);

      try {
        await javaManager.autoDownloadRequiredJava(minecraftVersion, (progress) => {
          console.log(`Java: ${progress.message}`);
        });
      } catch (error) {
        console.error('Failed to download required Java:', error);
        return {
          success: false,
          error: `Не удалось скачать необходимую версию Java: ${error.message}`
        };
      }

      // Формируем полное имя версии для установки базовой версии
      const fullVersionName = loader !== 'vanilla'
        ? `${minecraftVersion}-${loader}-${loaderVersion}`
        : minecraftVersion;

      console.log(`Need base version: ${fullVersionName}`);

      // Проверяем есть ли уже установленная версия с таким именем
      let existingVersionDir = path.join(this.versionsDir, fullVersionName);
      let baseVersionDir = null;
      let actualVersionName = fullVersionName;

      if (await fs.pathExists(existingVersionDir)) {
        console.log(`Using existing base version: ${fullVersionName}`);
        baseVersionDir = existingVersionDir;
      } else {
        // Ищем похожую версию с тем же загрузчиком И той же версией Minecraft
        console.log(`Base version ${fullVersionName} not found, looking for compatible version...`);
        const allVersions = await fs.readdir(this.versionsDir);

        for (const ver of allVersions) {
          // Ищем версию с тем же загрузчиком и той же версией Minecraft
          if (loader !== 'vanilla' && ver.startsWith(`${minecraftVersion}-${loader}-`)) {
            const verDir = path.join(this.versionsDir, ver);
            const jsonPath = path.join(verDir, `${ver}.json`);
            const jarPath = path.join(verDir, `${ver}.jar`);

            if (await fs.pathExists(jsonPath) && await fs.pathExists(jarPath)) {
              console.log(`Found compatible version: ${ver}`);
              baseVersionDir = verDir;
              actualVersionName = ver;
              break;
            }
          }
        }

        // Если не нашли совместимую версию - скачиваем базовую
        if (!baseVersionDir) {
          console.log(`No compatible version found, downloading ${fullVersionName}...`);

          const MinecraftLauncher = require('./MinecraftLauncher');
          const launcher = new MinecraftLauncher();

          try {
            // Скачиваем полную версию (Minecraft + Loader) одним вызовом
            await launcher.downloadMinecraft(fullVersionName, (progress) => {
              console.log(`Download progress: ${progress.stage} - ${progress.progress || 0}%`);
            });

            baseVersionDir = path.join(this.versionsDir, fullVersionName);
            actualVersionName = fullVersionName;

            if (!await fs.pathExists(baseVersionDir)) {
              return {
                success: false,
                error: `Не удалось установить базовую версию ${fullVersionName}`
              };
            }

            console.log(`Base version ${fullVersionName} installed successfully`);
          } catch (error) {
            console.error('Error installing base version:', error);
            return {
              success: false,
              error: `Ошибка установки базовой версии: ${error.message}`
            };
          }
        }
      }

      // Копируем файлы версии (.json и .jar) в папку модпака
      const versionJsonSource = path.join(baseVersionDir, `${actualVersionName}.json`);
      const versionJarSource = path.join(baseVersionDir, `${actualVersionName}.jar`);
      const versionJsonTarget = path.join(versionDir, `${versionName}.json`);
      const versionJarTarget = path.join(versionDir, `${versionName}.jar`);

      if (await fs.pathExists(versionJsonSource)) {
        // Копируем и модифицируем .json
        const versionJson = await fs.readJson(versionJsonSource);
        versionJson.id = versionName;
        await fs.writeJson(versionJsonTarget, versionJson, { spaces: 2 });
      } else {
        return {
          success: false,
          error: `Не найден файл ${actualVersionName}.json`
        };
      }

      if (await fs.pathExists(versionJarSource)) {
        await fs.copy(versionJarSource, versionJarTarget);
      } else {
        return {
          success: false,
          error: `Не найден файл ${actualVersionName}.jar`
        };
      }

      // Извлекаем файлы модпака (overrides)
      const overridesPath = 'overrides/';

      for (const entry of zipEntries) {
        if (entry.entryName.startsWith(overridesPath) && !entry.isDirectory) {
          const relativePath = entry.entryName.substring(overridesPath.length);
          const targetPath = path.join(versionDir, relativePath);
          await fs.ensureDir(path.dirname(targetPath));
          await fs.writeFile(targetPath, entry.getData());
        }
      }

      // Создаём папку для модов если её нет
      const modsDir = path.join(versionDir, 'mods');
      await fs.ensureDir(modsDir);

      // Скачиваем моды из манифеста
      if (manifest.files && manifest.files.length > 0) {
        console.log(`Downloading ${manifest.files.length} mods...`);

        for (let i = 0; i < manifest.files.length; i++) {
          const file = manifest.files[i];
          const fileName = file.path.split('/').pop();
          const filePath = path.join(versionDir, file.path);

          await fs.ensureDir(path.dirname(filePath));

          // Скачиваем файл
          const axios = require('axios');
          const response = await axios({
            method: 'get',
            url: file.downloads[0],
            responseType: 'stream'
          });

          const writer = fs.createWriteStream(filePath);
          response.data.pipe(writer);

          await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
          });

          console.log(`Downloaded: ${fileName} (${i + 1}/${manifest.files.length})`);
        }
      }

      // Создаём метаданные для версии
      const versionMeta = {
        name: versionName,
        minecraftVersion: minecraftVersion,
        loader: loader,
        loaderVersion: loaderVersion,
        fullVersion: fullVersionName,
        type: 'modpack',
        installedAt: new Date().toISOString()
      };

      await fs.writeJson(path.join(versionDir, 'modpack.json'), versionMeta, { spaces: 2 });

      // Добавляем версию в список изолированных
      const isolationSettingsPath = path.join(this.minecraftDir, 'isolation_settings.json');
      let isolatedVersions = [];

      if (await fs.pathExists(isolationSettingsPath)) {
        isolatedVersions = await fs.readJson(isolationSettingsPath);
      }

      if (!isolatedVersions.includes(versionName)) {
        isolatedVersions.push(versionName);
        await fs.writeJson(isolationSettingsPath, isolatedVersions, { spaces: 2 });
      }

      // Удаляем скачанный файл модпака
      await fs.remove(modpackPath);

      return {
        success: true,
        versionName: versionName,
        fullVersion: fullVersionName,
        minecraftVersion: minecraftVersion,
        loader: loader
      };

    } catch (error) {
      console.error('Modpack installation error:', error);
      return { success: false, error: error.message };
    }
  }

  async getModpackVersions(projectId) {
    try {
      const ModrinthAPI = require('./ModrinthAPI');
      const modrinthAPI = new ModrinthAPI();

      const result = await modrinthAPI.getModVersions(projectId, {});
      return result;
    } catch (error) {
      console.error('Error getting modpack versions:', error);
      return { success: false, error: error.message, versions: [] };
    }
  }
}

module.exports = ModpackInstaller;
