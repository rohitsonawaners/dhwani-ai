/*********************************************************
 * DHWANI AI - CLIENT LOGIC & VOICE ENGINE
 *********************************************************/

// App State
let voices = [];
let selectedVoice = null;
let isMuted = localStorage.getItem("dhwani_muted") === "true";
let speechRate = parseFloat(localStorage.getItem("dhwani_rate") || "0.9");
let speechPitch = parseFloat(localStorage.getItem("dhwani_pitch") || "1.0");
let backendUrl = localStorage.getItem("dhwani_backend_url") || "http://127.0.0.1:5000";
let apiKey = localStorage.getItem("dhwani_api_key") || "";
let userName = localStorage.getItem("dhwani_user_name") || "";
let isRecording = false;
let speechRecognition = null;

// Chat History State (Persisted in localStorage)
let chatHistory = [];

/*********************************
 * INITIALIZATION
 *********************************/
let avatarPosY = localStorage.getItem("dhwani_avatar_pos_y") || "2";

window.addEventListener("DOMContentLoaded", () => {
  initAvatarPosition();
  initMuteState();
  initVoices();
  initSpeechRecognition();
  loadSavedChat();
  checkBackendHealth();

  // Populate inputs in settings
  const nameInput = document.getElementById("userNameInput");
  if (nameInput) {
    nameInput.value = userName;
    nameInput.addEventListener("input", (e) => {
      userName = e.target.value.trim();
      if (userName) localStorage.setItem("dhwani_user_name", userName);
      else localStorage.removeItem("dhwani_user_name");
    });
  }

  const keyInput = document.getElementById("apiKeyInput");
  if (keyInput) keyInput.value = apiKey;

  const urlInput = document.getElementById("backendUrlInput");
  if (urlInput) urlInput.value = backendUrl;

  const rateSlider = document.getElementById("rateRange");
  if (rateSlider) rateSlider.value = speechRate;
  const rateVal = document.getElementById("rateVal");
  if (rateVal) rateVal.innerText = speechRate + "x";

  const pitchSlider = document.getElementById("pitchRange");
  if (pitchSlider) pitchSlider.value = speechPitch;
  const pitchVal = document.getElementById("pitchVal");
  if (pitchVal) pitchVal.innerText = speechPitch;

  const avatarSlider = document.getElementById("avatarPosYRange");
  if (avatarSlider) avatarSlider.value = avatarPosY;
  updateAvatarPosLabel(avatarPosY);

  // Keyboard shortcut (Enter to send, Shift+Enter for newline)
  const userInput = document.getElementById("userInput");
  if (userInput) {
    userInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    userInput.addEventListener("input", function() {
      this.style.height = "auto";
      const newHeight = Math.min(Math.max(this.scrollHeight, 44), 110);
      this.style.height = newHeight + "px";
      this.style.overflowY = this.scrollHeight > 110 ? "auto" : "hidden";
    });
  }
});

/*********************************
 * BACKEND HEALTH CHECK
 *********************************/
async function checkBackendHealth() {
  const statusPill = document.getElementById("statusPill");
  const statusText = document.getElementById("statusText");

  try {
    const headers = {};
    if (apiKey) headers["X-OpenAI-Key"] = apiKey;

    const res = await fetch(`${backendUrl}/health`, { method: "GET", headers: headers });
    if (res.ok) {
      const data = await res.json();
      if (statusPill) statusPill.style.background = "rgba(16, 185, 129, 0.15)";
      if (statusText) {
        statusText.style.color = "#059669";
        if (data.openai_configured) {
          const model = data.model || "";
          if (model.includes("llama")) {
            statusText.innerText = "Online (Groq AI ⚡)";
          } else if (model.includes("gpt")) {
            statusText.innerText = "Online (OpenAI)";
          } else {
            statusText.innerText = "Online (AI)";
          }
        } else if (apiKey && apiKey.startsWith("gsk_")) {
          statusText.innerText = "Online (Groq AI ⚡)";
        } else {
          statusText.innerText = "Online (Local Engine)";
        }
      }
    } else {
      throw new Error("Bad status");
    }
  } catch (err) {
    if (statusPill) statusPill.style.background = "rgba(239, 68, 68, 0.15)";
    if (statusText) {
      statusText.style.color = "#dc2626";
      statusText.innerText = "Offline";
    }
  }
}

/*********************************
 * VOICE ENGINE & SPEECH SYNTHESIS
 *********************************/
function initVoices() {
  if (!("speechSynthesis" in window)) return;

  function load() {
    voices = window.speechSynthesis.getVoices();
    populateVoiceSelect();
    selectBestVoice();
  }

  load();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = load;
  }
}

function selectBestVoice() {
  const savedVoiceName = localStorage.getItem("dhwani_selected_voice");
  if (savedVoiceName) {
    const found = voices.find(v => v.name === savedVoiceName);
    if (found) {
      selectedVoice = found;
      updateVoiceInfoDisplay();
      return;
    }
  }

  // Priority search for Indian/Hindi female voices
  const priorityPatterns = [
    /kalpana/i,
    /swara/i,
    /heera/i,
    /madhur/i,
    /neerja/i,
    /google.*(hi-in|hindi|हिन्दी)/i,
    /hi-in/i,
    /en-in/i,
    /india/i
  ];

  for (const pattern of priorityPatterns) {
    const match = voices.find(v => pattern.test(v.name) || pattern.test(v.lang));
    if (match) {
      selectedVoice = match;
      updateVoiceInfoDisplay();
      return;
    }
  }

  // Fallback to any natural female or first voice
  selectedVoice = voices.find(v => /female|zira|samantha/i.test(v.name)) || voices[0] || null;
  updateVoiceInfoDisplay();
}

function populateVoiceSelect() {
  const select = document.getElementById("voiceSelect");
  if (!select || voices.length === 0) return;

  const currentVal = selectedVoice ? selectedVoice.name : "";
  select.innerHTML = '<option value="">Auto-Detect (Indian Preferred)</option>';

  voices.forEach(voice => {
    const opt = document.createElement("option");
    opt.value = voice.name;
    const isIndian = /hi-in|en-in|india|hindi/i.test(voice.lang + voice.name);
    opt.innerText = `${voice.name} (${voice.lang}) ${isIndian ? "⭐" : ""}`;
    if (voice.name === currentVal) opt.selected = true;
    select.appendChild(opt);
  });
}

function onVoiceChange(voiceName) {
  if (!voiceName) {
    localStorage.removeItem("dhwani_selected_voice");
    selectBestVoice();
  } else {
    selectedVoice = voices.find(v => v.name === voiceName) || null;
    if (selectedVoice) {
      localStorage.setItem("dhwani_selected_voice", selectedVoice.name);
    }
  }
  updateVoiceInfoDisplay();
}

function updateVoiceInfoDisplay() {
  const info = document.getElementById("selectedVoiceInfo");
  if (!info) return;
  if (selectedVoice) {
    info.innerText = `Active: ${selectedVoice.name} (${selectedVoice.lang})`;
  } else {
    info.innerText = "Using browser default speech synthesis";
  }
}

function normalizeForSpeech(text) {
  // Remove emojis and symbols that speech synthesis reads literally
  let clean = text.replace(/[\u{1F600}-\u{1F64F}|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}|\u{1F900}-\u{1F9FF}]/gu, '');
  clean = clean.replace(/[*#_~`]/g, '');
  clean = clean.replace(/,/g, ', ');
  clean = clean.replace(/\./g, '. ');
  return clean.trim();
}

function detectTextLanguage(text) {
  if (!text) return "en";
  if (/[\u0900-\u097F]/.test(text)) return "hi";

  const lower = text.toLowerCase();
  const hinglishMarkers = [
    "kya", "kyun", "kyu", "kaise", "kaisa", "kaisi", "hai", "hain", "hoon", "hun", "ho",
    "tha", "thi", "the", "aaj", "kal", "abhi", "kabhi", "phir", "pehle",
    "mera", "meri", "mere", "tera", "teri", "tere", "apna", "apni", "apne",
    "mujhe", "tujhe", "humein", "hum", "tum", "aap", "aapka", "aapki", "aapke",
    "bahut", "bohot", "achha", "achhi", "achhe", "theek", "yaar", "dost",
    "nahi", "nahin", "mat", "bhi", "toh", "aur", "lekin", "mein",
    "kar", "karo", "karna", "karein", "raha", "rahi", "rahe", "batao", "suno", "samjhao"
  ];
  const words = lower.match(/\b[a-z]+\b/g) || [];
  const hits = words.filter(w => hinglishMarkers.includes(w)).length;
  if (hits >= 1) return "hi";
  return "en";
}

function speak(text, lang = null) {
  if (isMuted || !("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();

  const utteranceText = normalizeForSpeech(text);
  if (!utteranceText) return;

  let targetLang = "en";
  if (lang === "hindi" || lang === "hi" || lang === "hinglish") {
    targetLang = "hi";
  } else if (lang === "english" || lang === "en") {
    targetLang = "en";
  } else {
    targetLang = detectTextLanguage(utteranceText);
  }

  const utterance = new SpeechSynthesisUtterance(utteranceText);

  // If user selected a specific voice manually in Settings, honor it
  const savedVoiceName = localStorage.getItem("dhwani_selected_voice");
  if (savedVoiceName) {
    const manual = voices.find(v => v.name === savedVoiceName);
    if (manual) {
      utterance.voice = manual;
      utterance.lang = manual.lang;
    }
  }

  // Otherwise, select the best voice according to response language
  if (!utterance.voice) {
    if (targetLang === "hi") {
      // Priority for Microsoft Kalpana and Hindi voices
      const hindiPatterns = [
        /kalpana/i,
        /swara/i,
        /heera/i,
        /madhur/i,
        /google.*(hi-in|hindi|हिन्दी)/i,
        /hi-in/i,
        /en-in/i
      ];
      for (const pattern of hindiPatterns) {
        const match = voices.find(v => pattern.test(v.name) || pattern.test(v.lang));
        if (match) {
          utterance.voice = match;
          utterance.lang = match.lang || "hi-IN";
          break;
        }
      }
      if (!utterance.voice) utterance.lang = "hi-IN";
    } else {
      // English voice selection
      const englishPatterns = [
        /neerja/i,
        /heera/i,
        /en-in/i,
        /jenny/i,
        /aria/i,
        /samantha/i,
        /zira/i,
        /google.*english/i,
        /en-us/i,
        /en-gb/i,
        /female/i,
        /^en/i
      ];
      for (const pattern of englishPatterns) {
        const match = voices.find(v => pattern.test(v.name) || pattern.test(v.lang));
        if (match) {
          utterance.voice = match;
          utterance.lang = match.lang || "en-IN";
          break;
        }
      }
      if (!utterance.voice) utterance.lang = "en-IN";
    }
  }

  utterance.rate = speechRate;
  utterance.pitch = speechPitch;
  utterance.volume = 1;

  utterance.onstart = () => {
    startSpeakingAnimation();
  };

  utterance.onend = () => {
    stopSpeakingAnimation();
  };

  utterance.onerror = () => {
    stopSpeakingAnimation();
  };

  window.speechSynthesis.speak(utterance);
}

function stopSpeech() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  stopSpeakingAnimation();
}

/*********************************
 * AVATAR & EQUALIZER ANIMATIONS
 *********************************/
function setDhwaniReaction(emotion) {
  const img = document.getElementById("dhwaniImage");
  const card = document.getElementById("characterCard");
  const badgeEmoji = document.getElementById("badgeEmoji");
  const badgeLabel = document.getElementById("badgeLabel");

  if (!card) return;

  const emo = (emotion || "neutral").toLowerCase();
  card.setAttribute("data-emotion", emo);

  let targetImg = "neutral.png";
  let emoji = "🌸";
  let label = "Calm & Ready";

  if (emo === "happy") {
    targetImg = "smile.png";
    emoji = "😊";
    label = "Happy & Cheerful";
  } else if (emo === "playful") {
    targetImg = "smile.png";
    emoji = "😜";
    label = "Playful & Fun";
  } else if (emo === "surprised") {
    targetImg = "smile.png";
    emoji = "😲";
    label = "Surprised & Lively";
  } else if (emo === "calm") {
    targetImg = "calm.png";
    emoji = "🌿";
    label = "Peaceful & Relaxed";
  } else if (emo === "caring") {
    targetImg = "calm.png";
    emoji = "❤️";
    label = "Warm & Caring";
  } else if (emo === "sad") {
    targetImg = "sad.png";
    emoji = "🥺";
    label = "Empathetic & Gentle";
  } else if (emo === "thinking") {
    targetImg = "neutral.png";
    emoji = "✨";
    label = "Dhwani is thinking...";
  } else {
    targetImg = "neutral.png";
    emoji = "🌸";
    label = "Calm & Ready";
  }

  if (badgeEmoji) badgeEmoji.innerText = emoji;
  if (badgeLabel) badgeLabel.innerText = label;

  if (img && img.getAttribute("src") !== targetImg) {
    img.style.opacity = "0";
    setTimeout(() => {
      img.src = targetImg;
      img.style.opacity = "1";
    }, 150);
  }
}

function startSpeakingAnimation() {
  const img = document.getElementById("dhwaniImage");
  const wave = document.getElementById("soundWave");
  if (img) img.style.animation = "speaking 0.5s ease-in-out infinite";
  if (wave) wave.classList.add("active");
}

function stopSpeakingAnimation() {
  const img = document.getElementById("dhwaniImage");
  const wave = document.getElementById("soundWave");
  if (img) img.style.animation = "breathe 4s ease-in-out infinite";
  if (wave) wave.classList.remove("active");
}

/*********************************
 * SPEECH-TO-TEXT (VOICE INPUT)
 *********************************/
function initSpeechRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    const micBtn = document.getElementById("micBtn");
    if (micBtn) {
      micBtn.title = "Voice input not supported in this browser (use Chrome/Edge)";
      micBtn.style.opacity = "0.5";
    }
    return;
  }

  speechRecognition = new SpeechRec();
  speechRecognition.continuous = false;
  speechRecognition.interimResults = false;
  speechRecognition.lang = "hi-IN"; // Supports Hinglish/Hindi natively

  speechRecognition.onstart = () => {
    isRecording = true;
    const micBtn = document.getElementById("micBtn");
    const micStatus = document.getElementById("micStatusLabel");
    if (micBtn) micBtn.classList.add("recording");
    if (micStatus) {
      micStatus.innerText = "Listening...";
      micStatus.className = "mic-status-label show";
    }
    stopSpeech();
    showToast("Listening... Speak now! 🎙️");
  };

  speechRecognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const userInput = document.getElementById("userInput");
    const micStatus = document.getElementById("micStatusLabel");
    if (micStatus) {
      micStatus.innerText = "Understanding...";
      micStatus.className = "mic-status-label show processing";
    }
    if (userInput && transcript) {
      userInput.value = transcript;
      sendMessage();
    }
  };

  speechRecognition.onerror = (event) => {
    console.warn("Speech recognition error:", event.error);
    showToast("Voice input: " + (event.error === "no-speech" ? "No voice detected" : event.error));
    stopRecording();
  };

  speechRecognition.onend = () => {
    stopRecording();
  };
}

function toggleSpeechRecognition() {
  if (!speechRecognition) {
    showToast("Speech Recognition not supported in this browser. Use Chrome/Edge!");
    return;
  }

  if (isRecording) {
    speechRecognition.stop();
    stopRecording();
  } else {
    try {
      speechRecognition.start();
    } catch (e) {
      console.error(e);
      stopRecording();
    }
  }
}

function stopRecording() {
  isRecording = false;
  const micBtn = document.getElementById("micBtn");
  const micStatus = document.getElementById("micStatusLabel");
  if (micBtn) micBtn.classList.remove("recording");
  if (micStatus) {
    micStatus.className = "mic-status-label";
  }
}

/*********************************
 * USER NAME DETECTION & MEMORY
 *********************************/
function detectAndSaveUserName(text) {
  const patterns = [
    /(?:(?:mera naam|my name is|naam hai|call me|i am|main|mai hoon)\s+)([A-Za-z\u0900-\u097F]+)/i
  ];
  for (const p of patterns) {
    const match = text.match(p);
    if (match && match[1]) {
      const candidate = match[1].trim();
      const skipWords = ["dost", "yaar", "theek", "good", "happy", "sad", "kaun", "dhwani", "joke", "free", "ready", "listening", "online"];
      if (candidate.length >= 2 && !skipWords.includes(candidate.toLowerCase())) {
        userName = candidate.charAt(0).toUpperCase() + candidate.slice(1);
        localStorage.setItem("dhwani_user_name", userName);
        const nameInput = document.getElementById("userNameInput");
        if (nameInput) nameInput.value = userName;
        break;
      }
    }
  }
}

/*********************************
 * CHAT MESSAGE LOGIC
 *********************************/
function appendMessageUI(text, sender, emotion = "neutral") {
  const chatBox = document.getElementById("chatBox");
  if (!chatBox) return;

  const row = document.createElement("div");
  row.className = sender === "user" ? "message-row user-row" : "message-row dhwani-row";

  const avatar = document.createElement("div");
  avatar.className = "avatar-mini";
  avatar.setAttribute("aria-hidden", "true");
  avatar.innerText = sender === "user" ? "👤" : "🌸";

  const msgDiv = document.createElement("div");
  msgDiv.className = sender === "user" ? "message user" : "message dhwani";

  const senderName = document.createElement("div");
  senderName.className = "message-sender";
  senderName.innerText = sender === "user" ? (userName || "You") : "Dhwani AI";

  const bodyDiv = document.createElement("div");
  bodyDiv.className = "message-body";
  bodyDiv.innerText = text;

  const metaDiv = document.createElement("div");
  metaDiv.className = "message-meta";

  const timeSpan = document.createElement("span");
  timeSpan.className = "message-time";
  const now = new Date();
  timeSpan.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  metaDiv.appendChild(timeSpan);

  if (sender !== "user") {
    // Replay Voice Button
    const replayBtn = document.createElement("button");
    replayBtn.className = "action-mini-btn";
    replayBtn.title = "Speak again";
    replayBtn.setAttribute("aria-label", "Speak message again");
    replayBtn.innerText = "🔊";
    replayBtn.onclick = () => speak(text);
    metaDiv.appendChild(replayBtn);

    // Copy Message Button
    const copyBtn = document.createElement("button");
    copyBtn.className = "action-mini-btn";
    copyBtn.title = "Copy message";
    copyBtn.setAttribute("aria-label", "Copy message text");
    copyBtn.innerText = "📋";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(text);
      showToast("Copied to clipboard!");
    };
    metaDiv.appendChild(copyBtn);

    // Regenerate Button
    const regenBtn = document.createElement("button");
    regenBtn.className = "action-mini-btn";
    regenBtn.title = "Regenerate response";
    regenBtn.setAttribute("aria-label", "Regenerate response");
    regenBtn.innerText = "🔄";
    regenBtn.onclick = () => regenerateLastResponse();
    metaDiv.appendChild(regenBtn);
  } else {
    // User Copy Button
    const copyBtn = document.createElement("button");
    copyBtn.className = "action-mini-btn";
    copyBtn.title = "Copy message";
    copyBtn.setAttribute("aria-label", "Copy message text");
    copyBtn.innerText = "📋";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(text);
      showToast("Copied to clipboard!");
    };
    metaDiv.appendChild(copyBtn);
  }

  msgDiv.appendChild(senderName);
  msgDiv.appendChild(bodyDiv);
  msgDiv.appendChild(metaDiv);

  row.appendChild(avatar);
  row.appendChild(msgDiv);

  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function showTypingIndicator() {
  const chatBox = document.getElementById("chatBox");
  if (!chatBox) return null;

  const row = document.createElement("div");
  row.id = "typingIndicatorRow";
  row.className = "message-row dhwani-row";

  row.innerHTML = `
    <div class="avatar-mini" aria-hidden="true">🌸</div>
    <div class="message dhwani">
      <div class="message-sender">Dhwani AI</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <div class="typing-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <span style="font-size:11.5px;color:var(--text-muted);font-style:italic;">Dhwani is thinking...</span>
      </div>
    </div>
  `;

  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
  setDhwaniReaction("thinking");
  return row;
}

function removeTypingIndicator() {
  const row = document.getElementById("typingIndicatorRow");
  if (row && row.parentNode) {
    row.parentNode.removeChild(row);
  }
}

async function sendMessage() {
  const input = document.getElementById("userInput");
  if (!input) return;

  const text = input.value.trim();
  if (text === "") return;

  stopSpeech();

  // Detect user name if stated
  detectAndSaveUserName(text);

  // STEP 1: Add user message immediately
  appendMessageUI(text, "user");
  chatHistory.push({ role: "user", content: text });
  saveChatHistory();

  // Reset input & auto-adjust height
  input.value = "";
  input.style.height = "44px";
  input.style.overflowY = "hidden";

  // STEP 2 & 3: Show typing indicator & set character thinking state
  showTypingIndicator();

  // STEP 4: Call Groq / Backend API
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["X-OpenAI-Key"] = apiKey;

    const res = await fetch(`${backendUrl}/chat`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        message: text,
        history: chatHistory.slice(-6),
        userName: userName,
        apiKey: apiKey
      })
    });

    if (!res.ok) throw new Error(`HTTP error ${res.status}`);

    const data = await res.json();

    // STEP 5: Remove thinking indicator
    removeTypingIndicator();

    const dialogue = data.dialogue || "Main samajh nahi paayi, thoda aur bataoge?";
    const emotion = data.emotion || "neutral";

    // STEP 6: Show Dhwani response
    appendMessageUI(dialogue, "dhwani", emotion);
    chatHistory.push({ role: "assistant", content: dialogue });
    saveChatHistory();

    // STEP 7, 8, 9 & 10: Set emotion, speak voice, animate speaking, then return to idle
    setDhwaniReaction(emotion);
    speak(dialogue, data.language);

  } catch (err) {
    console.error("Chat error:", err);
    removeTypingIndicator();

    // Fallback dialogue when backend connection fails
    const fallbackText = "Oops! Connection mein thodi dikkat aayi, par main yahin hoon! Backend server check kar lijiye. 😊";
    appendMessageUI(fallbackText, "dhwani", "caring");
    setDhwaniReaction("caring");
    speak(fallbackText);
  }
}

async function regenerateLastResponse() {
  const lastUserIndex = chatHistory.map(m => m.role).lastIndexOf("user");
  if (lastUserIndex === -1) {
    showToast("No previous user message to regenerate!");
    return;
  }
  const lastUserMsg = chatHistory[lastUserIndex].content;

  // Remove the last assistant message from history
  if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === "assistant") {
    chatHistory.pop();
    saveChatHistory();
  }

  // Remove last Dhwani bubble from DOM
  const chatBox = document.getElementById("chatBox");
  if (chatBox) {
    const dhwaniRows = chatBox.querySelectorAll(".dhwani-row:not(#typingIndicatorRow)");
    if (dhwaniRows.length > 0) {
      const lastDhwaniRow = dhwaniRows[dhwaniRows.length - 1];
      lastDhwaniRow.parentNode.removeChild(lastDhwaniRow);
    }
  }

  stopSpeech();
  showTypingIndicator();

  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["X-OpenAI-Key"] = apiKey;

    const res = await fetch(`${backendUrl}/chat`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        message: lastUserMsg,
        history: chatHistory.slice(-6),
        userName: userName,
        apiKey: apiKey
      })
    });

    if (!res.ok) throw new Error(`HTTP error ${res.status}`);

    const data = await res.json();
    removeTypingIndicator();

    const dialogue = data.dialogue || "Main samajh nahi paayi, thoda aur bataoge?";
    const emotion = data.emotion || "neutral";

    appendMessageUI(dialogue, "dhwani", emotion);
    chatHistory.push({ role: "assistant", content: dialogue });
    saveChatHistory();

    setDhwaniReaction(emotion);
    speak(dialogue, data.language);
    showToast("Response regenerated! ✨");

  } catch (err) {
    console.error("Regenerate error:", err);
    removeTypingIndicator();
    appendMessageUI("Regenerate karne mein thodi dikkat aayi. Phir se try karein?", "dhwani", "caring");
    setDhwaniReaction("caring");
  }
}

function quickSend(promptText) {
  const input = document.getElementById("userInput");
  if (input) {
    input.value = promptText;
    sendMessage();
  }
}

function replayMessage(btn) {
  const row = btn.closest(".message");
  if (row) {
    const body = row.querySelector(".message-body");
    if (body) speak(body.innerText);
  }
}

function copyMessage(btn) {
  const row = btn.closest(".message");
  if (row) {
    const body = row.querySelector(".message-body");
    if (body) {
      navigator.clipboard.writeText(body.innerText);
      showToast("Message copied!");
    }
  }
}

/*********************************
 * CHAT HISTORY PERSISTENCE
 *********************************/
function saveChatHistory() {
  try {
    localStorage.setItem("dhwani_chat_history", JSON.stringify(chatHistory.slice(-20)));
  } catch (e) {
    console.warn("Storage quota exceeded", e);
  }
}

function loadSavedChat() {
  try {
    const saved = localStorage.getItem("dhwani_chat_history");
    if (saved) {
      chatHistory = JSON.parse(saved);
      const chatBox = document.getElementById("chatBox");
      if (chatBox && chatHistory.length > 0) {
        chatBox.innerHTML = "";
        chatHistory.forEach(item => {
          appendMessageUI(item.content, item.role === "user" ? "user" : "dhwani");
        });
      }
    }
  } catch (e) {
    chatHistory = [];
  }
}

function clearChat() {
  if (confirm("Kya aap saari baatein clear karna chahte hain?")) {
    stopSpeech();
    chatHistory = [];
    localStorage.removeItem("dhwani_chat_history");
    const chatBox = document.getElementById("chatBox");
    if (chatBox) {
      chatBox.innerHTML = `
        <div class="message-row dhwani-row">
          <div class="avatar-mini">🌸</div>
          <div class="message dhwani">
            <div class="message-sender">Dhwani AI</div>
            <div class="message-body">Hello! Conversation clear ho gaya hai 😊 Batao, aaj kya nayi baat karein?</div>
            <div class="message-meta">
              <span class="message-time">Just now</span>
              <button class="action-mini-btn" onclick="replayMessage(this)" title="Speak again">🔊</button>
              <button class="action-mini-btn" onclick="copyMessage(this)" title="Copy text">📋</button>
            </div>
          </div>
        </div>
      `;
    }
    setDhwaniReaction("neutral");
    showToast("Chat cleared!");
  }
}

/*********************************
 * AUDIO & SETTINGS MODAL
 *********************************/
function toggleMute() {
  isMuted = !isMuted;
  localStorage.setItem("dhwani_muted", isMuted);
  initMuteState();
  if (isMuted) {
    stopSpeech();
    showToast("Voice muted 🔇");
  } else {
    showToast("Voice unmuted 🔊");
    speak("Voice on ho gaya!");
  }
}

function initMuteState() {
  const muteIcon = document.getElementById("muteIcon");
  if (muteIcon) {
    muteIcon.innerText = isMuted ? "🔇" : "🔊";
  }
}

function openSettings() {
  const modal = document.getElementById("settingsModal");
  if (modal) modal.classList.add("open");
}

function closeSettings() {
  const modal = document.getElementById("settingsModal");
  if (modal) modal.classList.remove("open");
}

function handleModalClick(e) {
  if (e.target.id === "settingsModal") {
    closeSettings();
  }
}

function toggleKeyVisibility() {
  const keyInput = document.getElementById("apiKeyInput");
  const btn = event.target;
  if (!keyInput) return;
  if (keyInput.type === "password") {
    keyInput.type = "text";
    btn.innerText = "Hide";
  } else {
    keyInput.type = "password";
    btn.innerText = "Show";
  }
}

function updateSpeechSetting(type, val) {
  if (type === "rate") {
    speechRate = parseFloat(val);
    const label = document.getElementById("rateVal");
    if (label) label.innerText = val + "x";
    localStorage.setItem("dhwani_rate", val);
  } else if (type === "pitch") {
    speechPitch = parseFloat(val);
    const label = document.getElementById("pitchVal");
    if (label) label.innerText = val;
    localStorage.setItem("dhwani_pitch", val);
  }
}

function initAvatarPosition() {
  document.documentElement.style.setProperty("--avatar-pos-y", avatarPosY + "%");
  updateAvatarPosLabel(avatarPosY);
}

function updateAvatarPosition(val) {
  avatarPosY = val;
  document.documentElement.style.setProperty("--avatar-pos-y", val + "%");
  localStorage.setItem("dhwani_avatar_pos_y", val);
  updateAvatarPosLabel(val);
}

function updateAvatarPosLabel(val) {
  const label = document.getElementById("avatarPosVal");
  if (!label) return;
  const num = parseInt(val);
  if (num <= 5) label.innerText = `Face & Head (${val}%) ⭐`;
  else if (num <= 25) label.innerText = `Bust / Neck (${val}%)`;
  else label.innerText = `Centered (${val}%)`;
}

function resetSettings() {
  if (!confirm("Kya aap saari settings default par reset karna chahte hain?")) {
    return;
  }

  // 0. Reset User Name Memory
  userName = "";
  localStorage.removeItem("dhwani_user_name");
  const nameInput = document.getElementById("userNameInput");
  if (nameInput) nameInput.value = "";

  // 1. Reset Speed & Pitch
  speechRate = 0.9;
  speechPitch = 1.0;
  localStorage.removeItem("dhwani_rate");
  localStorage.removeItem("dhwani_pitch");
  const rateSlider = document.getElementById("rateRange");
  if (rateSlider) rateSlider.value = "0.9";
  const rateVal = document.getElementById("rateVal");
  if (rateVal) rateVal.innerText = "0.9x";

  const pitchSlider = document.getElementById("pitchRange");
  if (pitchSlider) pitchSlider.value = "1.0";
  const pitchVal = document.getElementById("pitchVal");
  if (pitchVal) pitchVal.innerText = "1.0";

  // 2. Reset Avatar Vertical Focus
  avatarPosY = "2";
  localStorage.removeItem("dhwani_avatar_pos_y");
  updateAvatarPosition("2");
  const avatarSlider = document.getElementById("avatarPosYRange");
  if (avatarSlider) avatarSlider.value = "2";

  // 3. Reset Backend API URL
  backendUrl = "http://127.0.0.1:5000";
  localStorage.removeItem("dhwani_backend_url");
  const urlInput = document.getElementById("backendUrlInput");
  if (urlInput) urlInput.value = backendUrl;

  // 4. Reset Voice selection to Auto-detect
  localStorage.removeItem("dhwani_selected_voice");
  const voiceSelect = document.getElementById("voiceSelect");
  if (voiceSelect) voiceSelect.value = "";
  selectBestVoice();

  showToast("Settings reset to defaults! 🔄");
}

async function saveSettings() {
  const nameInput = document.getElementById("userNameInput");
  const keyInput = document.getElementById("apiKeyInput");
  const urlInput = document.getElementById("backendUrlInput");

  if (nameInput) {
    userName = nameInput.value.trim();
    if (userName) {
      localStorage.setItem("dhwani_user_name", userName);
    } else {
      localStorage.removeItem("dhwani_user_name");
    }
  }

  if (urlInput) {
    backendUrl = urlInput.value.trim() || "http://127.0.0.1:5000";
    localStorage.setItem("dhwani_backend_url", backendUrl);
  }

  if (keyInput) {
    apiKey = keyInput.value.trim();
    if (apiKey) {
      localStorage.setItem("dhwani_api_key", apiKey);
      // Sync key with backend .env
      try {
        await fetch(`${backendUrl}/save-key`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: apiKey })
        });
        showToast("Connected to AI Model! ⚡");
      } catch (e) {
        showToast("Preferences saved locally!");
      }
    } else {
      localStorage.removeItem("dhwani_api_key");
      showToast("Key cleared. Using local engine.");
    }
  } else {
    showToast("Preferences saved!");
  }

  closeSettings();
  checkBackendHealth();
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.innerText = msg;
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

