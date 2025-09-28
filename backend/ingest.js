import fs from "fs";
import dotenv from "dotenv";
import { Pinecone } from "@pinecone-database/pinecone";
import { CohereClient } from "cohere-ai";

dotenv.config();

const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

async function waitForIndexReady(pinecone, indexName, maxWaitTime = 300000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitTime) {
    try {
      const indexDescription = await pinecone.describeIndex(indexName);
      if (indexDescription.status?.ready) {
        console.log(`Index "${indexName}" is ready!`);
        return true;
      }
      console.log(`⏳ Index "${indexName}" initializing...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    } catch {
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  throw new Error(`Index "${indexName}" not ready within timeout`);
}

async function main() {
  try {
    // Initialize Pinecone
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const indexName = "raginikanth-index";

    try {
      await pinecone.describeIndex(indexName);
      console.log(`Index "${indexName}" exists`);
    } catch {
      console.log(`Creating index "${indexName}"`);
      await pinecone.createIndex({
        name: indexName,
        dimension: 1024, 
        metric: "cosine",
        spec: { serverless: { cloud: "aws", region: "us-east-1" } },
      });
      await waitForIndexReady(pinecone, indexName);
    }

    const index = pinecone.index(indexName);

    const faqDocs = JSON.parse(fs.readFileSync("./data/faq.json", "utf-8"));
    console.log(`Loaded ${faqDocs.length} FAQ documents`);

    async function generateEmbedding(text) {
      try {
        const response = await cohere.embed({
          model: "embed-english-v3.0",
          texts: [text],
          inputType: "search_document",
        });
        return response.embeddings[0];
      } catch (err) {
        console.error("Embedding error:", err);
        return null;
      }
    }

    function chunkText(text, maxLength = 300) {
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length);
      const chunks = [];
      let current = "";
      for (const s of sentences) {
        const sentence = s.trim();
        if ((current + sentence).length <= maxLength) {
          current += (current ? ". " : "") + sentence;
        } else {
          if (current) chunks.push(current + ".");
          current = sentence;
        }
      }
      if (current) chunks.push(current + ".");
      return chunks.length ? chunks : [text.substring(0, maxLength)];
    }

    let total = 0;

    for (const doc of faqDocs) {
      const chunks = chunkText(doc.content);
      console.log(`Processing "${doc.title}" with ${chunks.length} chunks`);
      for (let i = 0; i < chunks.length; i++) {
        const vector = await generateEmbedding(chunks[i]);
        if (!vector) continue;

        await index.upsert([{
          id: `${doc.id}-chunk-${i}`,
          values: vector,
          metadata: { docName: doc.title, text: chunks[i] },
        }]);
        total++;
      }
    }

    console.log(`Ingestion complete! Total chunks: ${total}`);
    const stats = await index.describeIndexStats();
    console.log(`Index stats:`, stats);

  } catch (err) {
    console.error("Fatal error:", err);
  }
}

main();
