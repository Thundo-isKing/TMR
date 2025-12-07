require('dotenv').config();
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, context, consent, timezone } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Invalid message' });
  }
  if (context && !consent) {
    return res.status(403).json({ error: 'Consent required for calendar context.' });
  }

  // Get current date/time in user's timezone (default to user's local if provided)
  const userTimezone = timezone || 'en-US';
  const now = new Date();
  const dateTimeStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: userTimezone
  }).format(now);

  const systemPrompt = `You are Meibot, a helpful assistant for scheduling and calendars.
Current date and time: ${dateTimeStr} (${userTimezone})

If the user wants to create a todo or event, respond with a clear confirmation and include an action in your message like this:
- For todos: "[ACTION: CREATE_TODO] Title: <task title> | Reminder: <reminder description like 'in 1 hour' or 'tomorrow at 9am'>"
- For events: "[ACTION: CREATE_EVENT] Title: <event name> | Date: <YYYY-MM-DD> | Time: <HH:MM> | Duration: <minutes>"

Always include the action tag with clear structured data so the client can parse and execute it.
For reminders, use natural language like "in 30 minutes", "in 2 hours", "tomorrow at 9am", "today at 3pm", etc.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    context && consent ? { role: 'system', content: `Calendar context: ${context}` } : null,
    { role: 'user', content: message }
  ].filter(Boolean);

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 600
      })
    });
    
    if (!r.ok) {
      console.error('Groq API error response:', r.status, await r.text());
      return res.status(500).json({ error: `Groq API error: ${r.status}` });
    }
    
    const data = await r.json();
    const aiText = data.choices?.[0]?.message?.content ?? 'Sorry, I could not generate a response.';
    
    // Parse action from response
    let actionType = null;
    let actionData = null;
    
    if (aiText.includes('[ACTION: CREATE_TODO]')) {
      actionType = 'createTodo';
      const match = aiText.match(/\[ACTION: CREATE_TODO\]\s*Title:\s*(.+?)(?:\||\n|$)/);
      const reminderMatch = aiText.match(/Reminder:\s*(.+?)(?:\n|$)/);
      if (match) {
        actionData = { 
          text: match[1].trim(),
          reminder: reminderMatch ? reminderMatch[1].trim() : undefined
        };
      }
    } else if (aiText.includes('[ACTION: CREATE_EVENT]')) {
      actionType = 'createEvent';
      const titleMatch = aiText.match(/Title:\s*(.+?)\s*\|/);
      const dateMatch = aiText.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);
      const timeMatch = aiText.match(/Time:\s*(\d{2}:\d{2})/);
      const durationMatch = aiText.match(/Duration:\s*(\d+)/);
      
      if (titleMatch && dateMatch) {
        actionData = {
          title: titleMatch[1].trim(),
          date: dateMatch[1],
          time: timeMatch ? timeMatch[1] : '09:00',
          duration: durationMatch ? parseInt(durationMatch[1]) : 60
        };
      }
    }
    
    res.json({ 
      reply: aiText,
      suggestedAction: actionType,
      actionData: actionData,
      meta: data 
    });
  } catch (err) {
    console.error('Meibot error', err.message);
    res.status(500).json({ error: 'AI provider error' });
  }
};
