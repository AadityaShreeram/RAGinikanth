import React, { useState, useEffect, useRef } from "react";
import SubtitleDisplay from "./components/SubtitleDisplay";
import "./App.css";

function App() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [audioSrc, setAudioSrc] = useState(null);
  const [subtitles, setSubtitles] = useState([]);
  const [currentSubtitleIndex, setCurrentSubtitleIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState("");

  const audioRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      setIsListening(true);
      setError(""); 

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        
        console.log("Recording stopped, blob size:", blob.size);

        const formData = new FormData();
        formData.append("file", blob, "recording.webm");

        try {
          console.log("Sending audio to STT...");
          const res = await fetch("/api/voice/stt", {
            method: "POST",
            body: formData, 
          });

          const data = await res.json();

          if (!res.ok || data.error) {
            setError("STT failed: " + (data.error || res.statusText));
            console.error("STT error:", data);
            return;
          }

          const transcript = data.transcript || "";
          console.log("Transcript received:", transcript);
          setQuery(transcript);

          if (transcript.trim()) {
            handleAskWithQuery(transcript);
          } else {
            setError("No speech detected. Please try again.");
          }
        } catch (err) {
          console.error("STT request failed:", err);
          setError("Failed to transcribe audio: " + err.message);
        }
      };

      mediaRecorder.start();
      console.log("Recording started...");
    } catch (err) {
      console.error("Mic access error:", err);
      setError("Microphone access denied or unavailable.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      console.log("Stopping recording...");
      
      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
    }
    setIsListening(false);
  };

  const handleVoiceInput = () => {
    if (isListening) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleAskWithQuery = async (questionText = query) => {
    if (!questionText.trim()) return;

    setLoading(true);
    setAnswer("");
    setAudioSrc(null);
    setSubtitles([]);
    setMetadata(null);
    setCurrentSubtitleIndex(0);
    setError("");

    try {
      const res = await fetch("/api/voice/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: questionText }),
      });

      const responseText = await res.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error("JSON parse error:", parseError);
        setError(`Backend returned invalid JSON. Response: ${responseText.substring(0, 200)}`);
        setLoading(false);
        return;
      }

      if (data.error) {
        setError("Error: " + data.error);
        setLoading(false);
        return;
      }

      setAnswer(data.answer || "");
      setMetadata(data.metadata || {});
      setSubtitles(data.subtitles || []);

      if (data.audio) {
        const src = `data:audio/mp3;base64,${data.audio}`;
        setAudioSrc(src);
      }
    } catch (err) {
      console.error("Error connecting to backend:", err);
      setError("Error connecting to backend: " + err.message);
    }

    setLoading(false);
  };

  const handleAsk = () => handleAskWithQuery(query);

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setCurrentSubtitleIndex(0);
    }
  };

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

  useEffect(() => {
    if (!audioRef.current || subtitles.length === 0 || !audioSrc) return;
    const audioEl = audioRef.current;

    const playPromise = audioEl.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => console.error("Audio play failed:", err));
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

      <div className="input-section">
        <textarea
          placeholder="Ask about orders, returns, policy... or use the mic"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
        />

        <div className="button-group">
          <button onClick={handleAsk} disabled={loading || !query.trim()}>
            {loading ? "Thinking..." : "Ask Rajini"}
          </button>

          <button
            onClick={handleVoiceInput}
            disabled={loading}
            className={isListening ? "listening" : ""}
          >
            {isListening ? "Recording..." : "Voice Ask"}
          </button>

          <button onClick={clearAll}>Clear</button>
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

  {isListening && (
    <div className="listening-indicator">
      <span></span>
      <span></span>
      <span></span>
    </div>
  )}

  <SubtitleDisplay
    subtitles={subtitles}
    currentSubtitleIndex={currentSubtitleIndex}
  />

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