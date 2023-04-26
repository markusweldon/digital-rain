// Get the canvas element and its 2D context
const canvas = document.getElementById('matrixCanvas');
const ctx = canvas.getContext('2d');

// Set the canvas size to match the window size
canvas.height = window.innerHeight;
canvas.width = window.innerWidth;

// Get the font size from CSS variable and calculate the number of columns
const fontSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--font-size'));
const columns = canvas.width / fontSize;

// Define the characters that can fall and split them into an array
const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%^&*()_+-=[]{}|;':\",.<>/?";
const charArray = characters.split('');

// Create an array to keep track of the position of each column
const drops = [];
for (let i = 0; i < columns; i++) {
  drops[i] = 1;
}

// Define the function that renders the rain effect on the canvas
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

// Call the draw() function at a regular interval to create the rain effect on the canvas
setInterval(draw, 33);
