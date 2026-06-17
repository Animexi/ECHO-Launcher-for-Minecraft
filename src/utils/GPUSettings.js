const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const os = require('os');
const path = require('path');

class GPUSettings {
  constructor() {
    this.platform = os.platform();
  }

  /**
   * Автоматически применяет настройки высокой производительности GPU для Java процесса
   * @param {string} javaPath - Путь к исполняемому файлу Java
   * @param {string} preferredGPU - Предпочтительный GPU ('high-performance' или 'power-saving')
   */
  async setJavaGPUPreference(javaPath, preferredGPU = 'high-performance') {
    if (this.platform !== 'win32') {
      console.log('GPU settings are only supported on Windows');
      return { success: false, error: 'Unsupported platform' };
    }

    try {
      // Нормализуем путь к Java
      const normalizedPath = path.normalize(javaPath);

      // Определяем значение настройки (2 = высокая производительность, 1 = энергосбережение)
      const gpuPreference = preferredGPU === 'high-performance' ? 2 : 1;

      // PowerShell скрипт для добавления приложения в настройки графики Windows
      const psScript = `
        $AppPath = "${normalizedPath.replace(/\\/g, '\\\\')}"
        $RegistryPath = "HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences"

        # Создаем ключ реестра если его нет
        if (!(Test-Path $RegistryPath)) {
          New-Item -Path $RegistryPath -Force | Out-Null
        }

        # Устанавливаем настройки GPU для Java
        # GpuPreference=2 означает "High performance"
        Set-ItemProperty -Path $RegistryPath -Name $AppPath -Value "GpuPreference=${gpuPreference};" -Force

        Write-Output "GPU preference set successfully"
      `;

      // Кодируем PowerShell скрипт в Base64 для безопасного выполнения
      const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');

      // Выполняем PowerShell команду
      const { stdout, stderr } = await execAsync(
        `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
        { timeout: 10000 }
      );

      if (stderr && !stderr.includes('WARNING')) {
        console.error('PowerShell stderr:', stderr);
        return { success: false, error: stderr };
      }

      console.log('GPU settings applied:', stdout);
      return { success: true, message: 'GPU preference set to high performance for Java' };

    } catch (error) {
      console.error('Error setting GPU preference:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Проверяет текущие настройки GPU для Java
   * @param {string} javaPath - Путь к исполняемому файлу Java
   */
  async getJavaGPUPreference(javaPath) {
    if (this.platform !== 'win32') {
      return { success: false, error: 'Unsupported platform' };
    }

    try {
      const normalizedPath = path.normalize(javaPath);

      const psScript = `
        $AppPath = "${normalizedPath.replace(/\\/g, '\\\\')}"
        $RegistryPath = "HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences"

        if (Test-Path $RegistryPath) {
          $Value = Get-ItemProperty -Path $RegistryPath -Name $AppPath -ErrorAction SilentlyContinue
          if ($Value) {
            Write-Output $Value.$AppPath
          } else {
            Write-Output "Not set"
          }
        } else {
          Write-Output "Not set"
        }
      `;

      const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
      const { stdout } = await execAsync(
        `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
        { timeout: 10000 }
      );

      const preference = stdout.trim();
      let setting = 'default';

      if (preference.includes('GpuPreference=2')) {
        setting = 'high-performance';
      } else if (preference.includes('GpuPreference=1')) {
        setting = 'power-saving';
      }

      return { success: true, preference: setting };

    } catch (error) {
      console.error('Error getting GPU preference:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Удаляет настройки GPU для Java
   * @param {string} javaPath - Путь к исполняемому файлу Java
   */
  async removeJavaGPUPreference(javaPath) {
    if (this.platform !== 'win32') {
      return { success: false, error: 'Unsupported platform' };
    }

    try {
      const normalizedPath = path.normalize(javaPath);

      const psScript = `
        $AppPath = "${normalizedPath.replace(/\\/g, '\\\\')}"
        $RegistryPath = "HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences"

        if (Test-Path $RegistryPath) {
          Remove-ItemProperty -Path $RegistryPath -Name $AppPath -ErrorAction SilentlyContinue
          Write-Output "GPU preference removed"
        }
      `;

      const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
      await execAsync(
        `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
        { timeout: 10000 }
      );

      return { success: true, message: 'GPU preference removed' };

    } catch (error) {
      console.error('Error removing GPU preference:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = GPUSettings;
