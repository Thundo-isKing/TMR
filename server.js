// Minimal Meibot AI backend proxy for Groq
require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors({ origin: 'http://localhost:3000' })); // Adjust origin to your deployed site
app.use(rateLimit({ windowMs: 60_000, max: 30 })); // 30 requests/min

app.post('/api/meibot', async (req, res) => {
  const { message, context, consent } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Invalid message' });
  if (context && !consent) return res.status(403).json({ error: 'Consent required for calendar context.' });

  const messages = [
    { role: 'system', content: 'You are Meibot, a helpful assistant for scheduling and calendars.' },
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
        model: 'mixtral-8x7b-32768',
        messages,
        max_tokens: 600
      })
    });
    const data = await r.json();
    const aiText = data.choices?.[0]?.message?.content ?? 'Sorry, I could not generate a response.';
    res.json({ reply: aiText, meta: data });
  } catch (err) {
    console.error('Meibot error', err);
    res.status(500).json({ error: 'AI provider error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Meibot backend running on port ${PORT}`));
