# BookSuggester

Kid-friendly book suggestion app (frontend + backend). Frontend is a small React + Tailwind single-file demo. Backend is Node.js + Express that forwards profiles to Gemini (mock mode supported).

Quick start (development):

1. Backend

 - cd backend
 - npm install
 - copy `.env.example` to `.env` and set GEMINI_API_KEY if you want production mode
 - To run mock mode (recommended for local dev):
   - set USE_MOCK=true in `.env` (default in example)
   - npm run start

2. Frontend

 - open `frontend/index.html` in a browser (served by backend at http://localhost:4000 when backend runs)

Notes

- Store real Gemini API key in `.env` as GEMINI_API_KEY and set USE_MOCK=false. The server has a TODO where the real API call should be implemented.
- Backend endpoint: POST /api/recommend
  - Request body: { profile: {...}, exclude_titles: [...], max_results_per_category: 5, seed: <optional> }
  - Response: JSON following the strict schema described in the project spec. Mock mode returns realistic sample JSON.

Security

- API keys must be set in the server environment and never shipped to the frontend.
- Basic rate limiting is enabled on /api/ endpoints.

Testing

 - cd backend
 - npm test
# BookSuggester
Personalised Book Suggester using AI
