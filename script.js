// Get a reference to the canvas element and set up its context
const canvas = document.getElementById('matrixCanvas');
const ctx = canvas.getContext('2d');

// Set the canvas size to fill the window
canvas.height = window.innerHeight;
canvas.width = window.innerWidth;

// Set font size and determine the number of columns based on the canvas width
const fontSize = 10;
const columns = canvas.width / fontSize;

// Define the set of characters used for the Matrix rain effect
const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%^&*()_+-=[]{}|;':\",.<>/?";
const charArray = characters.split('');

// Initialize the drops array, representing the falling text
const drops = [];
for (let i = 0; i < columns; i++) {
  drops[i] = 1;
}

// The draw function updates the canvas with new characters for the Matrix rain effect
function draw() {
  // Set a semi-transparent black background to create a trail effect
  ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Set the text color and font
  ctx.fillStyle = '#0f0';
  ctx.font = fontSize + 'px monospace';

  // Loop through the drops array, updating each drop's position
  for (let i = 0; i < drops.length; i++) {
    // Randomly select a character from the character array
    const text = charArray[Math.floor(Math.random() * charArray.length)];

    // Draw the character at the drop's current position
    ctx.fillText(text, i * fontSize, drops[i] * fontSize);

    // Reset the drop's position if it reaches the bottom or randomly with a low probability
    if (drops[i] * fontSize > canvas.height || Math.random() > 0.975) {
      drops[i] = 0;
    }

    // Increment the drop's position for the next frame
    drops[i]++;
  }
}

// Call the draw function repeatedly at 33ms intervals (about 30 FPS)
setInterval(draw, 33);
