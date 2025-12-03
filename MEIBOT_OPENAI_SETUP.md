# OpenAI Meibot Setup Guide

## Overview
Meibot is now powered by OpenAI's GPT-4 API, providing intelligent conversation and scheduling assistance for your TMR application.

## Setup Steps

### 1. Get OpenAI API Key
1. Go to [OpenAI Platform](https://platform.openai.com/api/keys)
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy the API key (keep it safe!)

### 2. Add API Key to Environment
Edit `.env` file in the root directory:
```dotenv
OPENAI_API_KEY=sk_your_actual_key_here
```

Replace `sk_your_actual_key_here` with your actual API key from OpenAI.

### 3. Start the Server
```bash
cd server
npm install  # Already done if you just ran setup
node index.js
```

The server will start on port 3001 and log:
```
[Meibot] OpenAI assistant initialized
TMR push server listening on port 3001
```

### 4. Open the Application
Open your browser to `http://localhost:3001/TMR.html`

### 5. Test Meibot
Click the **"Meibot (AI Helper)"** button to open the chat interface:
- Try: "create an event for tomorrow at 2pm called Team Meeting"
- Try: "remind me to buy groceries in 30 minutes"
- Try: "schedule a call with John next Friday at 10am"
- Meibot will suggest creating events/todos, and you can confirm with "correct" or "yes"

## How It Works

### Client Side (`meibot.js`)
- Provides a chat modal interface
- Gathers context from your calendar and todos (if user consents)
- Sends messages to the server API
- Handles confirmation of suggested actions
- Can create events and todos directly via buttons

### Server Side (`server/openai-assistant.js`)
- Connects to OpenAI's API
- Maintains conversation history for context
- Extracts structured data (title, date, time) from responses
- Returns suggested actions to the client

### API Endpoint: `POST /api/meibot`
**Request:**
```json
{
  "message": "create an event tomorrow at 2pm",
  "context": "{...calendar/todo data...}",
  "consent": true,
  "userId": "user-id-optional"
}
```

**Response:**
```json
{
  "reply": "I'll schedule an event for tomorrow...",
  "suggestedAction": "createEvent",
  "actionData": {
    "title": "Event Title",
    "date": "2025-12-04",
    "time": "14:00"
  }
}
```

## Features

### Natural Language Understanding
- "tomorrow at 2pm" → understands dates/times
- "call with John" → extracts title
- "create an event" → recognizes intent

### Context Awareness
- Knows about your existing events and todos (if consent given)
- Can provide scheduling advice
- Remembers conversation history

### Action Suggestions
- Automatically detects when you want to create an event or todo
- Presents action buttons for quick confirmation
- Supports voice-like confirmations ("yes", "correct", "schedule it")

### Event/Todo Creation
- Can automatically create calendar events
- Can automatically create todo items
- Applies default reminder times to todos
- Posts reminders to the server for push notifications

## Customization

### Change AI Model
Edit `server/openai-assistant.js`, line 12:
```javascript
this.model = 'gpt-4';  // Change from gpt-4o-mini to gpt-4
```

Models available:
- `gpt-4o-mini` - Fast, budget-friendly (default)
- `gpt-4o` - More capable, slightly slower
- `gpt-4` - Most powerful, most expensive

### Adjust System Prompt
Edit `server/openai-assistant.js`, lines 19-30 to customize Meibot's personality and behavior.

### Change Modal Position/Style
Edit `meibot.js`, lines 54-116 to adjust the CSS styling.

## Troubleshooting

### "OpenAI assistant not initialized"
- Check that `OPENAI_API_KEY` is set in `.env`
- Restart the server: `node index.js`

### API errors (401, 429, etc)
- **401**: Invalid API key. Get a new one from platform.openai.com
- **429**: Rate limited. Wait a moment and try again
- **500+**: Server error. Check logs for details

### Events not appearing
- Ensure `calendar.js` is loaded on the page
- Check browser console (F12) for errors
- Verify event has both date and time

### Conversation context not working
- Check "Share context" checkbox in Meibot modal
- Verify browser localStorage has events/todos saved

## Cost Management

OpenAI charges per token used:
- gpt-4o-mini: ~$0.15 per 1M input tokens
- Regular usage (scheduling) is very cheap

Estimate: A few hundred scheduling conversations per month ~$0.50-$2

## Next Steps

1. Deploy to production with proper HTTPS
2. Store OPENAI_API_KEY in environment variables (not .env file)
3. Customize system prompt for your specific use case
4. Add user authentication to track per-user conversation history
5. Implement rate limiting to prevent abuse
