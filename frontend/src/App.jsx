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
          <button onClick={startConversation} className="start-conversation-btn">
            🎙️ Start Hands-Free Conversation
          </button>
        ) : (
          <button onClick={stopConversation} className="stop-conversation-btn">
            ⏹️ End Hands-Free Conversation
          </button>
        )}
        <div className="status-bar">
          {conversationState === "listening" && (
            <div className="status-pill listening">
              <span className="dot"></span> 🎤 Listening...
            </div>
          )}
          {conversationState === "processing" && (
            <div className="status-pill processing">
              <span className="spinner"></span> 🧠 Thinking...
            </div>
          )}
          {conversationState === "speaking" && (
            <div className="status-pill speaking">
              <span className="wave"></span> 🗣 Speaking...
            </div>
          )}
          {conversationState === "idle" && (
            <div className="status-pill idle">
              <span className="dot gray"></span> 💤 Idle
            </div>
          )}
        </div>
      </div>

      <div className="transcription-container">
        <div className="transcript-display">
          <p>{query || "Speak something to start..."}</p>
        </div>

        <div className="button-group center-buttons">

          <button onClick={clearAll} disabled={isConversationActive} className="clear-btn">
            🧹 Clear
          </button>
        </div>

        {error && (
          <div className="error-section">
            <p>{error}</p>
            <button onClick={clearError}>×</button>
          </div>
        )}
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
    </div>
  );
}

export default App;