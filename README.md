# 🧠 TwinMind Live Suggestions Clone

A real-time AI meeting copilot that listens to live conversations and surfaces **context-aware, actionable suggestions** — exactly when you need them.

Built as part of the TwinMind Full Stack / Prompt Engineering assignment.

---

## 🚀 Live Demo

🔗 [Add your deployed URL here]

---

## ⚡ Quick Start (Under 2 Minutes)

```bash
git clone <your-repo>
cd twinmind-clone
npm install
npm run dev
```

1. Open http://localhost:3000
2. Paste your Groq API key in Settings
3. Click **Start Mic** and begin speaking

That’s it — suggestions will start appearing automatically.

---

## 🎯 Problem Statement

During live conversations (interviews, meetings, sales calls), users often struggle to:

* Ask the right follow-up questions
* Respond intelligently in real-time
* Catch incorrect or vague statements
* Add meaningful insights on the fly

This project solves that by acting as a **real-time cognitive assistant**.

---

## ⚡ Key Features

### 🎤 Live Transcription

* Records mic audio with `MediaRecorder` (Opus/WebM)
* **Dual-source pipeline**: browser SpeechRecognition for instant interim text, Whisper Large V3 for high-accuracy fills when SR is silent
* Chunks audio every ~30 seconds (configurable)
* Server-side hallucination filters: Whisper `no_speech_prob` / `avg_logprob` confidence gates, English language lock, non-Latin script rejection

---

### 💡 Live Suggestions Engine (Core Feature)

* Generates **exactly 3 suggestions per cycle**

* Each batch includes:

  * ❓ A question
  * 💬 A talking point / insight
  * 🔍 A clarification or fact-check

* Each suggestion:

  * Uses **recent context (last 30–60 sec)**
  * Has a **useful preview (even without click)**
  * Expands into a detailed answer

---

### 💬 Chat Panel

* Clicking a suggestion:

  * Adds it to chat
  * Generates a detailed response
* Users can also type queries
* Maintains a single continuous session

---

### ⚙️ Settings Panel

* User-provided Groq API key
* Editable prompts:

  * Suggestions prompt
  * Chat prompt
* Adjustable context window

---

### 📤 Export Session

Exports:

* Transcript (with timestamps)
* Suggestion batches
* Chat history

Formats:

* JSON
* Plain text

---

## 🧠 Core Idea

> **Show the right thing at the right time.**

This system prioritizes:

* Timing
* Relevance
* Actionability

Instead of generating long outputs, it focuses on:
👉 what is most useful *right now*

---

## 🏗️ Architecture

```bash
twinmind-clone/
│
├── app/                # Next.js App Router pages + API routes
│   └── api/            # /transcribe, /suggestions, /chat (Groq proxies)
├── components/         # MicTranscript, Suggestions, ChatPanel, SettingsModal
├── lib/                # Zustand store, prompts, types, helpers
└── public/             # Static assets
```

---

## 🔁 System Flow

1. User starts mic
2. Audio recorded → chunked every ~30 sec
3. Sent to Whisper → transcript generated
4. Transcript appended
5. Recent context extracted
6. Suggestions generated via LLM
7. Displayed in UI
8. Click → detailed response generated

---

## 🧠 Prompt Design Details (Critical Section)

### 1. Context Windowing

* Suggestions use **only recent transcript (~30–60 sec)**
* Chat uses **full transcript**

Why:

* Improves relevance
* Reduces latency
* Avoids outdated suggestions

---

### 2. Suggestion Diversity Constraint

Each cycle enforces:

* 1 Question
* 1 Insight
* 1 Clarification

Why:

* Prevents repetition
* Ensures balanced assistance
* Improves usefulness

---

### 3. Actionability Filter

Suggestions must:

* Help the user *do something*
* Not just summarize

Bad:
❌ “You can ask a follow-up question”

Good:
✅ “Ask how they are measuring API latency (P95 vs avg)”

---

### 4. Anti-Generic Safeguards

The prompt explicitly avoids:

* vague advice
* repeated phrasing
* restating transcript

---

### 5. Conversation Mode Detection (Advanced)

The system adapts based on context:

* Interview
* Technical discussion
* Sales
* General

This significantly improves suggestion relevance.

---

### 6. Example Behavior

**Transcript:**

> “We are struggling with API latency in production...”

**Suggestions:**

* ❓ “Should we introduce caching at the API layer?”
* 💬 “Latency might be caused by synchronous DB calls”
* 🔍 “Are we measuring P95 or just average latency?”

---

## 🤖 Agent System

Inspired by structured prompt systems.

### 🧾 CLAUDE.md

Defines:

* behavior rules
* constraints
* failure cases

---

### 🧩 Skills

* Context selection
* Suggestion generation
* Chat response

---

### 🤖 Subagents

* Suggestion Agent
* Chat Agent

---

### 🛡️ Hooks

* Quality guard ensures:

  * exactly 3 suggestions
  * diversity
  * no generic outputs

---

## ⚙️ Tech Stack

### Frontend

* Next.js (App Router)
* React
* TailwindCSS

### Backend

* Next.js API routes
* Node.js

### AI / Models

* **Groq API**

  * Whisper Large V3 (transcription, English-locked, hallucination-filtered)
  * `meta-llama/llama-4-maverick-17b-128e-instruct` (suggestions + chat, configurable in Settings)

---

## ⚡ Performance Considerations

* Transcript chunking prevents overload
* Limited context window improves speed
* Lightweight prompts reduce latency
* Suggestions generated per cycle

---

## ⚖️ Tradeoffs & Design Decisions

### Why not full transcript for suggestions?

* Reduces relevance
* Increases latency

---

### Why exactly 3 suggestions?

* Avoids cognitive overload
* Forces quality over quantity

---

### Why no database?

* Assignment does not require persistence
* Keeps system simple and fast

---

### Why no turborepo?

* Reduces setup complexity
* Keeps focus on AI + UX

---

## 🧩 What Makes This Different

This is **NOT a simple GPT wrapper**.

Key differences:

* Real-time context slicing
* Timing-aware generation
* Suggestion diversity enforcement
* Action-oriented outputs

Optimized for:
👉 live decision-making

---

## 🛠️ Setup Instructions

```bash
git clone <your-repo>
cd twinmind-clone
npm install
npm run dev
```

Then:

* Open browser
* Add Groq API key
* Start mic

---

## 📌 Assumptions

* No authentication
* No persistent storage
* Session resets on reload

---

## 🔮 If Given More Time

* Streaming transcription (real-time words, not chunks)
* Semantic context selection using embeddings
* Suggestion ranking with confidence scores
* Adaptive refresh (not fixed 30s)
* Speaker diarization
* Chrome extension version

---

## 🧪 Evaluation Alignment

Designed to optimize for:

* ✅ Suggestion Quality
* ✅ Prompt Engineering
* ✅ Real-time UX
* ✅ Code Clarity
* ✅ Low Latency

---

## 🙌 Final Thoughts

This project tackles a deceptively hard problem:

> Generating the *right thought* at the *right moment* during a live conversation.

The challenge is not generation —
it’s **timing, relevance, and usefulness**.

---

## 👨‍💻 Author

**Manas Sisodia**

* 🌐 https://manas-dev.com/
* 💻 https://github.com/Manas2412
