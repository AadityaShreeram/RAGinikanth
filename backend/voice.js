import express from "express";
import fetch from "node-fetch";
import getMP3Duration from "get-mp3-duration";
import { generateRAGAnswerPipeline } from "./ragService.js";

const voiceRouter = express.Router();

async function generateVoiceResponse(text) {
  try {
    console.log("Generating voice for text:", text.substring(0, 50) + "...");

    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CARTESIA_API_KEY}`,
        "Content-Type": "application/json",
        "Cartesia-Version": "2025-04-16",
      },
      body: JSON.stringify({
        model_id: "sonic-2",
        transcript: text,
        voice: {
          mode: "id",
          id: "613e5172-2e8b-41ff-981b-5d0acdc6ff6c",
        },
        output_format: {
          container: "mp3",
          encoding: "mp3",
          sample_rate: 44100,
        },
        language: "en",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Cartesia TTS error ${response.status}:`, errText);
      throw new Error(`Cartesia TTS error: ${response.status} ${errText}`);
    }

    const buffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(buffer).toString("base64");
    console.log(
      "Voice generation successful, audio size:",
      buffer.byteLength,
      "bytes"
    );

    return base64Audio;
  } catch (err) {
    console.error("TTS generation error:", err);
    return null;
  }
}

async function generateVoiceWithSubtitles(text) {
  const audioBase64 = await generateVoiceResponse(text);
  if (!audioBase64) return null;

  const buffer = Buffer.from(audioBase64, "base64");
  const durationSec = getMP3Duration(buffer) / 1000;

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);

  let currentTime = 0;
  const subtitles = sentences.map((s) => {
    const proportion = s.length / totalChars;
    const sentenceDuration = durationSec * proportion;
    const start = currentTime;
    const end = start + sentenceDuration;
    currentTime = end;
    return { text: s.trim(), start, end };
  });

  return { audioBase64, subtitles, durationSec };
}


voiceRouter.post("/speak", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Text is required" });
    }

    const audioBase64 = await generateVoiceResponse(text);
    if (!audioBase64) {
      return res.status(500).json({ error: "Failed to generate audio" });
    }

    res.json({
      audio: audioBase64,
      format: "mp3",
      encoding: "base64",
    });
  } catch (err) {
    console.error("Error in /speak:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


voiceRouter.post("/ask", async (req, res) => {
  const startTime = Date.now();

  try {
    const { query } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query is required" });
    }

    console.log("Voice RAG request:", query);

    // Step 1: Generate RAG answer
    const { answer, metadata } = await generateRAGAnswerPipeline(query);

    // Step 2: Generate TTS + sentence-level subtitles
    const result = await generateVoiceWithSubtitles(answer);

    res.json({
      answer,
      audio: result?.audioBase64 || null,
      subtitles: result?.subtitles || [],
      durationSec: result?.durationSec || null,
      metadata: {
        ...metadata,
        voiceGenerated: !!result,
        totalResponseTimeMs: Date.now() - startTime,
      },
    });

    console.log(
      `Voice RAG completed in ${Date.now() - startTime}ms`
    );
  } catch (err) {
    console.error("Error in /ask:", err);
    res.status(500).json({
      error: "Internal server error",
      metadata: {
        responseTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
    });
  }
});


voiceRouter.post("/tts", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Text required" });

    const result = await generateVoiceWithSubtitles(text);
    if (!result) return res.status(500).json({ error: "Failed to generate audio" });

    res.json({
      audio: result.audioBase64,
      subtitles: result.subtitles,
      durationSec: result.durationSec,
      success: true,
    });
  } catch (err) {
    console.error("Error in /tts:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


voiceRouter.post("/stt", async (req, res) => {
  try {
    const { audio, format = "mp3" } = req.body;
    if (!audio) return res.status(400).json({ error: "Audio data required" });

    console.log(" STT request received, format:", format);

    const mockTranscript =
      "Hello, this is a mock transcript. Please integrate a real STT service.";

    res.json({
      transcript: mockTranscript,
      confidence: 0.95,
      language: "en",
      warning: "This is a mock response. Please integrate real STT service.",
    });
  } catch (err) {
    console.error("Error in /stt:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

voiceRouter.get("/health", async (req, res) => {
  try {
    const hasCartesiaKey = !!process.env.CARTESIA_API_KEY;

    res.json({
      status: "healthy",
      services: {
        tts: hasCartesiaKey ? "configured" : "missing_api_key",
        stt: "mock_implementation",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Voice health check failed:", err);
    res.status(503).json({
      status: "unhealthy",
      error: "Voice service unavailable",
    });
  }
});

export default voiceRouter;
