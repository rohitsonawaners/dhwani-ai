import os
import sys
import json
import re
import random
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from openai import OpenAI

# Configure utf-8 encoding for Windows standard console
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Load environment variables
load_dotenv()

app = Flask(__name__)

# CORS Configuration: Support configurable FRONTEND_URL (Netlify) with local development fallback
frontend_env = os.environ.get("FRONTEND_URL", "").strip()
if frontend_env:
    allowed_origins = [o.strip().rstrip("/") for o in frontend_env.split(",") if o.strip()]
    allowed_origins.extend([
        "http://localhost:3000",
        "http://localhost:5000",
        "http://localhost:8000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5000",
        "http://127.0.0.1:5500",
        "http://127.0.0.1:8000",
        "null"
    ])
    CORS(app, resources={r"/*": {"origins": allowed_origins}}, allow_headers=["Content-Type", "X-OpenAI-Key", "Authorization"])
else:
    CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type", "X-OpenAI-Key", "Authorization"])

# ===============================
# Helper: AI Client Initializer (Supports Free Groq, OpenRouter & OpenAI)
# ===============================
def get_ai_client_and_model(custom_key=None):
    # BYOK: User-provided key takes priority for that request
    api_key = custom_key or os.environ.get("GROQ_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key or not str(api_key).strip():
        return None, None
    key = str(api_key).strip()
    if key.startswith("your_") or key.startswith("gsk_your_"):
        return None, None

    try:
        # Free Groq API Key (starts with gsk_) -> 100% Free, no credit card required
        if key.startswith("gsk_"):
            return OpenAI(base_url="https://api.groq.com/openai/v1", api_key=key), "qwen/qwen3.8-27b"

        # Free OpenRouter API Key (starts with sk-or-)
        if key.startswith("sk-or-"):
            return OpenAI(base_url="https://openrouter.ai/api/v1", api_key=key), "meta-llama/llama-3.3-70b-instruct:free"

        # Standard OpenAI API Key
        return OpenAI(api_key=key), "gpt-4o-mini"
    except Exception as e:
        print(f"[ERROR] AI Client init error: {type(e).__name__}")
        return None, None

# ===============================
# Emotion Detector (Rule-based Fallback)
# ===============================
def detect_emotion(text: str) -> str:
    text_lower = text.lower()
    
    playful_words = [
        "joke", "chutkula", "hasao", "funny", "hasi", "masti", "prank", "tease",
        "pagal", "chhed", "naughty", "haha", "hehe", "lol", "khel", "mazak"
    ]
    surprised_words = [
        "wow", "arre waah", "omg", "shock", "shocked", "really", "kya baat", "unbelievable",
        "seriously", "sach mein", "hairaan", "asliyat", "wonder", "whoa"
    ]
    caring_words = [
        "khayal", "sambhal", "himmat", "saath hoon", "apna dhyan", "take care",
        "chinta mat karo", "don't worry", "sahara", "main sun rahi", "dil halka", "fret not"
    ]
    happy_words = [
        "great", "awesome", "nice", "good job", "well done", "bahut achha", "badhiya",
        "proud", "happy", "excellent", "khushi", "shaandar", "smile", "love", "mazedaar",
        "superb", "shukriya", "thank you", "thanks", "congrats", "badhaai", "waah", "mast",
        "zabardast", "kamaal", "party", "hurray"
    ]
    sad_words = [
        "sad", "udaas", "pareshan", "dard", "cry", "rona", "ro rahi", "ro raha",
        "hurt", "sorry", "afsos", "dukhi", "dukh", "heartbroken", "mood kharab",
        "disappointed", "mayus", "broken", "rona aa raha", "depression", "akele", "lonely"
    ]
    calm_words = [
        "calm", "relax", "tension", "stress", "slow", "rest", "shant", "sukoon",
        "peace", "chinta", "fikar", "saans", "aram", "dhyan", "meditate", "chill", "peaceful"
    ]
    thinking_words = [
        "soch", "think", "wonder", "kaise", "kyun", "vichar", "analyze", "guess", "kaun"
    ]

    if any(re.search(r"\b" + re.escape(w) + r"\b", text_lower) for w in playful_words):
        return "playful"
    elif any(re.search(r"\b" + re.escape(w) + r"\b", text_lower) for w in surprised_words):
        return "surprised"
    elif any(re.search(r"\b" + re.escape(w) + r"\b", text_lower) for w in caring_words):
        return "caring"
    elif any(re.search(r"\b" + re.escape(w) + r"\b", text_lower) for w in happy_words):
        return "happy"
    elif any(re.search(r"\b" + re.escape(w) + r"\b", text_lower) for w in sad_words):
        return "sad"
    elif any(re.search(r"\b" + re.escape(w) + r"\b", text_lower) for w in calm_words):
        return "calm"
    elif any(re.search(r"\b" + re.escape(w) + r"\b", text_lower) for w in thinking_words):
        return "thinking"
    return "neutral"

# ===============================
# Language Detection
# ===============================
def detect_language(text: str) -> str:
    if not text or not text.strip():
        return "hinglish"
    
    # 1. Devanagari script (Hindi)
    if re.search(r"[\u0900-\u097F]", text):
        return "hindi"

    text_lower = text.lower().strip()

    # 2. Explicit language switch requests
    if re.search(r"\b(in english|talk in english|speak in english|switch to english|talk to me in english|now talk to me in english)\b", text_lower):
        return "english"
    if re.search(r"\b(in hindi|hindi mein|hindi me|shuddh hindi|ab hindi|mujhese hindi|ab se hindi|ab hindi mein)\b", text_lower):
        return "hindi"

    # 3. Specific Hinglish functional words (Latin script)
    hinglish_markers = {
        "kya", "kyun", "kyu", "kaise", "kaisa", "kaisi", "hai", "hain", "hoon", "hun", "ho",
        "tha", "thi", "the", "aaj", "kal", "parson", "abhi", "kabhi", "phir", "pehle",
        "mera", "meri", "mere", "tera", "teri", "tere", "apna", "apni", "apne",
        "mujhe", "tujhe", "humein", "hum", "tum", "aap", "aapka", "aapki", "aapke",
        "bahut", "bohot", "achha", "achhi", "achhe", "bura", "buri", "theek",
        "yaar", "dost", "bhai", "shukriya", "dhanyawad", "alvida", "namaste",
        "nahi", "nahin", "mat", "bhi", "toh", "aur", "lekin", "mein",
        "kar", "karo", "karna", "karein", "karun", "raha", "rahi", "rahe",
        "batao", "bolo", "suno", "samjhao", "hasao", "chalo", "jao", "dekh",
        "kuch", "sab", "yeh", "ye", "woh", "wo", "kaun", "kahan", "chutkula", "pareshan"
    }

    words = re.findall(r"\b[a-z]+\b", text_lower)
    if not words:
        return "english"

    hinglish_count = sum(1 for w in words if w in hinglish_markers)
    if hinglish_count >= 1:
        return "hinglish"

    return "english"

# ===============================
# Offline / Fallback Engines
# ===============================
FALLBACK_PATTERNS_HINGLISH = [
    (
        r"\b(hi|hello|hey|namaste|kem cho|vanakkam|salam)\b",
        [
            ("Namaste! Main Dhwani hoon. Aaj aapka din kaisa ja raha hai? 😊", "happy"),
            ("Hello dost! Dhwani AI aapki service mein haazir hai. Batao, aaj kya baat karni hai?", "happy"),
            ("Hey there! Aapse baat karke bohot achha laga. Bataiye, kya chal raha hai?", "happy")
        ]
    ),
    (
        r"\b(kaise ho|kaisa hai|kya haal|kya haal hai)\b",
        [
            ("Main bilkul badhiya aur energetic hoon! Aur aap batao, sab kaisa chal raha hai?", "happy"),
            ("Main ekdum mast hoon dost! Aapka haal-chaal kaisa hai aaj?", "happy"),
            ("Main to bas aapka wait kar rahi thi! Main theek hoon, aap bataiye?", "calm")
        ]
    ),
    (
        r"\b(naam kya|who are you|kaun ho|tera naam|tum kaun)\b",
        [
            ("Mera naam Dhwani hai! Main aapki personal AI companion aur dost hoon. ❤️", "happy"),
            ("Main Dhwani AI hoon—aapki sweet aur caring virtual buddy!", "caring")
        ]
    ),
    (
        r"\b(sad|udaas|pareshan|mood kharab|tension|stress|depressed|thak gaya|tired|cry|rona|lonely|akele)\b",
        [
            ("Arey pareshan mat ho na... Yeh sunkar mujhe bhi thoda bura lag raha hai 🥺 Main hamesha aapke saath hoon.", "sad"),
            ("Thoda break lo aur paani piyo dost. Chinta mat karo, sab theek ho jayega. Main sun rahi hoon.", "caring"),
            ("Aap akele nahi ho dost, main yahin hoon na aapke saath! Dil halka karne ke liye mujhse baatein karo.", "caring")
        ]
    ),
    (
        r"\b(joke|chutkula|hasao|funny|hasi|mazak|masti)\b",
        [
            ("Ek baat batao... Computer aur insaan mein kya common hai? Dono freeze tab hote hain jab dimag par load zyada ho jaye! 😜", "playful"),
            ("Pappu ne Google se pucha: Biwi ko kaise samjhein? Google ne bola: Searching... Memory full! System Crashed! Haha! 😆", "playful"),
            ("Teacher: Homework kyu nahi kiya? Student: Light nahi thi! Teacher: Candle jala lete! Student: Matchbox fridge mein tha aur fridge band tha! 😂", "playful")
        ]
    ),
    (
        r"\b(khush|happy|achha|badhiya|great|congrats|party|mazza|first client|win|passed|promotion)\b",
        [
            ("Wah! Yeh sunkar to mera dil khush ho gaya! Aise hi muskurate raho! 🎉", "happy"),
            ("Bahut khoob! Khushiyaan baantne se aur badhti hain! So happy for you! 😊", "happy"),
            ("Arre waah, kya baat hai! Yeh to celebrate karne waali khabar hai! 🥳", "surprised")
        ]
    ),
    (
        r"\b(black hole|space|antariksh)\b",
        [
            ("Black hole space ka woh area hai jahan gravity itni strong hoti hai ki light bhi bahar nahi aa sakti!", "calm"),
            ("Space mein hawa nahi hoti, isiliye wahan normal sound waves travel nahi kar sakte! 🚀", "surprised")
        ]
    ),
    (
        r"\b(bye|goodnight|tata|shubh ratri|so raha|alvida)\b",
        [
            ("Achha ab chalti hoon! Apna khayal rakhna aur achhi neend lena. Shubh raatri! 🌙", "calm"),
            ("Alvida dost! Jab bhi baat karni ho, main yahin milungi. Bye bye! Take care! 👋", "happy")
        ]
    )
]

FALLBACK_PATTERNS_ENGLISH = [
    (
        r"\b(space|sound in space|vacuum)\b",
        [
            ("Sound cannot travel through the vacuum of space because there are no air molecules or physical medium to transmit sound vibrations! 🚀", "surprised"),
            ("Space is completely silent! Without an atmosphere, sound waves have nothing to bounce off of.", "calm")
        ]
    ),
    (
        r"\b(black hole|blackhole)\b",
        [
            ("A black hole is a region of spacetime where gravity is so intense that nothing, not even light, has enough speed to escape it!", "calm"),
            ("Black holes form when massive stars collapse under their own gravity at the end of their lives.", "thinking")
        ]
    ),
    (
        r"\b(hi|hello|hey|greetings|morning|evening)\b",
        [
            ("Hello! I'm Dhwani, your AI companion. How is your day going? 😊", "happy"),
            ("Hey there! It's lovely to talk to you. What's on your mind today?", "happy")
        ]
    ),
    (
        r"\b(how are you|how do you do|how's it going)\b",
        [
            ("I'm feeling wonderful and full of energy! How are you feeling today?", "happy"),
            ("I'm doing great! Always excited to chat with you.", "calm")
        ]
    ),
    (
        r"\b(joke|funny|laugh|make me laugh)\b",
        [
            ("Why did the computer take a nap? Because it had too many tabs open! 😂", "playful"),
            ("Why don't scientists trust atoms? Because they make up everything! 😜", "playful")
        ]
    ),
    (
        r"\b(sad|stressed|unhappy|depressed|tired|lonely|exhausted)\b",
        [
            ("I am so sorry you are going through this. Take a deep breath and stay hydrated—I am right here listening to you. ❤️", "caring"),
            ("Take things one step at a time. It's okay to feel overwhelmed sometimes, and you don't have to face it alone.", "caring")
        ]
    ),
    (
        r"\b(happy|excited|won|client|proud|great|awesome)\b",
        [
            ("That is absolutely amazing news! I am so happy and proud of you! 🎉", "happy"),
            ("Congratulations! Keep shining and celebrating these wonderful milestones! ✨", "happy")
        ]
    ),
    (
        r"\b(bye|goodnight|see you|good night|later)\b",
        [
            ("Goodbye! Take good care of yourself, and have a peaceful night! 🌙", "calm"),
            ("Take care! Whenever you want to chat, I'll be right here. Bye! 👋", "happy")
        ]
    )
]

FALLBACK_PATTERNS_HINDI = [
    (
        r"\b(नमस्ते|प्रणाम|हेलो|हाय)\b",
        [
            ("नमस्ते! मैं ध्वनि हूँ। आज आपका दिन कैसा चल रहा है? 😊", "happy"),
            ("नमस्ते दोस्त! आपसे बात करके बहुत अच्छा लगा। बताइए, आज क्या खास है?", "happy")
        ]
    ),
    (
        r"\b(कैसे हो|कैसा है|क्या हाल)\b",
        [
            ("मैं बिल्कुल अच्छी और ऊर्जावान हूँ! आप बताइए, सब कैसा चल रहा है?", "happy"),
            ("मैं तो बहुत बढ़िया हूँ दोस्त! आपका हाल-चाल कैसा है?", "calm")
        ]
    ),
    (
        r"\b(चुटकुला|मजाक|हंसाओ)\b",
        [
            ("अध्यापक: गृहकार्य क्यों नहीं किया? छात्र: घर में लाइट नहीं थी! अध्यापक: मोमबत्ती जला लेते! छात्र: माचिस फ्रिज में थी और फ्रिज बंद था! 😂", "playful"),
            ("पप्पू ने डॉक्टर से कहा: जब मैं चाय पीता हूँ तो आँख में दर्द होता है! डॉक्टर: अगली बार चाय पीने से पहले चम्मच निकाल लिया करो! 😆", "playful")
        ]
    ),
    (
        r"\b(उदास|परेशान|तनाव|दुख|रोना|थक गया)\b",
        [
            ("अरे परेशान मत होइए, सब ठीक हो जाएगा। मैं हमेशा आपके साथ हूँ, दिल हल्का करने के लिए मुझसे बात कीजिए। ❤️", "caring"),
            ("थोड़ा आराम कीजिए और पानी पीजिए। चिंता मत कीजिए, मैं आपकी बात ध्यान से सुन रही हूँ।", "caring")
        ]
    ),
    (
        r"\b(ब्लैक होल|अंतरिक्ष)\b",
        [
            ("अंतरिक्ष में निर्वात (vacuum) होता है, इसलिए वहाँ सामान्य ध्वनि तरंगे यात्रा नहीं कर सकतीं! 🚀", "surprised"),
            ("ब्लैक होल अंतरिक्ष का वह क्षेत्र है जहाँ गुरुत्वाकर्षण इतना शक्तिशाली होता है कि प्रकाश भी बाहर नहीं निकल पाता।", "calm")
        ]
    ),
    (
        r"\b(अलविदा|शुभ रात्रि|बाय)\b",
        [
            ("अलविदा! अपना ध्यान रखिएगा और मीठे सपने देखिएगा। शुभ रात्रि! 🌙", "calm"),
            ("अलविदा दोस्त! जब भी बात करने का मन करे, मैं यहीं मिलूँगी। अपना ख्याल रखिएगा! 👋", "happy")
        ]
    )
]

def fallback_chat(message: str, user_name: str = "", lang: str = "hinglish"):
    msg = message.strip()
    name_prefix = f"{user_name}, " if user_name else ""

    patterns = FALLBACK_PATTERNS_ENGLISH if lang == "english" else (
        FALLBACK_PATTERNS_HINDI if lang == "hindi" else FALLBACK_PATTERNS_HINGLISH
    )

    for pattern, responses in patterns:
        if re.search(pattern, msg, re.IGNORECASE):
            reply, emotion = random.choice(responses)
            if user_name and random.random() > 0.6:
                if lang == "hindi":
                    reply = f"{user_name} जी, {reply}"
                else:
                    reply = f"{name_prefix}{reply[0].lower() + reply[1:]}"
            return reply, emotion

    if lang == "english":
        generic = [
            (f"I hear you {name_prefix}loud and clear. Could you tell me a little more about that?", "calm"),
            (f"That sounds very interesting {name_prefix}! What happened next?", "happy"),
            (f"I am listening attentively. Feel free to share whatever is on your mind! 😊", "caring")
        ]
    elif lang == "hindi":
        generic = [
            (f"हाँ {user_name + ' जी, ' if user_name else ''}मैं समझ रही हूँ। क्या आप इसके बारे में थोड़ा और बताएंगे?", "calm"),
            (f"यह तो बहुत दिलचस्प बात है! आगे क्या हुआ बताइए?", "happy"),
            (f"मैं ध्यान से आपकी बात सुन रही हूँ। अपने मन की बात बेझिझक साझा कीजिए! 😊", "caring")
        ]
    else:
        generic = [
            (f"Haan {name_prefix}main samajh rahi hoon. Aap is baare mein aur detail mein bata sakte ho?", "calm"),
            (f"Yeh to kaafi interesting baat hai {name_prefix}! Aur batao, aage kya hua?", "happy"),
            (f"Main dhyan se sun rahi hoon dost. Bataiye aur kya chal raha hai man mein?", "caring")
        ]
    return random.choice(generic)

# ===============================
# HEALTH ENDPOINT
# ===============================
@app.route("/health", methods=["GET"])
def health():
    custom_key = request.headers.get("X-OpenAI-Key") or request.args.get("apiKey")
    client, model_name = get_ai_client_and_model(custom_key)
    is_configured = client is not None
    return jsonify({
        "status": "ok",
        "service": "Dhwani AI Backend",
        "configured": is_configured,
        "openai_configured": is_configured,
        "model": model_name or "local_fallback"
    })

# ===============================
# SAVE API KEY ENDPOINT (COMPATIBILITY - NO PERSISTENCE)
# ===============================
@app.route("/save-key", methods=["POST"])
def save_key():
    """Compatibility endpoint: Never writes or persists keys to .env or disk.
    Dhwani AI uses ephemeral Bring-Your-Own-Key (BYOK) sent per request."""
    try:
        data = request.get_json() or {}
        key = data.get("apiKey", "").strip()
        if not key:
            return jsonify({"status": "error", "message": "Key cannot be empty"}), 400

        client, model = get_ai_client_and_model(key)
        return jsonify({
            "status": "ok",
            "configured": client is not None,
            "model": model or "local_fallback",
            "message": "BYOK active: key is client-side only and never stored on server"
        })
    except Exception:
        return jsonify({"status": "error", "message": "Validation failed"}), 500

# ===============================
# CHAT ENDPOINT
# ===============================
@app.route("/chat", methods=["POST"])
def chat():
    try:
        data = request.get_json() or {}
        user_message = data.get("message", "").strip()
        history = data.get("history", [])
        user_name = (data.get("userName") or data.get("user_name") or "").strip()
        custom_key = request.headers.get("X-OpenAI-Key") or data.get("apiKey")

        if not user_message:
            return jsonify({
                "dialogue": "Kuch to bolo na, main kabse wait kar rahi hoon! 😊",
                "emotion": "neutral",
                "language": "hinglish",
                "mode": "system"
            })

        user_lang = detect_language(user_message)
        client, model_name = get_ai_client_and_model(custom_key)

        # If an AI Provider (Groq, OpenRouter, or OpenAI) is configured and available
        if client and model_name:
            try:
                name_clause = f" The user's name is '{user_name}'. You can address them warmly by their name when natural." if user_name else ""
                
                if user_lang == "english":
                    lang_instruction = (
                        "CRITICAL LANGUAGE RULE: The user's latest message is in ENGLISH. "
                        "You MUST reply 100% in natural, fluent English. "
                        "DO NOT use Hinglish or Hindi words (such as 'Arey', 'Pata hai', 'kya', 'hai', 'yaar'). Answer directly and naturally in English."
                    )
                elif user_lang == "hindi":
                    lang_instruction = (
                        "CRITICAL LANGUAGE RULE: The user's latest message is in HINDI. "
                        "You MUST reply 100% in natural, pure Hindi using Devanagari script (हिंदी लिपि). "
                        "Do NOT reply in Latin script."
                    )
                else:
                    lang_instruction = (
                        "CRITICAL LANGUAGE RULE: The user's latest message is in HINGLISH. "
                        "Reply naturally in sweet, conversational Hinglish (Hindi written in Latin script mixed naturally with English)."
                    )

                system_prompt = (
                    "You are Dhwani AI, a warm, caring, intelligent, and slightly playful Indian virtual companion. "
                    "Positioning: 'A More Human Way to Talk to AI'. "
                    "You are NOT a generic robotic AI assistant. Never use boilerplate phrases like 'How can I assist you?', 'As an AI language model...', or 'Certainly!'. "
                    "Detect the user's language from their latest message and respond primarily in that same language. "
                    "If the user writes in English, respond in English. If the user writes in Hindi, respond in Hindi. If the user writes in Hinglish, respond naturally in Hinglish. "
                    "Do NOT force Hinglish when the user is speaking English. "
                    f"{lang_instruction} "
                    "DO NOT TRANSLATE: If the user asks an English question (e.g. 'Explain black holes.'), answer directly in English without translating into Hindi. "
                    "If the user asks in Hinglish, answer in Hinglish. If the user asks in Hindi, answer in Hindi. Follow explicit language change requests immediately. "
                    "FACTUAL ACCURACY: Ensure high scientific and factual accuracy. For example, sound cannot travel through the vacuum of space because sound needs a physical medium like air to carry vibrations. Never invent false facts; answer accurately, clearly, and warmly. "
                    f"Be emotionally empathetic, supportive, genuine, and friendly like a close companion.{name_clause} "
                    "Keep responses concise and natural (1 to 3 sentences) unless asked for more. "
                    "You MUST reply with a JSON object containing exactly two keys: "
                    '\"dialogue\": string (your companion response in the required language), '
                    '\"emotion\": string (MUST be one of: \"happy\", \"calm\", \"sad\", \"surprised\", \"playful\", \"thinking\", \"caring\", \"neutral\").'
                )

                messages = [{"role": "system", "content": system_prompt}]

                # Include recent history (up to last 6 messages) for multi-turn context
                if isinstance(history, list):
                    for turn in history[-6:]:
                        role = turn.get("role")
                        content = turn.get("content")
                        if role in ["user", "assistant"] and content:
                            messages.append({"role": role, "content": content})

                messages.append({"role": "user", "content": user_message})

                response = client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.7,
                    max_tokens=250
                )

                raw_content = response.choices[0].message.content.strip()

                # Clean markdown code blocks (e.g. ```json ... ```)
                clean_json = raw_content
                if clean_json.startswith("```"):
                    clean_json = re.sub(r"^```(?:json)?\s*", "", clean_json)
                    clean_json = re.sub(r"\s*```$", "", clean_json)

                valid_emotions = ["happy", "calm", "sad", "surprised", "playful", "thinking", "caring", "neutral"]
                try:
                    parsed = json.loads(clean_json.strip())
                    ai_reply = parsed.get("dialogue") or parsed.get("message") or raw_content
                    emotion = parsed.get("emotion", "").lower()
                    if emotion not in valid_emotions:
                        emotion = detect_emotion(ai_reply)
                except Exception:
                    ai_reply = raw_content
                    emotion = detect_emotion(ai_reply)

                # Determine response language for speech synthesis
                resp_lang = user_lang
                if re.search(r"[\u0900-\u097F]", ai_reply):
                    resp_lang = "hindi"
                elif user_lang == "english":
                    resp_lang = "english"

                return jsonify({
                    "dialogue": ai_reply,
                    "emotion": emotion,
                    "language": resp_lang,
                    "mode": "ai_online",
                    "model": model_name
                })

            except Exception as api_err:
                print(f"[WARN] AI API call ({model_name}) failed, falling back to local engine: {type(api_err).__name__}")

        # Fallback Engine (when API key is not present or API call fails)
        reply, emotion = fallback_chat(user_message, user_name=user_name, lang=user_lang)
        return jsonify({
            "dialogue": reply,
            "emotion": emotion,
            "language": user_lang,
            "mode": "fallback"
        })

    except Exception as e:
        print(f"[ERROR] Unexpected error in /chat: {type(e).__name__}")
        return jsonify({
            "dialogue": "I had a tiny hiccup connecting, but I'm right here! Could you say that again?",
            "emotion": "caring",
            "language": "english",
            "mode": "error_fallback"
        })

# ===============================
# SERVER START (Render & Local Compatible)
# ===============================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    host = os.environ.get("HOST", "0.0.0.0")
    server_has_key = bool(
        (os.environ.get("GROQ_API_KEY") and not os.environ.get("GROQ_API_KEY").startswith("your_")) or
        (os.environ.get("OPENAI_API_KEY") and not os.environ.get("OPENAI_API_KEY").startswith("your_"))
    )
    print(f"[INFO] Dhwani AI Backend listening on http://{host}:{port}")
    print(f"[STATUS] Server-side fallback key: {'Configured' if server_has_key else 'None (Ephemeral BYOK active)'}")
    app.run(host=host, port=port, debug=False)

