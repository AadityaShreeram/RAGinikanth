import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Pinecone } from "@pinecone-database/pinecone";
import { CohereClient } from "cohere-ai";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index("raginikanth-index");
const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

async function generateQueryEmbedding(text) {
  try {
    const response = await cohere.embed({
      model: "embed-english-v3.0",
      texts: [text],
      inputType: "search_query", 
    });
    return response.embeddings[0];
  } catch (err) {
    console.error("Query embedding error:", err);
    return null;
  }
}

async function searchVectorDB(queryEmbedding, topK = 3) {
  try {
    const searchResults = await index.query({
      vector: queryEmbedding,
      topK,
      includeMetadata: true,
    });
    return searchResults.matches || [];
  } catch (err) {
    console.error("Vector search error:", err);
    return [];
  }
}

// Generate answer using RAG with NEW CHAT API
async function generateRAGAnswer(query, relevantDocs) {
  if (!relevantDocs.length) {
    return "I apologize, but I couldn't find relevant information in our FAQ to answer your question. Please contact our support team for personalized assistance.";
  }

  // Prepare context from retrieved documents
  const context = relevantDocs
    .map((doc, idx) => `Document ${idx + 1}: ${doc.metadata.text}`)
    .join("\n\n");

  try {
    console.log("Using Cohere Chat API for generation...");
    
    const response = await cohere.chat({
      model: "command-a-03-2025",
      message: query,
      preamble: `You are a helpful customer service assistant. Answer the customer's question using ONLY the information provided below. Even if the similarity seems low, find the most relevant information to help answer their question.

Available Information from FAQ:
${context}

Instructions:
- Use the available information to provide the best possible answer
- If multiple documents are relevant, combine the information
- Be helpful and comprehensive while staying within the provided information
- If the question is asked in a different way than the FAQ, still use the relevant FAQ content
- Always try to provide a useful answer based on what's available
- Maintain a friendly, professional customer service tone`,
      maxTokens: 400,
      temperature: 0.2,
    });

    console.log("Chat API response received successfully");
    return response.text?.trim() || "I'm sorry, I couldn't generate a response at this time.";
  } catch (err) {
    console.error("Generation error:", err);
    console.error("Error details:", err.message);
    return "I apologize, but I'm experiencing technical difficulties. Please try again later or contact our support team.";
  }
}

function detectIntent(query) {
  const lower = query.toLowerCase();
  if (lower.includes("return") || lower.includes("refund")) return "returns";
  if (lower.includes("order") && (lower.includes("status") || lower.includes("track"))) return "order_status";
  if (lower.includes("shipping") || lower.includes("delivery")) return "shipping";
  if (lower.includes("payment") || lower.includes("billing")) return "payment";
  if (lower.includes("account") || lower.includes("login")) return "account";
  return "general";
}

app.get("/ping", (req, res) => {
  res.json({ 
    message: "RAGinikanth server running!", 
    timestamp: new Date().toISOString(),
    status: "healthy"
  });
});

app.post("/ask", async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { query } = req.body;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ 
        error: "Query is required and must be a string" 
      });
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      return res.status(400).json({ 
        error: "Query cannot be empty" 
      });
    }

    console.log(`🔍 Processing query: "${trimmedQuery}"`);

    // Step 1: Generate query embedding
    const queryEmbedding = await generateQueryEmbedding(trimmedQuery);
    if (!queryEmbedding) {
      return res.status(500).json({ 
        error: "Failed to process query. Please try again." 
      });
    }

    // Step 2: Search vector database - cast wider net for FAQ coverage
    const relevantDocs = await searchVectorDB(queryEmbedding, 8); 
    console.log(`Found ${relevantDocs.length} relevant documents`);

    const docsToUse = relevantDocs.slice(0, 5); 
    console.log(`Using top ${docsToUse.length} documents for context`);

    // Step 3: Generate answer using RAG
    const answer = await generateRAGAnswer(trimmedQuery, docsToUse);

    // Step 4: Prepare response with metadata
    const responseTime = Date.now() - startTime;
    const intent = detectIntent(trimmedQuery);

    const response = {
      answer,
      metadata: {
        intent,
        documentsFound: relevantDocs.length,
        documentsUsed: docsToUse.length,
        responseTimeMs: responseTime,
        sources: docsToUse.map(doc => ({
          title: doc.metadata.docName,
          relevanceScore: Math.round(doc.score * 100) / 100,
          snippet: doc.metadata.text.substring(0, 100) + "..."
        }))
      }
    };

    console.log(`Query processed successfully in ${responseTime}ms`);
    res.json(response);

  } catch (err) {
    console.error("Error in /ask endpoint:", err);
    const responseTime = Date.now() - startTime;
    
    res.status(500).json({ 
      error: "Internal server error. Please try again later.",
      metadata: {
        responseTimeMs: responseTime,
        timestamp: new Date().toISOString()
      }
    });
  }
});

app.get("/health", async (req, res) => {
  try {
    const indexStats = await index.describeIndexStats();
    
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {
        server: "running",
        pinecone: "connected",
        cohere: "initialized",
      },
      indexStats: {
        totalVectors: indexStats.totalVectorCount || 0,
        dimension: indexStats.dimension || "unknown"
      }
    });
  } catch (err) {
    console.error("Health check failed:", err);
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: "Service unavailable"
    });
  }
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`RAGinikanth server running at http://localhost:${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  console.log(`Using Cohere Chat API (new version)`);
});

export default app;