const settingsBtn = document.getElementById('settingsBtn');
const settingsDropdown = document.getElementById('settingsDropdown');
const llmRadios = document.querySelectorAll('input[name="llmChoice"]');

// Chat elements
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('message-input');
const chatContainer = document.getElementById('chat-container');

// Function to send the new setting to the server
async function updateLLMSettings(model) {
    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: model }),
        });
        const result = await response.json();
        console.log(result.message);
    } catch (error) {
        console.error('Error updating settings:', error);
    }
}

// Function to get the current setting from the server and update the UI
async function getLLMSettings() {
    try {
        const response = await fetch('/api/settings');
        const result = await response.json();
        const currentModel = result.model;
        document.querySelector(`input[value="${currentModel}"]`).checked = true;
    } catch (error) {
        console.error('Error fetching settings:', error);
    }
}

// Event listener for the settings button
settingsBtn.addEventListener('click', () => {
    settingsDropdown.classList.toggle('show');
});

// Event listener for the radio buttons
llmRadios.forEach(radio => {
    radio.addEventListener('change', (event) => {
        updateLLMSettings(event.target.value);
    });
});

// Load settings on page load
document.addEventListener('DOMContentLoaded', getLLMSettings);

// Function to create and append a message element to the chatbox
function appendMessage(sender, message) {
    const messageElement = document.createElement('div');
    messageElement.classList.add(sender === 'user' ? 'user-message' : 'bot-reply');
    messageElement.innerHTML = message;
    chatContainer.prepend(messageElement); // Use prepend to add new messages to the top
}

// Function to handle the chat form submission
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault(); // Prevent the form from refreshing the page
    const userMessage = chatInput.value.trim();

    if (!userMessage) return;

    // Add the user's message to the chatbox
    appendMessage('user', userMessage);
    chatInput.value = ''; 

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage }),
        });

        const data = await response.json();

        if (response.ok) {
            appendMessage('bot', data.reply);
        } else {
            appendMessage('bot', `Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error:', error);
        appendMessage('bot', 'Sorry, I am unable to connect to the server.');
    }
});