// Get the canvas element and its 2D context
const canvas = document.getElementById('digitalRainCanvas');
const ctx = canvas.getContext('2d');

// Set the canvas size to match the window size
canvas.height = window.innerHeight;
canvas.width = window.innerWidth;

// Get the font size from CSS variable and calculate the number of columns
let fontSize = 10;
let columns = canvas.width / fontSize;

// Define the characters that can fall and split them into an array
const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%^&*()_+-=[]{}|;':\",.<>/?";
const charArray = characters.split('');

// Create an array to keep track of the position of each column
let drops = [];

// Animation control
let animationId;
let animationSpeed = 1;
let lastTime = 0;
const targetFPS = 30;

// Initialize drops array
function initDrops() {
  drops = [];
  for (let i = 0; i < columns; i++) {
    drops[i] = 1;
  }
}

// Initialize on load
initDrops();

// Handle window resize
function handleResize() {
  canvas.height = window.innerHeight;
  canvas.width = window.innerWidth;
  columns = canvas.width / fontSize;
  initDrops();
}

// Fixed hex conversion with proper padding
function toHex(value) {
  const hex = Math.floor(value * 255).toString(16);
  return hex.length === 1 ? '0' + hex : hex;
}

function updateStyles() {
  const bgAlpha = document.getElementById('bg-alpha-range').value;
  const textAlpha = document.getElementById('text-alpha-range').value;
  const bgColorPicker = document.getElementById('bg-color-picker').value;
  const textColorPicker = document.getElementById('text-color-picker').value;
  
  // Fixed alpha channel conversion
  document.documentElement.style.setProperty('--background-color', `${bgColorPicker}${toHex(bgAlpha)}`);
  document.documentElement.style.setProperty('--text-color', `${textColorPicker}${toHex(textAlpha)}`);

  const newFontSize = parseInt(document.getElementById('font-size-range').value);
  if (newFontSize !== fontSize) {
    fontSize = newFontSize;
    document.documentElement.style.setProperty('--font-size', fontSize + 'px');
    document.getElementById('font-size-value').textContent = fontSize + 'px';
    columns = canvas.width / fontSize;
    initDrops(); // Reset drops when font size changes
  }
}

// Event listeners with proper references for cleanup
const bgColorPicker = document.getElementById('bg-color-picker');
const textColorPicker = document.getElementById('text-color-picker');
const bgAlphaRange = document.getElementById('bg-alpha-range');
const textAlphaRange = document.getElementById('text-alpha-range');
const fontSizeRange = document.getElementById('font-size-range');
const speedRange = document.getElementById('speed-range');
const settingsButton = document.getElementById('settings-toggle-button');

bgColorPicker.addEventListener('input', updateStyles);
textColorPicker.addEventListener('input', updateStyles);
bgAlphaRange.addEventListener('input', updateStyles);
textAlphaRange.addEventListener('input', updateStyles);
fontSizeRange.addEventListener('input', updateStyles);
speedRange.addEventListener('input', () => {
  animationSpeed = parseFloat(speedRange.value);
  document.getElementById('speed-value').textContent = animationSpeed.toFixed(1) + 'x';
});

// Check if mobile
function isMobile() {
  return window.innerWidth <= 768;
}

settingsButton.addEventListener('click', () => {
  const settingsPanel = document.getElementById('settings-panel');
  
  if (isMobile()) {
    // Mobile: Toggle bottom sheet with animation
    if (settingsPanel.classList.contains('show')) {
      settingsPanel.classList.remove('show');
      setTimeout(() => {
        settingsPanel.style.display = 'none';
      }, 300);
    } else {
      settingsPanel.style.display = 'block';
      requestAnimationFrame(() => {
        settingsPanel.classList.add('show');
      });
    }
  } else {
    // Desktop: Regular toggle
    settingsPanel.style.display = settingsPanel.style.display === 'block' ? 'none' : 'block';
  }
});

// Close settings panel when clicking outside
document.addEventListener('click', (event) => {
  const settingsPanel = document.getElementById('settings-panel');
  const isClickInsideSettings = settingsPanel.contains(event.target);
  const isClickOnButton = settingsButton.contains(event.target);
  
  const isOpen = isMobile() ? settingsPanel.classList.contains('show') : settingsPanel.style.display === 'block';
  
  if (!isClickInsideSettings && !isClickOnButton && isOpen) {
    if (isMobile()) {
      settingsPanel.classList.remove('show');
      setTimeout(() => {
        settingsPanel.style.display = 'none';
      }, 300);
    } else {
      settingsPanel.style.display = 'none';
    }
  }
});

function draw() {
  // Add background color with fading effect
  const backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim();
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Set text color
  const fontColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim();
  ctx.fillStyle = fontColor;
  ctx.font = fontSize + 'px monospace';

  // Loop through each column and render a character at its position
  for (let i = 0; i < drops.length; i++) {
    const text = charArray[Math.floor(Math.random() * charArray.length)];
    ctx.fillText(text, i * fontSize, drops[i] * fontSize);

    // Check if the character has reached the bottom of the canvas or if a random number condition is met
    if (drops[i] * fontSize > canvas.height || Math.random() > 0.975) {
      drops[i] = 0;
    }
    // Increment the position of the character in the column
    drops[i]++;
  }
}

// Animation loop using requestAnimationFrame with speed control
function animate(currentTime) {
  if (!lastTime) lastTime = currentTime;
  
  const deltaTime = currentTime - lastTime;
  const frameInterval = 1000 / (targetFPS * animationSpeed);
  
  if (deltaTime >= frameInterval) {
    draw();
    lastTime = currentTime - (deltaTime % frameInterval);
  }
  
  animationId = requestAnimationFrame(animate);
}

// Start animation
animate();

// Handle responsive layout changes
function handleResponsiveChange() {
  const settingsPanel = document.getElementById('settings-panel');
  
  // Reset panel state when switching between mobile/desktop
  settingsPanel.classList.remove('show');
  settingsPanel.style.display = 'none';
}

// Add resize event listeners
window.addEventListener('resize', () => {
  handleResize();
  handleResponsiveChange();
});

// Initialize displays
document.getElementById('font-size-value').textContent = fontSize + 'px';
document.getElementById('speed-value').textContent = animationSpeed.toFixed(1) + 'x';

// Cleanup function (useful if this becomes a module)
function cleanup() {
  cancelAnimationFrame(animationId);
  window.removeEventListener('resize', handleResize);
  bgColorPicker.removeEventListener('input', updateStyles);
  textColorPicker.removeEventListener('input', updateStyles);
  bgAlphaRange.removeEventListener('input', updateStyles);
  textAlphaRange.removeEventListener('input', updateStyles);
  fontSizeRange.removeEventListener('input', updateStyles);
  speedRange.removeEventListener('input', updateStyles);
}