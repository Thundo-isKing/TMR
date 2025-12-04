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
    // Use local date formatting for both date and time
    const todayStr = now.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
    
    return `You are a helpful scheduling and task management AI assistant called Meibot. 
Your primary responsibilities are:
1. Help users create, manage, and organize calendar events and to-do items
2. Parse natural language requests to extract event/task details (title, date, time)
3. Provide scheduling advice and help with time management
4. When a user wants to create an event or task, respond with structured JSON at the end of your response

When suggesting to create an event or task, include this JSON at the end of your response:
{"action": "createEvent", "title": "Event Title", "date": "YYYY-MM-DD", "time": "HH:MM"}
or
{"action": "createTodo", "text": "Task description", "reminder": "in 1 hour"}

For todos with reminders, include the "reminder" field with a natural language description of WHEN to remind:
- "in 30 minutes" → browser will set reminder 30 minutes from now
- "in 1 hour" → browser will set reminder 1 hour from now
- "in 2 hours" → browser will set reminder 2 hours from now
- "tomorrow at 9am" → browser will set reminder for tomorrow at 9am
- "at 3pm today" → browser will set reminder for 3pm today
- etc.

The browser will parse these descriptions and convert to Unix timestamps automatically.
IMPORTANT: Only include "reminder" field if the user explicitly asks for a reminder time.

Be conversational but concise. Ask clarifying questions if needed (date, time, priority, etc.).

CURRENT DATE/TIME: ${todayStr} (${dayOfWeek}) at ${timeStr}
Use this current date/time as a reference when the user mentions relative times like "tomorrow", "next week", "in 2 hours", etc.`;
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

      // Parse action from response if present
      const actionMatch = assistantMessage.match(/\{"action":\s*"(create[^"]+)"[^}]*\}/);
      let suggestedAction = null;
      let actionData = null;

      if (actionMatch) {
        try {
          const actionJson = JSON.parse(actionMatch[0]);
          suggestedAction = actionJson.action;
          actionData = {
            title: actionJson.title,
            date: actionJson.date,
            time: actionJson.time,
            text: actionJson.text,
            reminder: actionJson.reminder
          };
        } catch (e) {
          console.debug('[Groq] Failed to parse action JSON:', actionMatch[0]);
        }
      }

      // Return response and any suggested action
      return {
        reply: assistantMessage.replace(/\{"action":[^}]+\}/, '').trim(),
        suggestedAction,
        actionData
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
