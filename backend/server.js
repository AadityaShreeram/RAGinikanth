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
app.use(cors({ origin: "http://localhost:3000", methods: ["GET","POST"] }));

app.get("/", (_, res) => res.send("RAGinikanth Backend is running"));

app.post("/api/ask", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "Query is required" });
  const response = await getRagResponse(query);
  res.json({ answer: response });
});

app.use("/api/voice", voiceRouter);

const server = http.createServer(app);
attachVoiceWS(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
