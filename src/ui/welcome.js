const { ipcRenderer } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

let currentStep = 1;
const totalSteps = 5; // Step 1: language, Step 2: features, Step 3: Java, Step 4: skins, Step 5: quick start
let selectedLanguage = 'ru';
let localizationManager;

function initLocalization() {
  if (typeof LocalizationManager !== 'undefined') {
    localizationManager = new LocalizationManager();

    const configPath = path.join(os.homedir(), '.minecraft_custom', 'launcher_config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = fs.readJsonSync(configPath);
        if (config.language) {
          selectedLanguage = config.language;
          localizationManager.setLanguage(selectedLanguage);
        }
      } catch (e) {
        console.error('Error loading language config:', e);
      }
    }

    localizationManager.applyTranslations();
  }
}

async function saveLanguage(lang) {
  try {
    const configPath = path.join(os.homedir(), '.minecraft_custom', 'launcher_config.json');
    await fs.ensureDir(path.dirname(configPath));

    let config = {};
    if (await fs.pathExists(configPath)) {
      config = await fs.readJson(configPath);
    }

    config.language = lang;
    await fs.writeJson(configPath, config, { spaces: 2 });
  } catch (error) {
    console.error('Error saving language:', error);
  }
}

function nextStep() {
  if (currentStep < totalSteps) {
    currentStep++;
    updateStep();
  }
}

function prevStep() {
  if (currentStep > 1) {
    currentStep--;
    updateStep();
  }
}

function updateStep() {
  const steps = document.querySelectorAll('.welcome-step');
  steps.forEach((step, index) => {
    const stepNum = parseInt(step.getAttribute('data-step'));
    if (stepNum === currentStep) {
      step.classList.add('active');
    } else {
      step.classList.remove('active');
    }
  });
}

async function finishSetup() {
  try {
    await ipcRenderer.invoke('complete-first-setup');
    window.close();
  } catch (error) {
    console.error('Error completing setup:', error);
    window.close();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initLocalization();
  updateStep();

  const languageButtons = document.querySelectorAll('.lang-card');
  languageButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const lang = btn.getAttribute('data-lang');
      selectedLanguage = lang;

      languageButtons.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');

      if (localizationManager) {
        localizationManager.setLanguage(lang);
        localizationManager.applyTranslations();
      }

      await saveLanguage(lang);

      setTimeout(() => {
        nextStep();
      }, 500);
    });

    if (btn.getAttribute('data-lang') === selectedLanguage) {
      btn.classList.add('selected');
    }
  });
});