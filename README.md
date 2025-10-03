# 🎤 RAGinikanth — Voice-Enabled RAG Assistant

A Retrieval-Augmented Generation (RAG) project named **“RAGinikanth”** — combining retrieval and generation capabilities for intelligent responses.
It answers user queries using FAQ data, provides spoken responses, and supports **hands-free voice interactions** with automatic transcription and text-to-speech.

---

## 🚀 Features

### 🎙️ Voice & Text Interaction
- Real-time voice recording and transcription  
- Text query input  

### 🧠 RAG-Based Answering
- Answers queries using FAQ content  
- Handles order-specific queries via mock API integration  

### 🔊 Voice Response
- Generates MP3 audio responses with synchronized subtitles  
- Uses **Cartesia TTS** and **Groq STT** APIs  

### 🔗 WebSocket Support
- Real-time conversation with streaming audio chunks  

### 👐 Hands-Free Conversation Mode
- Continuous interaction without manual input  
---

## 📂 Project Structure

```bash
RAGinikanth/
├── backend/
│ ├── data/ # FAQ documents
│ ├── env # Environment variable template
│ ├── ingest.js # Ingest FAQ into Pinecone vector DB
│ ├── orderService.js # Mock order fetch logic
│ ├── ragService.js # RAG pipeline & response generation
│ ├── server.js # Express server
│ ├── voice.js # REST voice endpoints
│ └── voice-ws.js # WebSocket voice streaming
├── frontend/
│ ├── src/
│ │ ├── App.jsx # Main React app
│ │ ├── components/
│ │ │ └── SubtitleDisplay.jsx
│ │ └── App.css # Styles
│ └── package.json
├── package.json
└── README.md

```
## 🛠 Tech Stack

**Backend**
- Node.js + Express  
- Pinecone (vector database)  
- Cohere AI (embeddings & chat)  
- Groq API (speech-to-text)  
- Cartesia API (text-to-speech)  

**Frontend**
- React 18  
- HTML5 Audio API  
- WebSockets for real-time voice streaming  

---

## ⚙️ Setup

### 1️⃣ Clone the Repository
```bash
git clone https://github.com/AadityaShreeram/RAGinikanth.git
cd RAGinikanth
```

### 2️⃣ Backend Setup
```bash

cd backend
npm install
```
Create a .env file with your API keys:
```bash

# Cohere
COHERE_API_KEY=your-cohere-api-key-here

# Pinecone
PINECONE_API_KEY=your-pinecone-api-key-here
PINECONE_ENVIRONMENT=us-east-1

# Groq STT
GROQ_API_KEY=your-groq-api-key-here

# Cartesia TTS
CARTESIA_API_KEY=your-cartesia-api-key-here
```
### 3️⃣ Ingest FAQ Data
```bash
node ingest.js
```
### 4️⃣ Start Backend
```bash
node server.js
```
Backend runs on http://localhost:5000

### 5️⃣ Frontend Setup
```bash
cd frontend
npm install
```
Create a .env file in the frontend directory:
```bash
VITE_BACKEND_URL=http://localhost:5000
```

Start the development server:
```bash
npm run dev
```
### 📋 Usage

- Start hands-free conversation by clicking 🎙️ Start Hands-Free Conversation
- Speak your query — it will be transcribed in real-time
- Receive RAGinikanth’s response with audio playback and subtitles
- Stop conversation anytime with ⏹️ End Hands-Free Conversation

### RAG Pipeline

- Embeds query via Cohere AI
- Searches Pinecone vector DB for top-matched FAQ chunks
- Generates a response using Cohere Chat with Rajinikanth persona
  
### Voice Handling

- Audio chunks are converted to MP3
- STT via Groq API
- TTS via Cartesia API with subtitles

### 🌍 Deployment

```bash
Backend → Deployed on Render

Frontend → Vite app deployed on Vercel
```

### 🛠 Scripts
## Backend
```bash
npm run dev    # Start backend with hot reload
node ingest.js # Load FAQ docs into Pinecone
```
## Frontend
```bash
npm run dev    # Start React app
```

---

### 📌 Demo

Frontend: https://rag-inikanth.vercel.app/

Backend: https://raginikanth.onrender.com

---

## ⚠️ Important: Waking Up the Backend (Free Tier)

Since I'm using **Render's free tier**, the backend server spins down after 15 minutes of inactivity. Before using the application, you need to wake it up:

### Wake Up Command
```bash
# Install wscat (one-time setup)
npm install -g wscat

# Wake up my deployed backend
wscat -c wss://raginikanth.onrender.com/ws/voice
```
Press Ctrl+C after connecting. The backend should now be active!


Alternative: Quick Health Check
You can also wake it up by visiting:
```bash
https://raginikanth.onrender.com/health
```
Or using curl:
```bash
curl https://raginikanth.onrender.com/health
```
## Acknowledgments

- **Cohere AI** for powerful embeddings and chat models
- **Pinecone** for scalable vector database
- **Groq** for fast speech-to-text processing
- **Cartesia** for natural text-to-speech synthesis

Thanks for your time!!
