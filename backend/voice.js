import express from "express";
import fetch from "node-fetch";
import getMP3Duration from "get-mp3-duration";
import multer from "multer";
import fs from "fs";
import FormData from "form-data";
import { generateRAGAnswerPipeline } from "./ragService.js";
import { exec } from "child_process";
import path from "path";

const voiceRouter = express.Router();
const upload = multer({ dest: "uploads/" });

function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -i "${inputPath}" -vn -ar 44100 -ac 2 -b:a 192k "${outputPath}"`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error("FFmpeg conversion error:", stderr);
        reject(err);
      } else {
        resolve(outputPath);
      }
    });
  });
}
async function generateVoiceResponse(text) {
  try {
    console.log("Generating voice for text:", text.substring(0, 50) + "...");

    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CARTESIA_API_KEY}`,
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
    console.log("Voice generation successful, audio size:", buffer.byteLength, "bytes");

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

async function transcribeAudioWithGroq(filePath) {
  try {
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));
    formData.append("model", "whisper-large-v3-turbo");
    formData.append("language", "en");
    formData.append("response_format", "json");

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Groq STT error ${response.status}:`, errText);
      throw new Error(`Groq STT error: ${response.status}`);
    }

    const result = await response.json();
    return result.text;
  } catch (err) {
    console.error("Groq transcription error:", err);
    throw err;
  }
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

    const { answer, metadata } = await generateRAGAnswerPipeline(query);
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

    console.log(`Voice RAG completed in ${Date.now() - startTime}ms`);
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

voiceRouter.post("/stt", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    const inputPath = req.file.path;
    const outputPath = path.join("uploads", `${Date.now()}.mp3`);

    console.log("🎤 Received:", req.file.originalname, "-> converting to mp3...");

    await convertToMp3(inputPath, outputPath);

    const transcript = await transcribeAudioWithGroq(outputPath);

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    res.json({
      transcript,
      language: "en",
      provider: "groq",
      model: "whisper-large-v3-turbo",
    });
  } catch (err) {
    console.error("Error in /stt:", err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: "Failed to transcribe audio", details: err.message });
  }
});

voiceRouter.get("/health", async (req, res) => {
  try {
    const hasCartesiaKey = !!process.env.CARTESIA_API_KEY;
    const hasGroqKey = !!process.env.GROQ_API_KEY;

    res.json({
      status: "healthy",
      services: {
        tts: hasCartesiaKey ? "configured" : "missing_api_key",
        stt: hasGroqKey ? "groq_enabled" : "missing_api_key",
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