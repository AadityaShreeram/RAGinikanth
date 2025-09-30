import dotenv from "dotenv";
dotenv.config();

import { Pinecone } from "@pinecone-database/pinecone";
import { CohereClient } from "cohere-ai";
import { getOrderById } from "./orderService.js";

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index("raginikanth-index");
const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

let lastCohereCall = 0;
const COHERE_DELAY_MS = 6500;

async function throttleCohere() {
  const now = Date.now();
  const wait = Math.max(0, lastCohereCall + COHERE_DELAY_MS - now);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCohereCall = Date.now();
}

async function withRetry(fn, retries = 3, delay = 1200) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`⚠️ Cohere call failed: ${err.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function generateQueryEmbedding(text) {
  return withRetry(async () => {
    await throttleCohere();
    const response = await cohere.embed({
      model: "embed-english-v3.0",
      texts: [text],
      inputType: "search_query",
    });
    return response.embeddings[0];
  });
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
  return withRetry(async () => {
    await throttleCohere();

    const context = relevantDocs
      .map((doc, idx) => `Document ${idx + 1}: ${doc.metadata.text}`)
      .join("\n\n");

    const response = await cohere.chat({
      model: "command-xlarge-nightly",
      message: query,
      preamble: `You are Rajinikanth in customer service mode, speaking only in English. 
Just respond with what he says in English. Don’t include actions or extra descriptions.
Use only the FAQ information provided below.

${context}

Instructions:
- Be crisp, helpful, and authoritative.
- Use FAQ content only.
- Tone should be friendly but carry Rajini swag.`,
      max_tokens: 400,
      temperature: 0.2,
    });

    return response.text?.trim() || "I'm sorry, I couldn't generate a response.";
  });
}

function formatOrderForSpeech(order) {
  const dateStr = new Date(order.tracking.estimatedDelivery).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const itemsList = order.items
    .map(it => `${it.quantity} ${it.name}${it.quantity > 1 ? "s" : ""}`)
    .join(" and ");

  return `Your order ${order.orderId} has been ${order.status.toLowerCase()}. ` +
    `It includes ${itemsList}, with a total amount of $${order.totalAmount.toFixed(2)}. ` +
    `The package will be delivered by ${order.tracking.carrier}, tracking number ${order.tracking.trackingNumber}, ` +
    `and is expected to arrive by ${dateStr}.`;
}

async function generateRAGAnswerPipeline(query) {
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
  const match = query.toUpperCase().match(/ORD\d+/);
  if (match) {
    const orderId = match[0].replace(/\?$/, "");
    const order = await getOrderById(orderId);
    if (order) {
      const answer = formatOrderForSpeech(order);
      return { answer, metadata: { source: "mockapi", orderId } };
    } else {
      return { answer: `Sorry, no order found with ID ${orderId}.`, metadata: { source: "mockapi" } };
    }
  }

  return await generateRAGAnswerPipeline(query);
}
