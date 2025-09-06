# Copilot Instructions for BookSuggester

## Project Overview
- **BookSuggester** is a full-stack, kid-friendly book recommendation app.
- **Frontend:** Single-file React 17 app with Tailwind CSS, located at `frontend/index.html`. Uses Babel in-browser for JSX.
- **Backend:** Node.js + Express server in `backend/server.js`. Handles `/api/recommend` endpoint, integrates with Google Gemini LLM (mock and real modes).

## Architecture & Data Flow
- **Frontend** collects user profile data and POSTs to `/api/recommend`.
- **Backend** validates, sanitizes, and either mocks or forwards the request to Gemini LLM, then returns structured JSON results.
- **Environment variables** (in `backend/.env`) control mock/real mode and Gemini API key.
- **Static files** (frontend) are served by the backend for local development.

## Key Files & Directories
- `frontend/index.html`: Main React UI, all logic in one file. Uses localStorage for bookshelf.
- `backend/server.js`: Express server, API logic, Gemini integration, error handling, CORS, rate limiting.
- `backend/.env`: Configures `MOCK_MODE`, `GEMINI_API_KEY`, `PORT`.
- `README.md`: Quickstart, API contract, and security notes.

## Developer Workflows
- **Start backend:**
  - `cd backend && npm install && npm start`
- **Frontend dev:**
  - Open `frontend/index.html` directly or via backend at `http://localhost:4000`
- **Switch mock/real mode:**
  - Edit `MOCK_MODE` in `.env` (`true` for mock, `false` for Gemini)
- **Testing:**
  - `cd backend && npm test`

## Patterns & Conventions
- **API contract:** `/api/recommend` expects `{ profile, exclude_titles, max_results_per_category, seed }` in POST body.
- **Strict JSON schema:** Responses must match the schema described in the README and backend code.
- **Error handling:** All errors are logged and returned as JSON with `error` and `details` fields.
- **Security:** API keys are never exposed to frontend; rate limiting and helmet are enabled.
- **Frontend state:** Uses React hooks, localStorage for saved books, and in-memory state for suggestions.

## Integration Points
- **Gemini LLM:**
  - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`
  - API key: `GEMINI_API_KEY` in `.env`
  - Mock mode returns hardcoded sample data for local dev/testing.

## Examples
- See `backend/server.js` for Gemini integration and mock logic.
- See `frontend/index.html` for how the profile form and API call are structured.

---

For any unclear conventions or missing details, check `README.md` or ask for clarification from maintainers.
