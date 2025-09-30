import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { exec } from "child_process";
import FormData from "form-data";
import fetch from "node-fetch";
import getMP3Duration from "get-mp3-duration";
import { WebSocketServer } from "ws";
import { getRagResponse } from "./ragService.js";

const TMP_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function convertWebmToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -i "${inputPath}" -vn -ar 16000 -ac 1 -b:a 96k -preset ultrafast "${outputPath}"`;
    exec(cmd, (err) => (err ? reject(err) : resolve(outputPath)));
  });
}

async function transcribeAudioWithGroq(filePath) {
  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("language", "en");
  formData.append("response_format", "json");
  formData.append("temperature", "0");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, ...formData.getHeaders() },
    body: formData,
  });

  if (!res.ok) throw new Error(`Groq STT error ${res.status}`);
  const result = await res.json();
  return result.text || "";
}

async function generateVoiceResponse(text) {
  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
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

  if (!res.ok) throw new Error(`Cartesia TTS error ${res.status}`);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

let ttsQueue = Promise.resolve();
async function enqueueTTS(text) {
  ttsQueue = ttsQueue.then(async () => {
    await new Promise((r) => setTimeout(r, 200));
    return await generateVoiceResponse(text);
  }).catch((err) => {
    console.error("TTS queue error:", err);
    return null;
  });
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

export function attachVoiceWS(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (req.url === "/ws/voice") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  console.log("WS voice server attached at /ws/voice");

  wss.on("connection", (ws) => {
    const id = uuidv4();
    const sessionDir = path.join(TMP_DIR, id);
    fs.mkdirSync(sessionDir, { recursive: true });

    let accumulatedChunks = [];
    let lastChunkTime = Date.now();
    let closed = false;

    const HEARTBEAT_INTERVAL = 10000; 
    const heartbeatTimer = setInterval(async () => {
      if (closed) return;
      const now = Date.now();
      if (now - lastChunkTime > HEARTBEAT_INTERVAL && accumulatedChunks.length === 0) {
        try {
          const transcript = ".";
          ws.send(JSON.stringify({ type: "stt_result", transcript, final: false }));

          const rag = await getRagResponse(transcript);
          const answer = rag?.answer || "Sorry, I couldn't find an answer.";
          const audio = await enqueueTTS(answer);
          const subtitles = audio
            ? [{ text: answer, start: 0, end: getMP3Duration(Buffer.from(audio, "base64")) / 1000 }]
            : [];

          ws.send(JSON.stringify({ type: "final_response", answer, audio, subtitles }));
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: err.message }));
        }
        lastChunkTime = Date.now();
      }
    }, HEARTBEAT_INTERVAL);

    function cleanup() {
      clearInterval(heartbeatTimer);
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch {}
    }

    ws.on("message", async (raw) => {
      if (closed) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const { type } = msg;

      if (type === "start") {
        accumulatedChunks = [];
        lastChunkTime = Date.now();
        ws.send(JSON.stringify({ type: "ok", message: "started" }));
      } else if (type === "chunk") {
        if (!msg.data) return;
        accumulatedChunks.push(Buffer.from(msg.data, "base64"));
        lastChunkTime = Date.now();
      } else if (type === "end") {
        const webm = path.join(sessionDir, "final.webm");
        const mp3 = path.join(sessionDir, "final.mp3");
        fs.writeFileSync(webm, Buffer.concat(accumulatedChunks));

        try {
          await convertWebmToMp3(webm, mp3);
          const transcript = await transcribeAudioWithGroq(mp3);
          ws.send(JSON.stringify({ type: "stt_result", transcript, final: true }));

          const rag = await getRagResponse(transcript);
          const answer = rag?.answer || "Sorry, I couldn't find an answer.";
          const result = await generateVoiceWithSubtitles(answer);

          ws.send(JSON.stringify({
            type: "final_response",
            answer,
            audio: result?.audioBase64 || null,
            subtitles: result?.subtitles || [],
          }));
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: err.message }));
        } finally {
          cleanup();
          ws.close();
        }
      } else if (type === "stop") {
        cleanup();
        ws.close();
      }
    });

    ws.on("close", () => {
      closed = true;
      cleanup();
    });
  });
}
