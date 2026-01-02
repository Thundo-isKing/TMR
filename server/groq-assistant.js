/**
 * Groq-based AI Assistant for TMR
 * Provides intelligent scheduling and task management using Groq API
 */

const Groq = require('groq-sdk');

class GroqAssistant {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('GROQ_API_KEY not found in environment variables');
    }
    this.client = new Groq({ apiKey });
    this.model = 'llama-3.3-70b-versatile'; // Updated to current supported Groq model
    this.conversationHistory = new Map(); // Store conversation context per user
  }

  /**
   * Get the current system prompt with up-to-date date/time
   */
  getSystemPrompt() {
    const now = new Date();
    
    // Generate next 31 days of dates in YYYY-MM-DD format
    const nextDays = [];
    for (let i = 0; i < 31; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      // Format as YYYY-MM-DD
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      nextDays.push(`${year}-${month}-${day}`);
    }
    
    const allDatesStr = nextDays.join(', ');
    
    return `You are Meibot, an AI scheduling assistant for TMR.

INSTRUCTIONS:
1. Help users create calendar events and tasks
2. When user asks for RECURRING events (multiple days), generate MULTIPLE JSON objects
3. Each JSON object must be on a separate line
4. **ALWAYS generate JSON when user asks to create or delete events/tasks - NEVER skip JSON generation**
5. Do NOT provide explanations about whether items are already deleted - just generate the JSON action

CRITICAL RULES:
- When user asks to create: ALWAYS generate createEvent or createTodo JSON
- When user asks to delete: ALWAYS generate deleteEvent or deleteTodo JSON
- For recurring delete requests: generate separate JSON for EACH occurrence
- Never refuse to generate JSON - always provide it even if uncertain

When suggesting to create an event, include JSON at end of response:
{"action": "createEvent", "title": "Event Title", "date": "YYYY-MM-DD", "time": "HH:MM"}
or
{"action": "createTodo", "text": "Task description", "reminder": "optional"}

When user asks to delete an event or task, ALWAYS include JSON at end of response:
{"action": "deleteEvent", "title": "Event Title"}
or
{"action": "deleteTodo", "text": "Task description"}

Example: If user says "delete all morning run events for the week", respond with:
Here are the morning run events I'll delete for you:
{"action": "deleteEvent", "title": "Morning Run"}
{"action": "deleteEvent", "title": "Morning Run"}
{"action": "deleteEvent", "title": "Morning Run"}
{"action": "deleteEvent", "title": "Morning Run"}
{"action": "deleteEvent", "title": "Morning Run"}

AVAILABLE DATES (next 31 days): ${allDatesStr}

EXAMPLE - User: "Morning run at 6am for 3 days"
Your response should END WITH these three separate lines:
{"action": "createEvent", "title": "Morning Run", "date": "${nextDays[0]}", "time": "06:00"}
{"action": "createEvent", "title": "Morning Run", "date": "${nextDays[1]}", "time": "06:00"}
{"action": "createEvent", "title": "Morning Run", "date": "${nextDays[2]}", "time": "06:00"}

Be helpful and conversational. Always generate multiple JSONs for recurring requests.`;
  }

  /**
   * Get or create conversation history for a user/session
   */
  getConversationHistory(userId = 'default') {
    if (!this.conversationHistory.has(userId)) {
      this.conversationHistory.set(userId, []);
    }
    return this.conversationHistory.get(userId);
  }

  /**
   * Send a message to Groq and get a response
   */
  async chat(userMessage, context = '', userId = 'default') {
    try {
      const history = this.getConversationHistory(userId);
      
      // Add context about existing events/todos if provided
      let enrichedMessage = userMessage;
      if (context) {
        enrichedMessage = `Current context:\n${context}\n\nUser message: ${userMessage}`;
      }

      // Add user message to history
      history.push({
        role: 'user',
        content: enrichedMessage
      });

      console.log('[Groq] Calling API with model:', this.model);
      console.log('[Groq] Message count:', history.length);
      
      // Call Groq API with fresh system prompt (updated on each call for current time)
      const systemPrompt = this.getSystemPrompt();
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          ...history.map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        ]
      });

      console.log('[Groq] API response received:', response.choices ? 'success' : 'no choices');
      
      const assistantMessage = response.choices[0].message.content;

      // Add assistant response to history
      history.push({
        role: 'assistant',
        content: assistantMessage
      });

      // Keep history manageable (last 20 messages)
      if (history.length > 22) {
        history.splice(1, 2); // Remove oldest user/assistant pair but keep system
      }

      // Parse ALL actions from response (support create/delete for events and todos)
      const actionMatches = assistantMessage.match(/\{"action":\s*"(create|delete)[^"]+\"[^}]*\}/g) || [];
      let suggestedAction = null;
      let actionData = null;
      let allActions = [];

      console.log('[Groq] Found action matches:', actionMatches.length);

      if (actionMatches.length > 0) {
        try {
          // Parse all actions
          for (const match of actionMatches) {
            try {
              const actionJson = JSON.parse(match);
              allActions.push({
                type: actionJson.action,
                data: {
                  title: actionJson.title,
                  date: actionJson.date,
                  time: actionJson.time,
                  text: actionJson.text,
                  reminder: actionJson.reminder
                }
              });
            } catch (parseErr) {
              console.warn('[Groq] Failed to parse individual action:', match, parseErr.message);
            }
          }
          
          console.log('[Groq] Successfully parsed', allActions.length, 'actions');
          
          // Set primary action (first one) for backward compatibility
          if (allActions.length > 0) {
            const firstAction = allActions[0];
            suggestedAction = firstAction.type;
            actionData = firstAction.data;
          }
        } catch (e) {
          console.debug('[Groq] Failed to parse action JSON:', actionMatches[0]);
        }
      }

      // Return response and any suggested actions
      return {
        reply: assistantMessage.replace(/\{"action":[^}]+\}/g, '').trim(),
        suggestedAction,
        actionData,
        allActions: allActions.length > 0 ? allActions : undefined
      };
    } catch (error) {
      console.error('[Groq] API Error:', error);
      console.error('[Groq] Error message:', error.message);
      throw error;
    }
  }

  /**
   * Clear conversation history for a user (start fresh)
   */
  clearHistory(userId = 'default') {
    this.conversationHistory.delete(userId);
  }
}

module.exports = GroqAssistant;
