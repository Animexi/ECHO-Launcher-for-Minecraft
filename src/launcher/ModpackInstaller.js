const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const { bt } = require('../localization/backend-translations');

class ModpackInstaller {
  constructor() {
    this.minecraftDir = path.join(os.homedir(), '.minecraft_custom');
    this.versionsDir = path.join(this.minecraftDir, 'versions');
    this.modpacksDir = path.join(this.minecraftDir, 'modpacks');
  }

  async installModpack(modpackPath, modpackName, selectedVersion) {
    try {
      console.log(`Installing modpack: ${modpackName} from ${modpackPath}`);

      const versionName = modpackName.replace('.mrpack', '');
      const versionDir = path.join(this.versionsDir, versionName);

      if (await fs.pathExists(versionDir)) {
        return { success: false, error: bt('modpack_already_installed') };
      }

      await fs.ensureDir(versionDir);

      const zip = new AdmZip(modpackPath);
      const zipEntries = zip.getEntries();

      let manifest = null;
      const manifestEntry = zipEntries.find(e => e.entryName === 'modrinth.index.json');

      if (manifestEntry) {
        manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
      } else {
        return { success: false, error: bt('modpack_invalid_format') };
      }

      console.log('Modpack manifest:', manifest);

      const minecraftVersion = manifest.dependencies?.minecraft || selectedVersion;
      const fabricVersion = manifest.dependencies?.['fabric-loader'];
      const forgeVersion = manifest.dependencies?.forge;
      const neoforgeVersion = manifest.dependencies?.neoforge;
      const quiltVersion = manifest.dependencies?.quilt;

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
          error: bt('modpack_java_download_failed', {error: error.message})
        };
      }

      const fullVersionName = loader !== 'vanilla'
        ? `${minecraftVersion}-${loader}-${loaderVersion}`
        : minecraftVersion;

      console.log(`Need base version: ${fullVersionName}`);

      let existingVersionDir = path.join(this.versionsDir, fullVersionName);
      let baseVersionDir = null;
      let actualVersionName = fullVersionName;

      if (await fs.pathExists(existingVersionDir)) {
        console.log(`Using existing base version: ${fullVersionName}`);
        baseVersionDir = existingVersionDir;
      } else {
        console.log(`Base version ${fullVersionName} not found, looking for compatible version...`);
        const allVersions = await fs.readdir(this.versionsDir);

        for (const ver of allVersions) {
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

        if (!baseVersionDir) {
          console.log(`No compatible version found, downloading ${fullVersionName}...`);

          const MinecraftLauncher = require('./MinecraftLauncher');
          const launcher = new MinecraftLauncher();

          try {
            await launcher.downloadMinecraft(fullVersionName, (progress) => {
              console.log(`Download progress: ${progress.stage} - ${progress.progress || 0}%`);
            });

            baseVersionDir = path.join(this.versionsDir, fullVersionName);
            actualVersionName = fullVersionName;

            if (!await fs.pathExists(baseVersionDir)) {
              return {
                success: false,
                error: bt('modpack_base_install_failed', {version: fullVersionName})
              };
            }

            console.log(`Base version ${fullVersionName} installed successfully`);
          } catch (error) {
            console.error('Error installing base version:', error);
            return {
              success: false,
              error: bt('modpack_base_install_error', {error: error.message})
            };
          }
        }
      }

      const versionJsonSource = path.join(baseVersionDir, `${actualVersionName}.json`);
      const versionJarSource = path.join(baseVersionDir, `${actualVersionName}.jar`);
      const versionJsonTarget = path.join(versionDir, `${versionName}.json`);
      const versionJarTarget = path.join(versionDir, `${versionName}.jar`);

      if (await fs.pathExists(versionJsonSource)) {
        const versionJson = await fs.readJson(versionJsonSource);
        versionJson.id = versionName;
        await fs.writeJson(versionJsonTarget, versionJson, { spaces: 2 });
      } else {
        return {
          success: false,
          error: bt('modpack_json_not_found', {name: actualVersionName})
        };
      }

      if (await fs.pathExists(versionJarSource)) {
        await fs.copy(versionJarSource, versionJarTarget);
      } else {
        return {
          success: false,
          error: bt('modpack_jar_not_found', {name: actualVersionName})
        };
      }

      const overridesPath = 'overrides/';

      for (const entry of zipEntries) {
        if (entry.entryName.startsWith(overridesPath) && !entry.isDirectory) {
          const relativePath = entry.entryName.substring(overridesPath.length);
          const targetPath = path.join(versionDir, relativePath);
          await fs.ensureDir(path.dirname(targetPath));
          await fs.writeFile(targetPath, entry.getData());
        }
      }

      const modsDir = path.join(versionDir, 'mods');
      await fs.ensureDir(modsDir);

      if (manifest.files && manifest.files.length > 0) {
        console.log(`Downloading ${manifest.files.length} mods...`);

        for (let i = 0; i < manifest.files.length; i++) {
          const file = manifest.files[i];
          const fileName = file.path.split('/').pop();
          const filePath = path.join(versionDir, file.path);

          await fs.ensureDir(path.dirname(filePath));

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

      const isolationSettingsPath = path.join(this.minecraftDir, 'isolation_settings.json');
      let isolatedVersions = [];

      if (await fs.pathExists(isolationSettingsPath)) {
        isolatedVersions = await fs.readJson(isolationSettingsPath);
      }

      if (!isolatedVersions.includes(versionName)) {
        isolatedVersions.push(versionName);
        await fs.writeJson(isolationSettingsPath, isolatedVersions, { spaces: 2 });
      }

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
