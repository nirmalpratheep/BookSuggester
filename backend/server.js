const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables with explicit path
const result = dotenv.config({ path: path.join(__dirname, '.env') });
if (result.error) {
    console.error('Error loading .env file:', result.error);
    process.exit(1);
}

// Debug: Print environment variables
console.log('Environment variables loaded:', {
    MOCK_MODE: process.env.MOCK_MODE,
    HAS_GEMINI_KEY: !!process.env.GEMINI_API_KEY,
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT
});

const app = express();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-eval'", "'unsafe-inline'", "unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "unpkg.com"],
      imgSrc: ["'self'", "data:", "via.placeholder.com"],
      connectSrc: ["'self'", "localhost:4000"],
    },
  },
}));
app.use(cors({
  origin: ['http://localhost:4000', 'http://127.0.0.1:4000', 'null'],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json({ limit: '200kb' }));

const PORT = process.env.PORT || 4000;

// basic rate limiter
const limiter = rateLimit({ windowMs: 10 * 1000, // 10s
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please slow down.'
});
app.use('/api/', limiter);

const USE_MOCK = process.env.MOCK_MODE === 'true';

function sanitizeText(s){ if(!s) return s; return String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, ''); }

function buildPrompt(profile, maxPerCategory, excludeTitles, seed){
  // concise summary
  const p = {
    age: profile.age,
    gender: profile.gender,
    favorite_video_games: profile.favorite_video_games || [],
    favorite_board_games: profile.favorite_board_games || [],
    fiction_preference: profile.fiction_preference || 'both',
    movie_genres: profile.movie_genres || [],
    reading_level: profile.reading_level,
    interests: profile.interests || [],
    preferred_format: profile.preferred_format,
    minutes_per_week: profile.minutes_per_week,
    language: profile.language,
    accessibility_needs: profile.accessibility_needs || [],
    max_price: profile.max_price || null,
    favorite_authors: profile.favorite_authors || [],
    disliked_themes: profile.disliked_themes || [],
    surprise: !!profile.surprise
  };

  const system = `You are a book-suggestion engine specialized in providing age-appropriate recommendations for young readers.`;

  const instruction = `You are a book recommendation expert helping a young reader find their next favorite books. Using the profile below, suggest appropriate books that match their interests, reading level, and preferences. Format your response as JSON with this exact schema:

{
  "results": {
    "fiction": [{
      "title": "string",
      "author": "string",
      "year": number|null,
      "isbn": "string"|null,
      "cover_url": "string"|null,
      "short_description": "string (max 250 chars)",
      "age_range": "string (e.g. '8-12')",
      "why_recommended": "string (personalized explanation)",
      "tags": ["string"],
      "reading_time_minutes": number,
      "confidence": number (0-1)
    }],
    "nonfiction": [same schema as fiction]
  }
}

Profile: ${JSON.stringify(p, null, 2)}

Requirements:
- Suggest up to ${maxPerCategory} fiction and ${maxPerCategory} nonfiction books
- Exclude these titles: ${JSON.stringify(excludeTitles || [])}
- Use kid-friendly language and themes
- Ensure recommendations respect accessibility needs
- Give personalized 'why_recommended' reasons based on profile
- For unknown fields (ISBN, cover_url), use null
- Books should match reading level and age range

Respond with ONLY the JSON, no other text.`;

  return { system, instruction };
}

async function callGemini(prompt, profile){
  console.log('Calling Gemini with mock mode:', USE_MOCK);
  
  if(USE_MOCK){
    console.log('Using mock response');
    return mockLLMResponse(profile, prompt);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.error('GEMINI_API_KEY is missing or empty');
    throw new Error('GEMINI_API_KEY not set - check your .env file');
  }
  console.log('Using Gemini API with key:', apiKey.substring(0, 10) + '...');
  if(!apiKey) throw new Error('GEMINI_API_KEY not set');

  // Call Gemini 2.5 Flash
  const resp = await axios.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
    contents: [{
      role: 'user',
      parts: [{
        text: prompt.instruction
      }]
    }],
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 1024,
    },
    safetySettings: [{
      category: "HARM_CATEGORY_HARASSMENT",
      threshold: "BLOCK_MEDIUM_AND_ABOVE"
    }, {
      category: "HARM_CATEGORY_HATE_SPEECH",
      threshold: "BLOCK_MEDIUM_AND_ABOVE"
    }, {
      category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
      threshold: "BLOCK_MEDIUM_AND_ABOVE"
    }, {
      category: "HARM_CATEGORY_DANGEROUS_CONTENT",
      threshold: "BLOCK_MEDIUM_AND_ABOVE"
    }]
  }, {
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    }
  });

  if(!resp.data || !resp.data.candidates || !resp.data.candidates[0]) {
    throw new Error('Invalid response from Gemini');
  }

  try {
    console.log('Received Gemini response');
    const text = resp.data.candidates[0].content.parts[0].text;
    console.log('Gemini response text:', text.substring(0, 200) + '...');
    
    const json = JSON.parse(text);
    console.log('Parsed JSON successfully');
    
    // Add metadata
    json.metadata = {
      request_id: uuidv4(),
      model: 'gemini-pro',
      timestamp: new Date().toISOString()
    };

    return json;
  } catch(e) {
    throw new Error('Failed to parse Gemini response as JSON: ' + e.message);
  }
}

function mockLLMResponse(profile, prompt){
  // Create plausible results using profile
  const now = new Date().toISOString();
  const make = (title, tags, fiction=true)=> ({
    title,
    author: 'A. Writer',
    year: 2020,
    isbn: null,
    cover_url: null,
    short_description: `${title} is a fun ${fiction? 'story':'book'} about ${(profile.interests||[]).slice(0,2).join(' and ') || 'adventure'}.`.slice(0,250),
    age_range: `${Math.max(4, profile.age-2)}-${profile.age+3}`,
    why_recommended: `Matches interests: ${(profile.interests||[]).slice(0,3).join(', ') || 'general fun'}.`,
    tags,
    reading_time_minutes: Math.max(10, Math.round((profile.minutes_per_week||60)/5)),
    confidence: 0.85
  });

  const fiction = [];
  const nonfiction = [];
  for(let i=0;i<Math.min(5, (prompt.maxPerCategory||5)); i++){
    fiction.push(make(`Fun Story ${i+1}`, ['adventure','friendship'], true));
    nonfiction.push(make(`Real Facts ${i+1}`, ['science','learning'], false));
  }

  return {
    metadata: { request_id: uuidv4(), model: 'gemini-2.5-flash', timestamp: now },
    results: { fiction, nonfiction },
    warnings: [],
    excluded_titles: []
  };
}

function validateSchema(obj){
  if(!obj || !obj.metadata || !obj.results) return false;
  return true;
}

app.post('/api/recommend', async (req, res) => {
  try{
    console.log('Received recommendation request');
    const body = req.body;
    if(!body || !body.profile) return res.status(400).send('profile required');

    console.log('Profile received:', JSON.stringify(body.profile, null, 2));
    const profile = body.profile;
    // sanitize text fields
    for(const k of ['favorite_video_games','favorite_board_games','movie_genres','interests','accessibility_needs','favorite_authors','disliked_themes']){
      if(Array.isArray(profile[k])) profile[k] = profile[k].map(sanitizeText);
    }

    const exclude_titles = Array.isArray(body.exclude_titles)? body.exclude_titles.map(sanitizeText) : [];
    const maxPerCategory = Number(body.max_results_per_category) || 5;
    const seed = body.seed || null;

    const prompt = buildPrompt(profile, maxPerCategory, exclude_titles, seed);
    // pass maxPerCategory into prompt object for mocks
    prompt.maxPerCategory = maxPerCategory;

    const llmResp = await callGemini(prompt, profile);

    if(!validateSchema(llmResp)){
      return res.status(502).send('Model returned invalid schema');
    }

    return res.json(llmResp);
  }catch(err){
    console.error('recommend error', err);
    return res.status(500).send(String(err.message || err));
  }
});

// Serve frontend static files if available
app.use('/', express.static(path.join(__dirname, '..', 'frontend')));

app.listen(PORT, ()=>{ console.log(`Server running on http://localhost:${PORT} (USE_MOCK=${USE_MOCK})`); });
