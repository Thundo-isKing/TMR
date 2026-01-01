/**
 * Meibot Client - AI-powered scheduling assistant (Groq integration)
 */

(function() {
  // Get existing elements from TMR.html (both desktop and mobile)
  // Desktop panel (shown on desktop/landscape)
  const desktopChat = document.getElementById('meibot-chat');
  const desktopForm = document.getElementById('meibot-form');
  const desktopInput = document.getElementById('meibot-input');
  
  // Mobile modal (shown on mobile)
  const mobileModal = document.getElementById('meibot-modal');
  const mobileChat = document.getElementById('meibot-modal-chat');
  const mobileForm = document.getElementById('meibot-modal-form');
  const mobileInput = document.getElementById('meibot-modal-input');
  const mobileClose = document.getElementById('meibot-modal-close');
  const mobileBackdrop = mobileModal ? mobileModal.parentElement : null;

  // Check if we have necessary elements
  const hasDesktop = desktopChat && desktopForm && desktopInput;
  const hasMobile = mobileChat && mobileForm && mobileInput && mobileModal;
  
  if (!hasDesktop && !hasMobile) {
    console.error('[Meibot] No chat elements found in DOM');
    return;
  }

  // State
  let conversation = [];
  let lastSuggestedAction = null;
  let lastActionData = null;

  // Append message to chat (handle both desktop and mobile)
  function appendMessage(role, text, targetChat) {
    const chatEl = targetChat || desktopChat || mobileChat;
    if (!chatEl) return;
    
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

  // Create action button with styling
  function createActionButton(label, color, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.marginTop = '8px';
    btn.style.padding = '8px 12px';
    btn.style.background = color;
    btn.style.color = 'white';
    btn.style.border = 'none';
    btn.style.borderRadius = '6px';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '12px';
    btn.addEventListener('click', onClick);
    return btn;
  }

  // Handle form submission for both desktop and mobile
  async function handleFormSubmit(e, formEl, inputEl, chatEl) {
    e.preventDefault();
    const userMsg = inputEl.value.trim();
    if (!userMsg) return;

    appendMessage('user', userMsg, chatEl);
    inputEl.value = '';

    // Check if this is confirming a previous action
    if (isConfirmation(userMsg)) {
      if (lastSuggestedAction === 'createTodo' && lastActionData && window.meibotCreateTodo) {
        window.meibotCreateTodo(lastActionData.text, lastActionData.reminder);
        appendMessage('meibot', 'Task created! ≡ƒô¥', chatEl);
      } else if (lastSuggestedAction === 'createEvent' && lastActionData && window.meibotCreateEvent) {
        window.meibotCreateEvent(lastActionData);
        appendMessage('meibot', 'Event scheduled! ≡ƒôà', chatEl);
      }
      lastSuggestedAction = null;
      lastActionData = null;
      return;
    }

    // Send to server
    try {
      let contextStr = '';
      
      // Get or create device ID for chat history persistence
      let deviceId = localStorage.getItem('tmr_device_id');
      if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        localStorage.setItem('tmr_device_id', deviceId);
      }
      
      // Get user's timezone
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      
      // Use the same origin (works for both localhost and ngrok)
      const res = await fetch('/api/meibot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, context: contextStr, consent: false, timezone, deviceId })
      });

      const data = await res.json();

      if (data.error) {
        appendMessage('meibot', `Error: ${data.error}`, chatEl);
        return;
      }

      appendMessage('meibot', data.reply, chatEl);
      
      // Store suggested action for confirmation
      lastSuggestedAction = data.suggestedAction;
      lastActionData = data.actionData;

      // Handle actions
      if (data.allActions && data.allActions.length > 0) {
        if (data.allActions.length === 1) {
          const action = data.allActions[0];
          if (action.type === 'createTodo' && action.data) {
            const btn = createActionButton(
              `Γ£ô Create: "${action.data.text}"`,
              '#4caf50',
              () => {
                if (window.calendarAddTodo) {
                  window.calendarAddTodo(action.data.text, action.data.reminder);
                  appendMessage('meibot', 'Task created! ≡ƒô¥', chatEl);
                  btn.disabled = true;
                  lastSuggestedAction = null;
                  lastActionData = null;
                }
              }
            );
            chatEl.appendChild(btn);
          } else if (action.type === 'createEvent' && action.data) {
            const btn = createActionButton(
              `Γ£ô Schedule: "${action.data.title || 'Event'}"`,
              '#2196f3',
              () => {
                if (window.calendarAddOrUpdateEvent) {
                  const event = {
                    id: 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
                    title: action.data.title,
                    date: action.data.date,
                    time: action.data.time || '09:00',
                    duration: action.data.duration || 60,
                    notes: ''
                  };
                  window.calendarAddOrUpdateEvent(event);
                  appendMessage('meibot', 'Event scheduled! ≡ƒôà', chatEl);
                  btn.disabled = true;
                  lastSuggestedAction = null;
                  lastActionData = null;
                }
              }
            );
            chatEl.appendChild(btn);
          }
        } else {
          // Multiple actions - show "Create All" button
          const todosCount = data.allActions.filter(a => a.type === 'createTodo').length;
          const eventsCount = data.allActions.filter(a => a.type === 'createEvent').length;
          let label = 'Γ£ô Create All';
          if (todosCount > 0 && eventsCount > 0) {
            label += ` (${todosCount} todos, ${eventsCount} events)`;
          } else if (todosCount > 0) {
            label += ` (${todosCount} todos)`;
          } else if (eventsCount > 0) {
            label += ` (${eventsCount} events)`;
          }
          
          const btn = createActionButton(label, '#ff9800', () => {
            let created = 0;
            for (const action of data.allActions) {
              if (action.type === 'createTodo' && action.data && window.calendarAddTodo) {
                window.calendarAddTodo(action.data.text, action.data.reminder);
                created++;
              } else if (action.type === 'createEvent' && action.data && window.calendarAddOrUpdateEvent) {
                const event = {
                  id: 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
                  title: action.data.title,
                  date: action.data.date,
                  time: action.data.time || '09:00',
                  duration: action.data.duration || 60,
                  notes: ''
                };
                window.calendarAddOrUpdateEvent(event);
                created++;
              }
            }
            appendMessage('meibot', `All done! Created ${created} items. Γ£à`, chatEl);
            btn.disabled = true;
            lastSuggestedAction = null;
            lastActionData = null;
          });
          chatEl.appendChild(btn);
        }
        chatEl.scrollTop = chatEl.scrollHeight;
      }
    } catch (err) {
      console.error('[Meibot] Error:', err);
      appendMessage('meibot', 'Connection error. Please try again.', chatEl);
    }
  }

  // Attach form handlers
  if (desktopForm && desktopInput && desktopChat) {
    desktopForm.addEventListener('submit', (e) => handleFormSubmit(e, desktopForm, desktopInput, desktopChat));
  }
  
  if (mobileForm && mobileInput && mobileChat) {
    mobileForm.addEventListener('submit', (e) => handleFormSubmit(e, mobileForm, mobileInput, mobileChat));
  }

  // Note: Close button is handled by switchTab() in TMR.html
  // Do not add click handlers here as it will conflict with the tab system


  // ========== MEIBOT EVENT/TODO CREATORS ==========
  
  window.meibotCreateEvent = function(actionData) {
    if (!actionData || !actionData.title || !actionData.date) {
      console.error('[Meibot] Invalid event data:', actionData);
      return;
    }
    
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
    if (!todoText || typeof todoText !== 'string') {
      console.error('[Meibot] Invalid todo text:', todoText);
      return;
    }

    if (window.calendarAddTodo) {
      window.calendarAddTodo(todoText, reminderDescription);
      console.log('[Meibot] Todo created:', todoText, 'with reminder:', reminderDescription);
    } else {
      console.error('[Meibot] calendarAddTodo not found');
    }
  };

  // ========== MEIBOT NOTE TASK EXTRACTION ==========
  
  window.meibotExtractTasks = function(content) {
    /**
     * Extract checkboxes and actionable items from note content
     * Returns array of task objects with text and confidence
     */
    const tasks = [];
    
    // Pattern 1: Checkbox items (☐ or ☑)
    const checkboxPattern = /[☐☑]\s+(.+?)(?:\n|$)/g;
    let match;
    while ((match = checkboxPattern.exec(content)) !== null) {
      tasks.push({
        text: match[1].trim(),
        type: 'checkbox',
        confidence: 0.95
      });
    }
    
    // Pattern 2: Text surrounded by asterisks or brackets (might be important)
    const importantPattern = /\*\*(.+?)\*\*|\[(.+?)\]/g;
    while ((match = importantPattern.exec(content)) !== null) {
      const text = (match[1] || match[2]).trim();
      if (text.length > 5 && !tasks.some(t => t.text === text)) {
        tasks.push({
          text: text,
          type: 'important',
          confidence: 0.6
        });
      }
    }
    
    // Pattern 3: Lines starting with common action words
    const actionWords = ['need', 'must', 'should', 'call', 'email', 'buy', 'schedule', 'book', 'finish', 'complete', 'review'];
    const lines = content.split('\n');
    lines.forEach(line => {
      const trimmed = line.trim().toLowerCase();
      for (const word of actionWords) {
        if (trimmed.startsWith(word) && !tasks.some(t => t.text === line.trim())) {
          tasks.push({
            text: line.trim(),
            type: 'action',
            confidence: 0.7
          });
          break;
        }
      }
    });
    
    return tasks;
  };

  window.meibotProposeTasks = function(tasks, callback) {
    /**
     * Present a proposal to user about extracting tasks to todo list
     * Shows summary of how tasks will be formatted
     */
    if (!tasks || tasks.length === 0) {
      if (callback) callback({ success: false, reason: 'No tasks found' });
      return;
    }
    
    const summary = tasks.map((t, i) => {
      return `${i + 1}. "${t.text}" (${t.type})`;
    }).join('\n');
    
    const proposal = {
      count: tasks.length,
      summary: summary,
      tasks: tasks.filter(t => t.confidence >= 0.9) // Only highest confidence for initial proposal
    };
    
    console.log('[Meibot] Task proposal:', proposal);
    if (callback) callback(proposal);
    return proposal;
  };

  window.meibotAnalyzeNoteInsights = function(content, callback) {
    /**
     * Provide AI insights about note themes, tone, and recommendations
     */
    const insights = {
      wordCount: content.split(/\s+/).length,
      sentenceCount: content.split(/[.!?]+/).length,
      themes: extractThemes(content),
      sentiment: analyzeSentiment(content),
      recommendations: generateRecommendations(content)
    };
    
    console.log('[Meibot] Note insights:', insights);
    if (callback) callback(insights);
    return insights;
  };

  function extractThemes(content) {
    /**
     * Extract key themes/topics from content
     */
    const themes = {};
    const commonWords = ['team', 'project', 'goal', 'deadline', 'meeting', 'review', 'planning', 'design', 'development', 'testing'];
    
    commonWords.forEach(word => {
      const regex = new RegExp(word, 'gi');
      const matches = content.match(regex);
      if (matches) {
        themes[word] = matches.length;
      }
    });
    
    return Object.entries(themes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word, count]) => ({ word, count }));
  }

  function analyzeSentiment(content) {
    /**
     * Simple sentiment analysis (positive/neutral/negative)
     */
    const positive = /\b(good|great|excellent|perfect|awesome|happy|excited|love)\b/gi;
    const negative = /\b(bad|terrible|awful|hate|frustrated|angry|disappointed)\b/gi;
    
    const positiveCount = (content.match(positive) || []).length;
    const negativeCount = (content.match(negative) || []).length;
    
    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  function generateRecommendations(content) {
    /**
     * Generate actionable recommendations based on content
     */
    const recs = [];
    
    if (/☐/.test(content)) {
      recs.push('You have unchecked items - consider adding these to your todo list');
    }
    if (content.length > 2000) {
      recs.push('This is a long note - you might want to break it into sections');
    }
    if (/deadline|urgent|asap|today|tomorrow/i.test(content)) {
      recs.push('This note mentions time-sensitive items - set reminders');
    }
    if (/\*\*.*?\*\*/.test(content)) {
      recs.push('Important items are highlighted - make sure they\'re tracked');
    }
    
    return recs;
  }

  // Note: Meibot button click is now handled by switchTab() in TMR.html
  // Removing duplicate handler to prevent conflicts with the tab system

  // Show initial greeting message
  if (hasDesktop && desktopChat && desktopChat.children.length === 0) {
    appendMessage('meibot', "Hi! I'm Meibot, your scheduling assistant. I can help you create tasks, schedule events, and manage your calendar. What can I do for you?", desktopChat);
  }
  if (hasMobile && mobileChat && mobileChat.children.length === 0) {
    appendMessage('meibot', "Hi! I'm Meibot, your scheduling assistant. I can help you create tasks, schedule events, and manage your calendar. What can I do for you?", mobileChat);
  }

  console.log('[Meibot] Initialized - Desktop:', hasDesktop ? 'Γ£ô' : 'Γ£ù', 'Mobile:', hasMobile ? 'Γ£ô' : 'Γ£ù');
})();
