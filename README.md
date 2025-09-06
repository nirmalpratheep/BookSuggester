# 📚 BookSuggester – Flask + Frontend

This project is a **kid-friendly book recommendation app**.  
It has:

- A **Flask backend** (`app.py`) that calls Google’s **Gemini API** (or uses mock responses).
- A **frontend (`templates/index.html`)** form where kids/parents can enter details (age, gender, interests, games, characters, etc.).
- Recommendations displayed live in the browser.

---

## 🚀 Features
- Flask backend with CORS enabled
- Mock mode for development (no Gemini API needed)
- Real mode with Google Gemini API
- Clean JSON response with fiction + nonfiction categories
- Frontend form with:
  - Age, gender, reading level
  - Favorite games, characters (e.g. *Harry Potter*, *Avengers*)
  - Movie genres, hobbies, accessibility needs
- Start Over button to reset the form

---

## ⚙️ Setup

### 1. Clone & Install
```bash
git clone <your-repo-url>
cd <repo-folder>
pip install -r requirements.txt
```

###2.env
# Mock responses (true/false)
MOCK_MODE=true

# Gemini API key (needed only if MOCK_MODE=false)
GEMINI_API_KEY=your_api_key_here

# Server port
PORT=5000
