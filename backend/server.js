import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { getRagResponse } from "./ragService.js"; 
import voiceRouter from "./voice.js"; 
import cors from "cors";

dotenv.config();

const app = express();
app.use(bodyParser.json());

app.use(cors({
  origin: "http://localhost:3000", 
  methods: ["GET","POST"]
}));

app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("RAGinikanth Backend is running");
});

// RAG endpoint
app.post("/api/ask", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    const response = await getRagResponse(query);
    res.json({ answer: response });
  } catch (error) {
    console.error("Error in /api/ask:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.use("/api/voice", voiceRouter);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
