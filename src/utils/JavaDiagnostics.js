const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

class JavaDiagnostics {
  constructor() {
    this.minecraftDir = path.join(os.homedir(), '.minecraft_custom');
  }

  async runDiagnostics() {
    const results = {
      javaFound: false,
      javaVersion: null,
      javaPath: null,
      heapSize: null,
      issues: [],
      fixes: []
    };

    try {
      const { stdout } = await execAsync('java -version 2>&1', { timeout: 10000 });
      results.javaFound = true;
      const versionMatch = stdout.match(/version "(\d+)/);
      if (versionMatch) {
        results.javaVersion = parseInt(versionMatch[1]);
      }
    } catch (e) {
      results.issues.push({
        type: 'error',
        message: 'Java not found in PATH',
        fix: 'Install Java or set JAVA_HOME'
      });
      return results;
    }

    try {
      const { stdout: pathOut } = await execAsync('where java', { timeout: 5000 });
      results.javaPath = pathOut.trim().split('\n')[0].trim();
    } catch (e) {}

    const configPath = path.join(this.minecraftDir, 'launcher_config.json');
    if (await fs.pathExists(configPath)) {
      try {
        const config = await fs.readJson(configPath);
        results.heapSize = config.memory || 2048;

        if (config.memory > 8192) {
          results.issues.push({
            type: 'warn',
            message: `Very high memory allocation: ${config.memory}MB`,
            fix: 'Consider reducing to 4096-8192MB for better GC performance'
          });
        }

        if (config.memory < 1024) {
          results.issues.push({
            type: 'warn',
            message: `Very low memory allocation: ${config.memory}MB`,
            fix: 'Increase to at least 2048MB for stable gameplay'
          });
        }
      } catch (e) {}
    }

    if (results.javaVersion && results.javaVersion < 17) {
      try {
        const versionsDir = path.join(this.minecraftDir, 'versions');
        if (await fs.pathExists(versionsDir)) {
          const versions = await fs.readdir(versionsDir);
          const modernVersions = versions.filter(v => {
            const match = v.match(/^1\.(\d+)/);
            return match && parseInt(match[1]) >= 17;
          });
          if (modernVersions.length > 0) {
            results.issues.push({
              type: 'warn',
              message: `Java ${results.javaVersion} may not support Minecraft versions: ${modernVersions.slice(0, 3).join(', ')}`,
              fix: 'Install Java 17+ for Minecraft 1.17+'
            });
            results.fixes.push({ type: 'install-java', version: 17 });
          }
        }
      } catch (e) {}
    }

    try {
      const tempDir = os.tmpdir();
      const testFile = path.join(tempDir, 'echo_java_test');
      await fs.writeFile(testFile, 'test');
      await fs.remove(testFile);
    } catch (e) {
      results.issues.push({
        type: 'warn',
        message: 'Limited write permissions in temp directory',
        fix: 'Run launcher as administrator or check antivirus settings'
      });
    }

    const gameDir = path.join(this.minecraftDir, 'versions');
    try {
      await fs.ensureDir(path.join(gameDir, '_test_write'));
      await fs.remove(path.join(gameDir, '_test_write'));
    } catch (e) {
      results.issues.push({
        type: 'error',
        message: 'Cannot write to Minecraft directory',
        fix: 'Check folder permissions or run as administrator'
      });
    }

    return results;
  }

  async autoFixJavaIssues() {
    const fixes = [];
    const diagnostics = await this.runDiagnostics();

    for (const issue of diagnostics.issues) {
      if (issue.type === 'error' && issue.fix) {
        fixes.push({ issue: issue.message, status: 'needs_manual', fix: issue.fix });
      }
    }

    const configPath = path.join(this.minecraftDir, 'launcher_config.json');
    if (await fs.pathExists(configPath)) {
      try {
        const config = await fs.readJson(configPath);
        if (config.memory > 12288) {
          config.memory = 8192;
          await fs.writeJson(configPath, config, { spaces: 2 });
          fixes.push({ issue: 'Memory was too high', status: 'fixed', fix: 'Reduced memory to 8192MB' });
        }
      } catch (e) {}
    }

    return { success: true, diagnostics, fixes };
  }

  async checkModCompatibility(versionDir) {
    const results = { compatible: true, warnings: [], errors: [] };

    try {
      const modsDir = path.join(versionDir, 'mods');
      if (!await fs.pathExists(modsDir)) return results;

      const mods = await fs.readdir(modsDir);
      const jarMods = mods.filter(m => m.endsWith('.jar'));

      if (jarMods.length === 0) return results;

      const versionJsonPath = path.join(versionDir, path.basename(versionDir) + '.json');
      if (await fs.pathExists(versionJsonPath)) {
        const versionJson = await fs.readJson(versionJsonPath);
        const mcVersion = (versionJson.id || '').split('-')[0];

        const loader = this.detectLoader(versionJson);

        for (const mod of jarMods) {
          const lowerMod = mod.toLowerCase();
          if (lowerMod.includes('forge') && loader === 'fabric') {
            results.warnings.push(`${mod} appears to be a Forge mod but Fabric is installed`);
          }
          if (lowerMod.includes('fabric') && loader === 'forge') {
            results.warnings.push(`${mod} appears to be a Fabric mod but Forge is installed`);
          }
          if (lowerMod.includes('optifine') && loader === 'fabric') {
            results.errors.push(`${mod} is not compatible with Fabric. Use OptiFabric or Sodium instead`);
            results.compatible = false;
          }
        }

        if (jarMods.length > 50) {
          results.warnings.push(`Large number of mods (${jarMods.length}). This may cause performance issues`);
        }
      }
    } catch (e) {
      console.error('Mod compatibility check error:', e);
    }

    return results;
  }

  detectLoader(versionJson) {
    const id = (versionJson.id || '').toLowerCase();
    const type = (versionJson.type || '').toLowerCase();
    if (id.includes('-fabric-') || type === 'fabric') return 'fabric';
    if (id.includes('-forge-') || type === 'forge') return 'forge';
    if (id.includes('-neoforge-') || type === 'neoforge') return 'neoforge';
    if (id.includes('-quilt-') || type === 'quilt') return 'quilt';
    if (id.includes('-optifine-') || type === 'optifine') return 'optifine';
    return 'vanilla';
  }
}

module.exports = JavaDiagnostics;
