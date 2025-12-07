/**
 * Meibot Client - AI-powered scheduling assistant (OpenAI integration)
 */

(function() {
  // Create Meibot modal
  const modal = document.createElement('div');
  modal.id = 'meibot-modal';
  modal.className = 'meibot-modal hidden';
  modal.innerHTML = `
    <div class="meibot-modal-content">
      <div class="meibot-header">
        <h2>Meibot - AI Assistant</h2>
        <button id="meibot-close" class="meibot-close" aria-label="Close">&times;</button>
      </div>
      <div id="meibot-chat" class="meibot-chat"></div>
      <div id="meibot-typing" class="meibot-typing hidden">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
      <form id="meibot-form" class="meibot-form">
        <input id="meibot-input" type="text" placeholder="Ask me anything..." />
        <label class="meibot-consent">
          <input id="meibot-consent" type="checkbox" /> Share context
        </label>
        <button type="submit" class="meibot-send">Send</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  // Style the modal
  const style = document.createElement('style');
  style.textContent = `
    .meibot-modal {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 400px;
      height: 600px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      display: flex;
      flex-direction: column;
      z-index: 10000;
      font-family: inherit;
    }
    .meibot-modal.hidden {
      display: none;
    }
    .meibot-modal-content {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .meibot-header {
      padding: 16px;
      border-bottom: 1px solid #e0e0e0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: linear-gradient(135deg, var(--accent-color, #0089f1), var(--accent-hover, #0073d1));
      color: white;
      border-radius: 12px 12px 0 0;
    }
    .meibot-header h2 {
      margin: 0;
      font-size: 18px;
    }
    .meibot-close {
      background: none;
      border: none;
      color: white;
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .meibot-close:hover {
      opacity: 0.8;
    }
    .meibot-chat {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .meibot-message {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
    }
    .meibot-message.user {
      justify-content: flex-end;
    }
    .meibot-message-text {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 8px;
      word-wrap: break-word;
    }
    .meibot-message.user .meibot-message-text {
      background: var(--accent-color, #0089f1);
      color: white;
      border-radius: 8px 0 8px 8px;
    }
    .meibot-message.meibot .meibot-message-text {
      background: #f0f0f0;
      color: #333;
      border-radius: 0 8px 8px 8px;
    }
    .meibot-typing {
      display: flex;
      gap: 4px;
      padding: 12px 16px;
      justify-content: flex-start;
    }
    .meibot-typing.hidden {
      display: none;
    }
    .typing-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-color, #0089f1);
      animation: typing 1.4s infinite;
    }
    .typing-dot:nth-child(2) {
      animation-delay: 0.2s;
    }
    .typing-dot:nth-child(3) {
      animation-delay: 0.4s;
    }
    @keyframes typing {
      0%, 60%, 100% { opacity: 0.3; }
      30% { opacity: 1; }
    }
    .meibot-form {
      padding: 12px;
      border-top: 1px solid #e0e0e0;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .meibot-form input[type="text"] {
      flex: 1;
      min-width: 200px;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 14px;
    }
    .meibot-form input[type="text"]:focus {
      outline: none;
      border-color: var(--accent-color, #0089f1);
      box-shadow: 0 0 4px rgba(0,137,241,0.3);
    }
    .meibot-consent {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #666;
      white-space: nowrap;
    }
    .meibot-send {
      padding: 10px 16px;
      background: var(--accent-color, #0089f1);
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
    }
    .meibot-send:hover {
      background: var(--accent-hover, #0073d1);
    }
    @media (max-width: 600px) {
      .meibot-modal {
        width: 90%;
        height: 70vh;
        bottom: 10px;
        right: 10px;
        left: 10px;
      }
    }
  `;
  document.head.appendChild(style);

  // Get DOM elements
  const chatEl = document.getElementById('meibot-chat');
  const typingEl = document.getElementById('meibot-typing');
  const formEl = document.getElementById('meibot-form');
  const inputEl = document.getElementById('meibot-input');
  const consentEl = document.getElementById('meibot-consent');
  const closeBtn = document.getElementById('meibot-close');

  // State
  let conversation = [];
  let lastSuggestedAction = null;
  let lastActionData = null;

  // Append message to chat
  function appendMessage(role, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `meibot-message ${role}`;
    const textDiv = document.createElement('div');
    textDiv.className = 'meibot-message-text';
    textDiv.textContent = text;
    msgDiv.appendChild(textDiv);
    chatEl.appendChild(msgDiv);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  // Gather context from page
  function gatherContext() {
    const context = {};
    try {
      const events = JSON.parse(localStorage.getItem('tmr_events') || '[]');
      const todos = JSON.parse(localStorage.getItem('tmr_todos') || '[]');
      context.events = events;
      context.todos = todos;
    } catch (e) {
      context.events = [];
      context.todos = [];
    }
    return context;
  }

  // Check if message is confirming a previous action
  function isConfirmation(message) {
    const confirmPatterns = /\b(yes|yeah|yep|correct|right|looks good|ok|okay|sure|go ahead|schedule|create|confirm|sounds good|perfect|good|exact|all correct|all good)\b/i;
    return confirmPatterns.test(message) && lastSuggestedAction && lastActionData;
  }

  // Handle form submission
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userMsg = inputEl.value.trim();
    if (!userMsg) return;

    appendMessage('user', userMsg);
    inputEl.value = '';
    typingEl.classList.remove('hidden');

    // Check if this is confirming a previous action
    if (isConfirmation(userMsg)) {
      typingEl.classList.add('hidden');
      if (lastSuggestedAction === 'createTodo' && lastActionData && window.meibotCreateTodo) {
        window.meibotCreateTodo(lastActionData.text, lastActionData.reminder);
        appendMessage('meibot', 'Task created! 📝');
      } else if (lastSuggestedAction === 'createEvent' && lastActionData && window.meibotCreateEvent) {
        window.meibotCreateEvent(lastActionData);
        appendMessage('meibot', 'Event scheduled! 📅');
      }
      lastSuggestedAction = null;
      lastActionData = null;
      return;
    }

    // Send to server
    try {
      const consent = consentEl.checked;
      const contextStr = consent ? JSON.stringify(gatherContext()) : '';
      
      // Get user's timezone
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      
      // Use the same origin (works for both localhost and ngrok)
      const res = await fetch('/api/meibot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, context: contextStr, consent, timezone })
      });

      const data = await res.json();
      typingEl.classList.add('hidden');

      if (data.error) {
        appendMessage('meibot', `Error: ${data.error}`);
        return;
      }

      appendMessage('meibot', data.reply);
      
      // Store suggested action for confirmation
      lastSuggestedAction = data.suggestedAction;
      lastActionData = data.actionData;

      // Show action button if available
      if (data.suggestedAction === 'createTodo' && data.actionData) {
        const btn = document.createElement('button');
        btn.textContent = `✓ Create: "${data.actionData.text}"`;
        btn.style.marginTop = '8px';
        btn.style.padding = '8px 12px';
        btn.style.background = '#4caf50';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.borderRadius = '6px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '12px';
        btn.addEventListener('click', () => {
          if (window.calendarAddTodo) {
            window.calendarAddTodo(data.actionData.text, data.actionData.reminder);
            appendMessage('meibot', 'Task created! 📝');
            btn.disabled = true;
            lastSuggestedAction = null;
            lastActionData = null;
          }
        });
        chatEl.appendChild(btn);
        chatEl.scrollTop = chatEl.scrollHeight;
      } else if (data.suggestedAction === 'createEvent' && data.actionData) {
        const btn = document.createElement('button');
        btn.textContent = `✓ Schedule: "${data.actionData.title || 'Event'}"`;
        btn.style.marginTop = '8px';
        btn.style.padding = '8px 12px';
        btn.style.background = '#2196f3';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.borderRadius = '6px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '12px';
        btn.addEventListener('click', () => {
          if (window.calendarAddOrUpdateEvent) {
            // Create event object with calendar format (date: YYYY-MM-DD, time: HH:MM)
            const event = {
              id: 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
              title: data.actionData.title,
              date: data.actionData.date,
              time: data.actionData.time || '09:00',
              duration: data.actionData.duration || 60,
              notes: ''
            };
            
            window.calendarAddOrUpdateEvent(event);
            appendMessage('meibot', 'Event scheduled! 📅');
            btn.disabled = true;
            lastSuggestedAction = null;
            lastActionData = null;
          }
        });
        chatEl.appendChild(btn);
        chatEl.scrollTop = chatEl.scrollHeight;
      }
    } catch (err) {
      typingEl.classList.add('hidden');
      console.error('[Meibot] Error:', err);
      appendMessage('meibot', 'Connection error. Please try again.');
    }
  });

  // Close button
  closeBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  // ========== MEIBOT EVENT/TODO CREATORS ==========
  // These functions are called when Meibot suggests creating an event or todo
  
  window.meibotCreateEvent = function(actionData) {
    // actionData: { title, date (YYYY-MM-DD), time (HH:MM), text? }
    if (!actionData || !actionData.title || !actionData.date) {
      console.error('[Meibot] Invalid event data:', actionData);
      return;
    }
    
    // Call calendar.js's addOrUpdateEvent through the exposed window function
    if (window.calendarAddOrUpdateEvent) {
      const event = {
        id: 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        title: actionData.title,
        date: actionData.date,
        time: actionData.time || '09:00',
        notes: actionData.text || ''
      };
      window.calendarAddOrUpdateEvent(event);
      console.log('[Meibot] Event created:', event);
    } else {
      console.error('[Meibot] calendarAddOrUpdateEvent not found');
    }
  };

  window.meibotCreateTodo = function(todoText, reminderDescription) {
    // todoText: string description of the todo
    // reminderDescription: optional string like "in 1 hour" or "tomorrow at 9am"
    if (!todoText || typeof todoText !== 'string') {
      console.error('[Meibot] Invalid todo text:', todoText);
      return;
    }

    // Call calendar.js's todo creation through the exposed window function
    if (window.calendarAddTodo) {
      window.calendarAddTodo(todoText, reminderDescription);
      console.log('[Meibot] Todo created:', todoText, 'with reminder:', reminderDescription);
    } else {
      console.error('[Meibot] calendarAddTodo not found');
    }
  };

  // Toggle modal from button
  const toggleBtn = document.querySelector('.schedule-button');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      modal.classList.toggle('hidden');
      if (!modal.classList.contains('hidden') && conversation.length === 0) {
        appendMessage('meibot', 'Hi! 👋 I\'m Meibot, your AI scheduling assistant. How can I help you organize your day?');
      }
    });
  }
})();
