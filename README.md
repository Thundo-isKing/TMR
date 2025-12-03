# Meibot AI Integration

## Setup
1. Copy `.env.example` to `.env` and paste your OpenAI API key.
2. Install dependencies:
   ```powershell
   npm install express dotenv node-fetch express-rate-limit cors
   ```
3. Run the backend:
   ```powershell
   node server.js
   ```
4. Frontend will POST to `http://localhost:3001/api/meibot` with `{ message, context, consent }`.

## Security
- Never commit your real `.env` file.
- API key is only used server-side.

## Example curl
```
curl -X POST http://localhost:3001/api/meibot -H "Content-Type: application/json" -d '{"message":"What events do I have today?","context":"Meeting at 2pm, Doctor at 4pm","consent":true}'
```
