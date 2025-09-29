import dotenv from "dotenv";
dotenv.config();

import { Pinecone } from "@pinecone-database/pinecone";
import { CohereClient } from "cohere-ai";

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index("raginikanth-index");
const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

async function generateQueryEmbedding(text) {
  const response = await cohere.embed({
    model: "embed-english-v3.0",
    texts: [text],
    inputType: "search_query",
  });
  return response.embeddings[0];
}

async function searchVectorDB(queryEmbedding, topK = 5) {
  const searchResults = await index.query({
    vector: queryEmbedding,
    topK,
    includeMetadata: true,
  });
  return searchResults.matches || [];
}

async function generateRAGAnswer(query, relevantDocs) {
  const context = relevantDocs
    .map((doc, idx) => `Document ${idx + 1}: ${doc.metadata.text}`)
    .join("\n\n");

  const response = await cohere.chat({
    model: "command-a-03-2025",
    message: query,
    preamble: `You are Rajinikanth in customer service mode, speaking only in English with voice enabled. Just respond with what he says in English.Don’t include actions or extra descriptions, since the response will be converted to audio. Use only the FAQ information provided below.

${context}

Instructions:
- Be crisp, helpful, and authoritative.
- Use FAQ content only.
- Tone should be friendly but carry Rajini swag.`,
    maxTokens: 400,
    temperature: 0.2,
  });

  return response.text?.trim() || "I'm sorry, I couldn't generate a response.";
}

export async function generateRAGAnswerPipeline(query) {
  const queryEmbedding = await generateQueryEmbedding(query);
  const relevantDocs = await searchVectorDB(queryEmbedding, 8);
  const docsToUse = relevantDocs.slice(0, 5);

  const answer = await generateRAGAnswer(query, docsToUse);

  return {
    answer,
    metadata: {
      documentsFound: relevantDocs.length,
      documentsUsed: docsToUse.length,
      sources: docsToUse.map(doc => ({
        title: doc.metadata.docName,
        snippet: doc.metadata.text.substring(0, 80) + "...",
      })),
    },
  };
}

export async function getRagResponse(query) {
  const result = await generateRAGAnswerPipeline(query);
  return result;
}