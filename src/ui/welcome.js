const { ipcRenderer } = require('electron');

let currentStep = 1;
const totalSteps = 4;

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
    if (index + 1 === currentStep) {
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
  updateStep();
});