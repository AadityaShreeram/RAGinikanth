import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import cors from "cors";
import http from "http";
import { attachVoiceWS } from "./voice-ws.js";
import voiceRouter from "./voice.js";
import { getRagResponse } from "./ragService.js";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
app.use(cors({ origin: FRONTEND_URL, methods: ["GET","POST"] }));

app.get("/", (_, res) => res.send("RAGinikanth Backend is running"));

app.post("/api/ask", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "Query is required" });
  try {
    const response = await getRagResponse(query);
    res.json({ answer: response });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch RAG response" });
  }
});

app.use("/api/voice", voiceRouter);

const server = http.createServer(app);
attachVoiceWS(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
