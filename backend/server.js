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
const PORT = process.env.PORT || 4000;
const USE_MOCK = process.env.MOCK_MODE === 'true';

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-eval'", "'unsafe-inline'", "cdn.jsdelivr.net", "unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "unpkg.com"],
            imgSrc: ["'self'", "data:", "via.placeholder.com"],
            connectSrc: ["'self'", "localhost:4000", "127.0.0.1:4000"],
        },
    },
}));

app.use(cors({
    origin: ['http://localhost:4000', 'http://127.0.0.1:4000', 'null'],
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json({ limit: '200kb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 10 * 1000, // 10s
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests, please slow down.'
});
app.use('/api/', limiter);

function sanitizeText(s) {
    if (!s) return s;
    return String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}

function buildPrompt(profile, maxPerCategory, excludeTitles, seed) {
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

    const system = `You are a book recommendation expert helping a young reader find their next favorite books.`;
    
    const instruction = `Using the profile below, suggest appropriate books that match their interests, reading level, and preferences. Format your response as JSON with this exact schema:

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
      "content_warnings": ["string"]|null
    }],
    "nonfiction": [same schema as fiction]
  }
}

Reader Profile:
${JSON.stringify(p, null, 2)}

Additional Requirements:
- Suggest up to ${maxPerCategory} books in each category
- Avoid these titles: ${JSON.stringify(excludeTitles)}
- Seed for variety: ${seed}
- Keep descriptions concise and kid-friendly
- Include content warnings for sensitive themes
- Balance educational value and entertainment
- Consider accessibility needs
- Respect budget constraints`;

    return { system, instruction };
}

async function callGemini(profile, maxPerCategory, excludeTitles, seed) {
    try {
        if (!process.env.GEMINI_API_KEY) {
            console.error('GEMINI_API_KEY is not set in environment variables');
            throw new Error('GEMINI_API_KEY is not configured');
        }

        const { system, instruction } = buildPrompt(profile, maxPerCategory, excludeTitles, seed);
        
        console.log('Calling Gemini API with API key:', process.env.GEMINI_API_KEY.substring(0, 5) + '...');
                const geminiApiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
        console.log('Gemini API URL:', geminiApiUrl);
        const headers = {
            'Content-Type': 'application/json',
            'x-goog-api-key': process.env.GEMINI_API_KEY
        };
        console.log('Gemini API Headers:', headers);

        const response = await axios.post(geminiApiUrl, {
            contents: [{
                role: 'user',
                parts: [{
                    text: instruction
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048,
                topP: 0.8,
                topK: 40
            },
            safetySettings: [
                {
                    category: 'HARM_CATEGORY_HARASSMENT',
                    threshold: 'BLOCK_MEDIUM_AND_ABOVE'
                },
                {
                    category: 'HARM_CATEGORY_HATE_SPEECH',
                    threshold: 'BLOCK_MEDIUM_AND_ABOVE'
                },
                {
                    category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                    threshold: 'BLOCK_MEDIUM_AND_ABOVE'
                },
                {
                    category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                    threshold: 'BLOCK_MEDIUM_AND_ABOVE'
                }
            ]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': process.env.GEMINI_API_KEY
            }
        });

        if (!response.data || !response.data.candidates || !response.data.candidates[0]) {
            throw new Error('Invalid response from Gemini API');
        }

        const content = response.data.candidates[0].content;
        if (!content || !content.parts || !content.parts[0] || !content.parts[0].text) {
            throw new Error('No text content in Gemini response');
        }

        const text = content.parts[0].text;
        let jsonStr = text;
        
        // Extract JSON if it's wrapped in markdown code blocks
        if (text.includes('```json')) {
            jsonStr = text.split('```json')[1].split('```')[0].trim();
        } else if (text.includes('```')) {
            jsonStr = text.split('```')[1].split('```')[0].trim();
        }

        try {
            return JSON.parse(jsonStr);
        } catch (parseError) {
            console.error('Failed to parse Gemini response as JSON:', parseError);
            console.log('Raw response:', text);
            throw new Error('Invalid JSON response from Gemini');
        }
    } catch (error) {
        console.error('Error calling Gemini API:', error);
        throw error;
    }
}

function mockLLMResponse(profile, maxPerCategory) {
    const fiction = [{
        title: "The Dragon's Secret",
        author: "Maria Swift",
        year: 2023,
        isbn: "978-1234567890",
        cover_url: "https://via.placeholder.com/200x300",
        short_description: "A young wizard discovers a friendly dragon hiding in the school library, leading to an adventure about friendship and courage.",
        age_range: "8-12",
        why_recommended: `Based on ${profile.name}'s interest in fantasy games and love of adventure stories.`,
        tags: ["fantasy", "friendship", "adventure", "dragons"],
        content_warnings: ["mild peril"]
    }];

    const nonfiction = [{
        title: "Amazing Science Experiments at Home",
        author: "Dr. Sarah Smart",
        year: 2024,
        isbn: "978-0987654321",
        cover_url: "https://via.placeholder.com/200x300",
        short_description: "A collection of safe and fun science experiments that can be done with everyday household items.",
        age_range: "7-13",
        why_recommended: `Perfect for ${profile.name}'s interest in science and hands-on activities.`,
        tags: ["science", "experiments", "education", "STEM"],
        content_warnings: null
    }];

    return {
        results: {
            fiction: fiction.slice(0, maxPerCategory),
            nonfiction: nonfiction.slice(0, maxPerCategory)
        }
    };
}

// Serve static files from the root directory
app.use(express.static(path.join(__dirname, '..')));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', mock_mode: USE_MOCK });
});

// Book recommendation endpoint
app.post('/api/recommend', async (req, res) => {
    console.log('Received recommendation request:', JSON.stringify(req.body, null, 2));

    try {
        const profile = req.body.profile || req.body;
        if (!profile || !profile.age || !profile.reading_level) {
            return res.status(400).json({
                error: 'Invalid request. Required fields: age, reading_level'
            });
        }

        // Sanitize text inputs
        Object.keys(profile).forEach(key => {
            if (typeof profile[key] === 'string') {
                profile[key] = sanitizeText(profile[key]);
            }
        });

        const maxPerCategory = Math.min(parseInt(req.query.max || '3'), 5);
        const excludeTitles = (req.query.exclude || '').split(',').filter(Boolean);
        const seed = req.query.seed || uuidv4();

        let result;
        if (USE_MOCK) {
            console.log('Using mock LLM response');
            result = mockLLMResponse(profile, maxPerCategory);
        } else {
            console.log('Calling Gemini API');
            result = await callGemini(profile, maxPerCategory, excludeTitles, seed);
        }

        res.json(result);
    } catch (error) {
        console.error('Error processing recommendation:', error);
        res.status(500).json({
            error: 'Failed to generate recommendations',
            details: error.message
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        details: err.message
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Mock mode: ${USE_MOCK}`);
});
