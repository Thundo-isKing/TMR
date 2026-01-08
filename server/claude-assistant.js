/**
 * Anthropic Claude-based AI Assistant for TMR
 * Provides intelligent scheduling and task management using Anthropic API
 */
const Anthropic = require('@anthropic-ai/sdk');

class ClaudeAssistant {
  constructor(apiKey, model) {
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not found in environment variables');
    }
    this.client = new Anthropic({ apiKey });
    this.model = model || process.env.CLAUDE_MODEL || 'claude-3-5-sonnet';
  }

  buildSystemPrompt(timezone) {
    const now = new Date();
    const dateTimeStr = new Intl.DateTimeFormat('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      timeZone: timezone || 'UTC'
    }).format(now);

    return `You are Meibot, an AI scheduling assistant for TMR.
Current date and time: ${dateTimeStr} (${timezone || 'UTC'})

If the user wants to create a todo or event, respond with a clear confirmation and include an action in your message like this:
- For todos: "[ACTION: CREATE_TODO] Title: <task title> | Reminder: <reminder description like 'in 1 hour' or 'tomorrow at 9am'>"
- For events: "[ACTION: CREATE_EVENT] Title: <event name> | Date: <today/tomorrow/tdy/tmr or YYYY-MM-DD> | Time: <HH:MM> | Duration: <minutes>"

Always include the action tag with clear structured data so the client can parse and execute it.`;
  }

  async chat(message, context, userId, timezone) {
    const system = this.buildSystemPrompt(timezone);
    const messages = [
      { role: 'user', content: [
        { type: 'text', text: system },
        context ? { type: 'text', text: `Calendar context: ${context}` } : null,
        { type: 'text', text: message }
      ].filter(Boolean) }
    ];

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 800,
        messages,
      });

      const text = Array.isArray(response.content) && response.content[0] && response.content[0].type === 'text'
        ? response.content[0].text
        : (response.content && response.content.toString()) || '';

      // Parse actions in the same way as other providers
      let suggestedAction = null;
      let actionData = null;

      if (text.includes('[ACTION: CREATE_TODO]')) {
        suggestedAction = 'createTodo';
        const match = text.match(/\[ACTION: CREATE_TODO\]\s*Title:\s*(.+?)(?:\||\n|$)/);
        const reminderMatch = text.match(/Reminder:\s*(.+?)(?:\n|$)/);
        if (match) {
          actionData = {
            text: match[1].trim(),
            reminder: reminderMatch ? reminderMatch[1].trim() : undefined
          };
        }
      } else if (text.includes('[ACTION: CREATE_EVENT]')) {
        suggestedAction = 'createEvent';
        const titleMatch = text.match(/Title:\s*(.+?)\s*\|/);
        const dateMatch = text.match(/Date:\s*(.+?)\s*\|/);
        const timeMatch = text.match(/Time:\s*(\d{2}:\d{2})/);
        const durationMatch = text.match(/Duration:\s*(\d+)/);
        if (titleMatch && dateMatch) {
          let dateStr = dateMatch[1].trim().toLowerCase();
          const nowForDate = new Date();
          let eventDate = new Date(nowForDate);
          if (dateStr === 'today' || dateStr === 'tdy') {
            // today
          } else if (dateStr === 'tomorrow' || dateStr === 'tmr') {
            eventDate.setDate(eventDate.getDate() + 1);
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            eventDate = new Date(dateStr + 'T00:00:00Z');
          } else {
            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) eventDate = parsed;
          }
          const finalDate = eventDate.toISOString().split('T')[0];
          actionData = {
            title: titleMatch[1].trim(),
            date: finalDate,
            time: timeMatch ? timeMatch[1] : '09:00',
            duration: durationMatch ? parseInt(durationMatch[1]) : 60
          };
        }
      }

      return {
        reply: text || 'No response',
        suggestedAction,
        actionData,
        provider: 'claude',
        model: this.model
      };
    } catch (error) {
      console.error('[Claude] API Error:', error && error.message);
      throw error;
    }
  }
}

module.exports = ClaudeAssistant;
