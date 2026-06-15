const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const axios = require('axios');
const { execSync, exec } = require('child_process');
const extract = require('extract-zip');
const { bt } = require('../localization/backend-translations');

class JavaManager {
  constructor() {
    this.javaDir = path.join(os.homedir(), '.minecraft_custom', 'java');
    this.adoptiumApiUrl = 'https://api.adoptium.net/v3';
  }

  async init() {
    await fs.ensureDir(this.javaDir);
  }

  getJavaVersionForMinecraft(minecraftVersion) {
    const versionParts = minecraftVersion.split('.');
    const major = parseInt(versionParts[0]);
    const minor = parseInt(versionParts[1]);

    if (major === 1) {
      if (minor <= 16) {
        return 8;
      } else if (minor <= 20 || (minor === 20 && versionParts[2] && parseInt(versionParts[2]) <= 4)) {
        return 17;
      } else {
        return 21;
      }
    }

    if (major >= 26) {
      return 25;
    }

    return 21;
  }

  async getInstalledJavaVersions() {
    try {
      const javaDirs = await fs.readdir(this.javaDir);
      const installedVersions = [];

      for (const dir of javaDirs) {
        const javaPath = path.join(this.javaDir, dir);
        const stat = await fs.stat(javaPath);

        if (stat.isDirectory()) {
          const javaExe = path.join(javaPath, 'bin', 'java.exe');
          if (await fs.pathExists(javaExe)) {
            const version = this.extractJavaVersion(dir);
            installedVersions.push({
              version: version,
              path: javaExe,
              directory: dir
            });
          }
        }
      }

      return installedVersions;
    } catch (error) {
      return [];
    }
  }

  extractJavaVersion(dirName) {
    const match = dirName.match(/jdk-(\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  async isJavaVersionInstalled(version) {
    const installed = await this.getInstalledJavaVersions();
    return installed.some(j => j.version === version);
  }

  async getJavaExecutable(version) {
    const installed = await this.getInstalledJavaVersions();
    const java = installed.find(j => j.version === version);
    return java ? java.path : null;
  }

  async downloadJava(version, progressCallback) {
    try {
      await this.init();

      const isInstalled = await this.isJavaVersionInstalled(version);
      if (isInstalled) {
        return { success: true, message: bt('java_already_installed', {version: version}) };
      }

      if (progressCallback) progressCallback({ stage: 'fetch', progress: 0, message: bt('java_fetching_info') });

      const downloadInfo = await this.getJavaDownloadUrl(version);

      if (!downloadInfo) {
        throw new Error(bt('java_not_found_for_download', {version: version}));
      }

      if (progressCallback) progressCallback({ stage: 'download', progress: 0, message: bt('java_downloading_progress', {version: version, progress: 0}) });

      const tempZip = path.join(this.javaDir, `java-${version}-temp.zip`);

      const response = await axios({
        method: 'get',
        url: downloadInfo.url,
        responseType: 'stream',
        onDownloadProgress: (progressEvent) => {
          if (progressCallback && progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            progressCallback({
              stage: 'download',
              progress: percentCompleted,
              message: bt('java_downloading_progress', {version: version, progress: percentCompleted})
            });
          }
        }
      });

      const writer = fs.createWriteStream(tempZip);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      if (progressCallback) progressCallback({ stage: 'extract', progress: 0, message: bt('java_extracting') });

      const tempExtractDir = path.join(this.javaDir, `java-${version}-extract`);
      await extract(tempZip, { dir: tempExtractDir });

      const extractedDirs = await fs.readdir(tempExtractDir);
      let jdkDir = null;

      for (const dir of extractedDirs) {
        if (dir.startsWith('jdk')) {
          jdkDir = path.join(tempExtractDir, dir);
          break;
        }
      }

      if (!jdkDir) {
        throw new Error(bt('java_jdk_not_found'));
      }

      const finalDir = path.join(this.javaDir, `jdk-${version}`);
      await fs.move(jdkDir, finalDir, { overwrite: true });

      await fs.remove(tempZip);
      await fs.remove(tempExtractDir);

      if (progressCallback) progressCallback({ stage: 'complete', progress: 100, message: bt('java_install_complete', {version: version}) });

      return { success: true, message: bt('java_install_complete', {version: version}), path: path.join(finalDir, 'bin', 'java.exe') };
    } catch (error) {
      console.error(`Failed to download Java ${version}:`, error);
      throw error;
    }
  }

  async getJavaDownloadUrl(version) {
    try {
      const arch = os.arch() === 'x64' ? 'x64' : 'x86';
      const osType = 'windows';
      const imageType = 'jdk';

      const url = `${this.adoptiumApiUrl}/assets/latest/${version}/hotspot?os=${osType}&architecture=${arch}&image_type=${imageType}`;

      const response = await axios.get(url);

      if (response.data && response.data.length > 0) {
        const asset = response.data[0];
        return {
          url: asset.binary.package.link,
          version: asset.version.semver,
          size: asset.binary.package.size
        };
      }

      return null;
    } catch (error) {
      console.error(`Failed to get download URL for Java ${version}:`, error);
      return null;
    }
  }

  async getSystemJava() {
    try {
      const javaVersion = execSync('java -version 2>&1', { encoding: 'utf-8' });
      const match = javaVersion.match(/version "(\d+)\.(\d+)/);

      if (match) {
        const major = parseInt(match[1]);
        const version = major === 1 ? parseInt(match[2]) : major;

        return {
          version: version,
          path: 'java',
          isSystem: true
        };
      }
    } catch (error) {
      return null;
    }
  }

  async autoDownloadRequiredJava(minecraftVersion, progressCallback) {
    const requiredVersion = this.getJavaVersionForMinecraft(minecraftVersion);
    const isInstalled = await this.isJavaVersionInstalled(requiredVersion);

    if (!isInstalled) {
      const systemJava = await this.getSystemJava();
      if (systemJava && systemJava.version === requiredVersion) {
        return { success: true, message: bt('java_using_system', {version: requiredVersion}), path: 'java' };
      }

      return await this.downloadJava(requiredVersion, progressCallback);
    }

    return { success: true, message: bt('java_already_installed', {version: requiredVersion}) };
  }

  async getJavaForMinecraft(minecraftVersion) {
    const requiredVersion = this.getJavaVersionForMinecraft(minecraftVersion);

    const javaPath = await this.getJavaExecutable(requiredVersion);
    if (javaPath) {
      return javaPath;
    }

    const systemJava = await this.getSystemJava();
    if (systemJava && systemJava.version === requiredVersion) {
      return 'java';
    }

    return null;
  }

  async getAllJavaInfo() {
    const installed = await this.getInstalledJavaVersions();
    const systemJava = await this.getSystemJava();

    return {
      installed: installed,
      system: systemJava,
      javaDir: this.javaDir
    };
  }

  async deleteJavaVersion(version) {
    try {
      const installed = await this.getInstalledJavaVersions();
      const java = installed.find(j => j.version === version);

      if (java) {
        const javaPath = path.dirname(path.dirname(java.path));
        await fs.remove(javaPath);
        return { success: true };
      }

      return { success: false, error: bt('java_not_found') };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = JavaManager;
