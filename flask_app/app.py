import os
import uuid
import json
import re
import requests
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

MOCK_MODE = os.getenv('MOCK_MODE', 'true').lower() == 'true'
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
PORT = int(os.getenv('PORT', 5000))


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/recommend', methods=['POST'])
def recommend():
    data = request.get_json(force=True)
    profile = data.get('profile', {})
    max_per_category = int(data.get('max_results_per_category', 5))
    exclude_titles = data.get('exclude_titles', [])
    seed = data.get('seed', str(uuid.uuid4()))

    if not profile.get('age') or not profile.get('reading_level'):
        return jsonify({'error': 'Invalid request. Required fields: age, reading_level'}), 400

    print(f"[DEBUG] MOCK_MODE={MOCK_MODE}")
    if MOCK_MODE:
        print("[DEBUG] Using mock response (MOCK_MODE=True).")
        result = mock_response(profile, max_per_category)
        result['source'] = 'mock'
        return jsonify(result)

    # If not MOCK_MODE, try Gemini; on failure, return mock (so frontend still sees suggestions)
    try:
        print("[DEBUG] Calling Gemini API.")
        result = call_gemini(profile, max_per_category, exclude_titles, seed)
        # ensure consistent shape
        result.setdefault('results', {'fiction': [], 'nonfiction': []})
        result['source'] = 'gemini'
        return jsonify(result)
    except Exception as e:
        # log the error, return mock fallback (200) so frontend still receives suggestions
        print(f"[ERROR] Gemini API call failed: {e}")
        fallback = mock_response(profile, max_per_category)
        fallback['source'] = 'fallback-mock'
        # include minimal error info for debugging by dev (not user-friendly)
        fallback['debug_error'] = str(e)
        return jsonify(fallback)


def build_prompt(profile, max_per_category, exclude_titles, seed):
    p = {k: v for k, v in profile.items() if v}
    instruction = (
        f"Suggest up to {max_per_category} fiction and nonfiction books for a kid with this profile:\n"
        f"{json.dumps(p, indent=2)}\n"
        "Return the results as a JSON object with 'fiction' and 'nonfiction' arrays. "
        "Each book should have: title, author, year, isbn, cover_url, short_description, "
        "age_range, why_recommended, tags, and content_warnings."
    )
    return instruction


def _extract_json_from_text(text: str):
    """
    Attempts several strategies to extract JSON from text:
    1. Strip fenced blocks (```json ... ``` or ``` ... ```)
    2. Try json.loads
    3. Regex search for the first {...} block and try to json.loads it
    Returns the parsed JSON (dict/list) or None if not found.
    """
    if not isinstance(text, str):
        return None

    # Strip common code fences
    if '```json' in text:
        parts = text.split('```json', 1)[1].split('```', 1)
        text_candidate = parts[0].strip()
    elif '```' in text:
        parts = text.split('```', 1)[1].split('```', 1)
        text_candidate = parts[0].strip()
    else:
        text_candidate = text.strip()

    # Try direct parse
    try:
        return json.loads(text_candidate)
    except Exception:
        pass

    # Fallback: find first JSON-looking {...} block
    m = re.search(r'(\{(?:.|\s)*\})', text_candidate)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass

    return None


def call_gemini(profile, max_per_category, exclude_titles, seed):
    if not GEMINI_API_KEY:
        raise Exception("GEMINI_API_KEY is not set in environment.")

    url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'
    headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
    }
    prompt = build_prompt(profile, max_per_category, exclude_titles, seed)
    payload = {
        'contents': [{
            'role': 'user',
            'parts': [{'text': prompt}]
        }],
        'generationConfig': {
            'temperature': 0.7,
            'maxOutputTokens': 2048,
            'topP': 0.8,
            'topK': 40
        },
        'safetySettings': [
            {'category': 'HARM_CATEGORY_HARASSMENT', 'threshold': 'BLOCK_MEDIUM_AND_ABOVE'},
            {'category': 'HARM_CATEGORY_HATE_SPEECH', 'threshold': 'BLOCK_MEDIUM_AND_ABOVE'},
            {'category': 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'threshold': 'BLOCK_MEDIUM_AND_ABOVE'},
            {'category': 'HARM_CATEGORY_DANGEROUS_CONTENT', 'threshold': 'BLOCK_MEDIUM_AND_ABOVE'}
        ]
    }
    print(payload)
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    if resp.status_code != 200:
        raise Exception(f"Gemini API error: {resp.status_code} {resp.text}")

    data = resp.json()
    # Defensive extraction of the text part
    text = None
    try:
        text = data['candidates'][0]['content']['parts'][0].get('text')
    except Exception:
        # Last resort: stringify entire response
        text = json.dumps(data)

    print("[DEBUG] Gemini raw text:", text[:1000])  # capped-length print

    parsed = _extract_json_from_text(text)
    if parsed is None:
        raise Exception(f"Failed to extract JSON from Gemini text. Raw: {text[:1000]}")

    # Flexible parsing: support both top-level and nested "results"
    fiction = []
    nonfiction = []
    if isinstance(parsed, dict):
        if 'results' in parsed:
            fiction = parsed['results'].get('fiction', [])
            nonfiction = parsed['results'].get('nonfiction', [])
        else:
            fiction = parsed.get('fiction', [])
            nonfiction = parsed.get('nonfiction', [])
    else:
        # If parsed is a list (unlikely), try to place into fiction
        if isinstance(parsed, list):
            fiction = parsed

    # Ensure lists
    fiction = fiction or []
    nonfiction = nonfiction or []

    return {
        'results': {
            'fiction': fiction,
            'nonfiction': nonfiction
        },
        'raw_text': text,
    }


@app.route('/api/test-gemini', methods=['GET'])
def test_gemini():
    """Quick debug endpoint: calls Gemini with a small fixed prompt and returns parsed results."""
    sample_profile = {'age': 8, 'reading_level': 'Beginner'}
    if MOCK_MODE:
        return jsonify({'warning': 'MOCK_MODE is true', 'result': mock_response(sample_profile, 1), 'source': 'mock'})

    try:
        res = call_gemini(sample_profile, max_per_category=1, exclude_titles=[], seed=str(uuid.uuid4()))
        return jsonify({'ok': True, 'result': res, 'source': 'gemini'})
    except Exception as e:
        print(f"[ERROR] test-gemini failed: {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


def mock_response(profile, max_per_category):
    fiction = [{
        'title': "The Dragon's Secret",
        'author': "Maria Swift",
        'year': 2023,
        'isbn': "978-1234567890",
        'cover_url': "https://via.placeholder.com/200x300",
        'short_description': "A young wizard discovers a friendly dragon hiding in the school library, leading to an adventure about friendship and courage.",
        'age_range': "8-12",
        'why_recommended': f"Based on interests.",
        'tags': ["fantasy", "friendship", "adventure", "dragons"],
        'content_warnings': ["mild peril"]
    }]
    nonfiction = [{
        'title': "Amazing Science Experiments at Home",
        'author': "Dr. Sarah Smart",
        'year': 2024,
        'isbn': "978-0987654321",
        'cover_url': "https://via.placeholder.com/200x300",
        'short_description': "A collection of safe and fun science experiments that can be done with everyday household items.",
        'age_range': "7-13",
        'why_recommended': f"Perfect for science lovers.",
        'tags': ["science", "experiments", "education", "STEM"],
        'content_warnings': None
    }]
    return {
        'results': {
            'fiction': fiction[:max_per_category],
            'nonfiction': nonfiction[:max_per_category]
        }
    }


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT, debug=True)
