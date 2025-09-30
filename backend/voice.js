import express from "express";
import fetch from "node-fetch";
import getMP3Duration from "get-mp3-duration";
import multer from "multer";
import fs from "fs";
import FormData from "form-data";
import { exec } from "child_process";
import path from "path";
import { getRagResponse } from "./ragService.js";

const voiceRouter = express.Router();
const upload = multer({ dest: "uploads/" });

function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -i "${inputPath}" -vn -ar 16000 -ac 1 -b:a 96k -preset ultrafast "${outputPath}"`;
    exec(cmd, (err) => {
      if (err) reject(err);
      else resolve(outputPath);
    });
  });
}

async function withRetry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } 
    catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function transcribeAudioWithGroq(filePath) {
  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("language", "en");
  formData.append("response_format", "json");
  formData.append("temperature", "0");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, ...formData.getHeaders() },
    body: formData,
  });

  if (!response.ok) throw new Error(`Groq STT error: ${response.status}`);
  const result = await response.json();
  return result.text;
}

async function generateVoiceResponse(text) {
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
      voice: { mode: "id", id: "613e5172-2e8b-41ff-981b-5d0acdc6ff6c" },
      output_format: { container: "mp3", encoding: "mp3", sample_rate: 44100 },
      language: "en",
    }),
  });

  if (!response.ok) throw new Error(`Cartesia TTS error: ${response.status}`);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

let ttsQueue = Promise.resolve();
async function enqueueTTS(text) {
  ttsQueue = ttsQueue.then(async () => {
    await new Promise(r => setTimeout(r, 300));
    return await withRetry(() => generateVoiceResponse(text));
  }).catch(err => { console.error("TTS queue error:", err); return null; });
  return ttsQueue;
}

async function generateVoiceWithSubtitles(text) {
  const audioBase64 = await enqueueTTS(text);
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

voiceRouter.post("/ask", async (req, res) => {
  const startTime = Date.now();
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Query is required" });

    const { answer, metadata } = await getRagResponse(query);
    const result = await generateVoiceWithSubtitles(answer);

    res.json({
      answer,
      audio: result?.audioBase64 || null,
      subtitles: result?.subtitles || [],
      durationSec: result?.durationSec || null,
      metadata: { ...metadata, voiceGenerated: !!result, totalResponseTimeMs: Date.now() - startTime },
    });
  } catch (err) {
    console.error("Error in /ask:", err);
    res.status(500).json({ error: "Internal server error" });
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
  const startTime = Date.now();
  try {
    if (!req.file) return res.status(400).json({ error: "No audio file uploaded" });

    const inputPath = req.file.path;
    const outputPath = path.join("uploads", `${Date.now()}.mp3`);

    await convertToMp3(inputPath, outputPath);
    const transcript = await transcribeAudioWithGroq(outputPath);

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    res.json({ transcript, language: "en", provider: "groq", model: "whisper-large-v3-turbo", processingTimeMs: Date.now() - startTime });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: "Failed to transcribe audio", details: err.message });
  }
});

voiceRouter.get("/health", async (req, res) => {
  res.json({
    status: "healthy",
    services: {
      tts: process.env.CARTESIA_API_KEY ? "configured" : "missing_api_key",
      stt: process.env.GROQ_API_KEY ? "groq_enabled" : "missing_api_key",
    },
    timestamp: new Date().toISOString(),
  });
});

export default voiceRouter;
