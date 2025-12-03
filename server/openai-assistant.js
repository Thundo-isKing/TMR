/**
 * OpenAI-based AI Assistant for TMR
 * Provides intelligent scheduling and task management using ChatGPT
 */

const OpenAI = require('openai');

class OpenAIAssistant {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not found in environment variables');
    }
    this.client = new OpenAI({ apiKey });
    this.model = 'gpt-4o-mini'; // You can switch to 'gpt-4' if needed
    this.conversationHistory = new Map(); // Store conversation context per user
  }

  /**
   * Get or create conversation history for a user/session
   */
  getConversationHistory(userId = 'default') {
    if (!this.conversationHistory.has(userId)) {
      this.conversationHistory.set(userId, [
        {
          role: 'system',
          content: `You are a helpful scheduling and task management AI assistant called Meibot. 
Your primary responsibilities are:
1. Help users create, manage, and organize calendar events and to-do items
2. Parse natural language requests to extract event/task details (title, date, time)
3. Provide scheduling advice and help with time management
4. When a user wants to create an event or task, respond with structured JSON at the end of your response

When suggesting to create an event or task, include this JSON at the end of your response:
{"action": "createEvent", "title": "Event Title", "date": "YYYY-MM-DD", "time": "HH:MM"}
or
{"action": "createTodo", "text": "Task description"}

Be conversational but concise. Ask clarifying questions if needed (date, time, priority, etc.).
Today's date is ${new Date().toISOString().split('T')[0]}.`
        }
      ]);
    }
    return this.conversationHistory.get(userId);
  }

  /**
   * Send a message to OpenAI and get a response
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

      console.log('[OpenAI] Calling API with model:', this.model);
      console.log('[OpenAI] Message count:', history.length);
      
      // Call OpenAI API with proper format
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'system',
            content: history[0].content
          },
          ...history.slice(1).map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        ]
      });

      console.log('[OpenAI] API response received:', response.choices ? 'success' : 'no choices');
      
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
            text: actionJson.text
          };
        } catch (e) {
          console.debug('[OpenAI] Failed to parse action JSON:', actionMatch[0]);
        }
      }

      // Return response and any suggested action
      return {
        reply: assistantMessage.replace(/\{"action":[^}]+\}/, '').trim(),
        suggestedAction,
        actionData
      };
    } catch (error) {
      console.error('[OpenAI] API Error:', error.message);
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

module.exports = OpenAIAssistant;
