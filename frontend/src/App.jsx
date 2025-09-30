import React, { useState, useEffect, useRef } from "react";
import SubtitleDisplay from "./components/SubtitleDisplay";
import "./App.css";

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result.split(",")[1]);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const API_BASE = import.meta.env.VITE_BACKEND_URL;
function App() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [audioSrc, setAudioSrc] = useState(null);
  const [subtitles, setSubtitles] = useState([]);
  const [currentSubtitleIndex, setCurrentSubtitleIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [isConversationActive, setIsConversationActive] = useState(false);
  const [conversationState, setConversationState] = useState("idle"); 
  const [error, setError] = useState("");

  const audioRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const wsRef = useRef(null);
  const chunksRef = useRef([]);
  const isConversationActiveRef = useRef(false);
  const startRecordingRef = useRef(null);
  const silenceTimeoutRef = useRef(null);

  useEffect(() => { isConversationActiveRef.current = isConversationActive; }, [isConversationActive]);
  const openWs = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return wsRef.current;
       const ws = new WebSocket(`${API_BASE.replace(/^http/, "ws")}/ws/voice`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      console.log("WS open");
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleWsMessage(msg);
      } catch (err) {
        console.warn("WS message parse error", err);
      }
    };
    ws.onerror = (err) => {
      console.error("WS error", err);
      setError("WebSocket error");
    };
    ws.onclose = () => {
      console.log("WS closed");
    };
    wsRef.current = ws;
    return ws;
  };

  const handleWsMessage = (msg) => {
    const { type } = msg;
    if (type === "partial_transcript") {
      setQuery(msg.transcript || "");
    } else if (type === "stt_result") {
      setQuery(msg.transcript || "");
      if (msg.final) {
      }
    } else if (type === "processing") {
      setConversationState("processing");
    } else if (type === "final_response") {
      const { answer: a, audio, subtitles: subs, metadata: md } = msg;
      setAnswer(a || "");
      setSubtitles(subs || []);
      setMetadata(md || {});
      if (audio) {
        setAudioSrc(`data:audio/mp3;base64,${audio}`);
        setConversationState("speaking");
      } else {
        setConversationState("idle");
        if (isConversationActiveRef.current) {
          setTimeout(() => startRecordingRef.current && startRecordingRef.current(), 500);
        }
      }
      setLoading(false);
    } else if (type === "error") {
      setError(msg.message || "Server error");
      setLoading(false);
      setConversationState("idle");
    } else if (type === "ok") {
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
let options = {};
if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
  options = { mimeType: "audio/webm;codecs=opus" };
} else if (MediaRecorder.isTypeSupported("audio/webm")) {
  options = { mimeType: "audio/webm" };
} else if (MediaRecorder.isTypeSupported("audio/mp4")) {
  options = { mimeType: "audio/mp4" };
} else {
  options = {};
}

const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      const ws = openWs();
      const waitForOpen = () => new Promise((resolve, reject) => {
        if (ws.readyState === WebSocket.OPEN) return resolve();
        const onopen = () => { ws.removeEventListener("open", onopen); resolve(); };
        const to = setTimeout(() => reject(new Error("ws_open_timeout")), 3000);
        ws.addEventListener("open", onopen);
      });

      await waitForOpen();

      ws.send(JSON.stringify({ type: "start", meta: { language: "en" } }));

      mediaRecorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
          const b64 = await blobToBase64(e.data);
          ws.send(JSON.stringify({ type: "chunk", data: b64 }));
        }
      };

      mediaRecorder.onstop = () => {
        try {
          ws.send(JSON.stringify({ type: "end" }));
        } catch (e) { console.warn("ws send end failed", e); }
        if (mediaRecorderRef.current && mediaRecorderRef.current.stream) {
          mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
        }
        setIsListening(false);
      };

      mediaRecorder.start(250); 
      setIsListening(true);
      setConversationState("listening");
      setError("");

      silenceTimeoutRef.current = setTimeout(() => {
        if (mediaRecorder.state === "recording") stopRecording();
      }, 10000);
    } catch (err) {
  console.error("Mic init error:", err);
  setError("Microphone init failed: " + err.message);
  setIsListening(false);
  setConversationState("idle");
    }
  };

  useEffect(() => { startRecordingRef.current = startRecording; });

  const stopRecording = () => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
    setConversationState("processing");
  };

  const startConversation = () => {
    setIsConversationActive(true);
    setError("");
    startRecording();
  };

  const stopConversation = () => {
    setIsConversationActive(false);
    stopRecording();
    setConversationState("idle");
    if (audioRef.current) audioRef.current.pause();
    if (wsRef.current) {
      try { wsRef.current.send(JSON.stringify({ type: "stop" })); } catch(e){}
      try { wsRef.current.close(); } catch(e){}
    }
  };

  const handleAskWithQuery = async (questionText = query) => {
    if (!questionText.trim()) return;
    setLoading(true);
    setConversationState("processing");
    setAnswer("");
    setAudioSrc(null);
    setSubtitles([]);
    setMetadata(null);
    setCurrentSubtitleIndex(0);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/api/voice/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: questionText }),
      });
      const data = await res.json();
      if (data.error) {
        setError("Error: " + data.error);
        setConversationState("idle");
        setLoading(false);
        return;
      }
      setAnswer(data.answer || "");
      setMetadata(data.metadata || {});
      setSubtitles(data.subtitles || []);
      if (data.audio) {
        const src = `data:audio/mp3;base64,${data.audio}`;
        setAudioSrc(src);
        setConversationState("speaking");
      } else {
        setConversationState("idle");
      }
    } catch (err) {
      console.error("Error connecting to backend:", err);
      setError("Error connecting to backend: " + err.message);
      setConversationState("idle");
    }
    setLoading(false);
  };

  const handleVoiceInput = () => {
    if (isListening) stopRecording();
    else startRecording();
  };

  const handleAsk = () => handleAskWithQuery(query);

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setCurrentSubtitleIndex(0);
    }
  };

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    const handleAudioEnd = () => {
      setConversationState("idle");
      if (isConversationActiveRef.current) {
        setTimeout(() => {
          if (isConversationActiveRef.current) startRecordingRef.current();
        }, 500);
      }
    };
    audioEl.addEventListener("ended", handleAudioEnd);
    return () => audioEl.removeEventListener("ended", handleAudioEnd);
  }, [audioSrc]);

  useEffect(() => {
    if (!audioRef.current || subtitles.length === 0 || !audioSrc) return;
    const audioEl = audioRef.current;
    const playPromise = audioEl.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.error("Audio play failed:", err);
        setConversationState("idle");
        if (isConversationActiveRef.current) {
          setTimeout(() => startRecordingRef.current(), 1000);
        }
      });
    }
    let animationFrame;
    const updateSubtitle = () => {
      const currentTime = audioEl.currentTime;
      const currentIndex = subtitles.findIndex(
        (s) => currentTime >= s.start && currentTime < s.end
      );
      setCurrentSubtitleIndex(currentIndex === -1 ? 0 : currentIndex);
      animationFrame = requestAnimationFrame(updateSubtitle);
    };
    animationFrame = requestAnimationFrame(updateSubtitle);
    return () => cancelAnimationFrame(animationFrame);
  }, [audioSrc, subtitles]);

  const clearError = () => setError("");
  const clearAll = () => {
    setQuery("");
    setAnswer("");
    setAudioSrc(null);
    setSubtitles([]);
    setMetadata(null);
    setCurrentSubtitleIndex(0);
    setError("");
  };

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-content">
          <div className="header-text">
            <h1>RAGinikanth</h1>
            <p className="subtitle">Your voice support boss — voice-enabled RAG assistant</p>
          </div>
        </div>
      </header>

      <div className="conversation-control">
        {!isConversationActive ? (
          <button onClick={startConversation} className="start-conversation-btn">🎙️ Start Conversation</button>
        ) : (
          <button onClick={stopConversation} className="stop-conversation-btn">⏹️ End Conversation</button>
        )}

        {isConversationActive && (
          <div className="status-indicator">
            {conversationState === "listening" && <span className="status listening"><span className="pulse"></span>Listening...</span>}
            {conversationState === "processing" && <span className="status processing"><span className="spinner"></span>Thinking...</span>}
            {conversationState === "speaking" && <span className="status speaking"><span className="sound-wave"></span>Speaking...</span>}
          </div>
        )}
      </div>

      <div className="input-section">
        <textarea
          placeholder="Ask about orders, returns, policy... or use voice"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading || isConversationActive}
        />
        <div className="button-group">
          <button onClick={handleAsk} disabled={loading || !query.trim() || isConversationActive}>
            {loading ? "Thinking..." : "Ask RAGinikanth"}
          </button>

          <button onClick={handleVoiceInput} disabled={loading || isConversationActive} className={isListening ? "listening" : ""}>
            {isListening ? "Recording..." : "Voice Ask"}
          </button>

          <button onClick={clearAll} disabled={isConversationActive}>Clear</button>
        </div>

        {error && <div className="error-section"><p>{error}</p><button onClick={clearError}>×</button></div>}
      </div>

      <div className="response-panel">
        <h2>RAGinikanth's Response</h2>

        {conversationState === "listening" && (
          <div className="listening-loader">
            <div className="sound-bars"><span></span><span></span><span></span><span></span><span></span></div>
            <p>Listening to your question...</p>
          </div>
        )}
        {conversationState === "processing" && (
          <div className="processing-loader">
            <div className="brain-loader"><div className="brain-pulse"></div></div>
            <p>Generating response...</p>
          </div>
        )}

        <SubtitleDisplay subtitles={subtitles} currentSubtitleIndex={currentSubtitleIndex} />

        {audioSrc && (
          <div className="audio-section">
            <audio ref={audioRef} src={audioSrc} controls className="audio-player" />
            <button onClick={stopAudio} className="stop-button">Stop Audio</button>
          </div>
        )}
      </div>

      <style jsx>{`
        .conversation-control {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          margin: 2rem 0;
        }

        .start-conversation-btn,
        .stop-conversation-btn {
          padding: 1rem 2rem;
          font-size: 1.2rem;
          font-weight: bold;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        .start-conversation-btn {
          background: linear-gradient(135deg, #10b981, #059669);
          color: white;
        }

        .start-conversation-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 12px rgba(16, 185, 129, 0.3);
        }

        .stop-conversation-btn {
          background: linear-gradient(135deg, #ef4444, #dc2626);
          color: white;
        }

        .stop-conversation-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 12px rgba(239, 68, 68, 0.3);
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          font-weight: 600;
          font-size: 0.9rem;
        }

        .status.listening {
          background: rgba(59, 130, 246, 0.1);
          color: #3b82f6;
        }

        .status.processing {
          background: rgba(251, 191, 36, 0.1);
          color: #f59e0b;
        }

        .status.speaking {
          background: rgba(16, 185, 129, 0.1);
          color: #10b981;
        }

        .pulse {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #3b82f6;
          animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }

        .spinner {
          width: 12px;
          height: 12px;
          border: 2px solid #f59e0b;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .sound-wave {
          width: 12px;
          height: 12px;
          background: #10b981;
          border-radius: 50%;
          animation: soundWave 1s ease-in-out infinite;
        }

        @keyframes soundWave {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.7; }
        }

        .listening-loader,
        .processing-loader {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          padding: 2rem;
          margin: 2rem 0;
        }

        .sound-bars {
          display: flex;
          align-items: flex-end;
          gap: 4px;
          height: 40px;
        }

        .sound-bars span {
          width: 4px;
          background: #3b82f6;
          border-radius: 2px;
          animation: soundBar 0.8s ease-in-out infinite;
        }

        .sound-bars span:nth-child(1) { animation-delay: 0s; }
        .sound-bars span:nth-child(2) { animation-delay: 0.1s; }
        .sound-bars span:nth-child(3) { animation-delay: 0.2s; }
        .sound-bars span:nth-child(4) { animation-delay: 0.3s; }
        .sound-bars span:nth-child(5) { animation-delay: 0.4s; }

        @keyframes soundBar {
          0%, 100% { height: 10px; }
          50% { height: 40px; }
        }

        .brain-loader {
          position: relative;
          width: 60px;
          height: 60px;
        }

        .brain-pulse {
          position: absolute;
          width: 100%;
          height: 100%;
          border: 4px solid #f59e0b;
          border-radius: 50%;
          animation: brainPulse 1.5s ease-out infinite;
        }

        @keyframes brainPulse {
          0% {
            transform: scale(0.5);
            opacity: 1;
          }
          100% {
            transform: scale(1.2);
            opacity: 0;
          }
        }

        .listening-loader p,
        .processing-loader p {
          color: #9ca3af;
          font-size: 0.9rem;
          margin: 0;
        }
      `}</style>
    </div>
  );
}

export default App;
