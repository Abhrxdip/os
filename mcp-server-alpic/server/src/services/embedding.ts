import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate a deterministic normalized 1536-dimensional vector from text.
 * Serves as a resilient fallback when OpenAI API credits are exhausted or unavailable.
 */
const STOP_WORDS = new Set([
  "i", "me", "my", "we", "our", "you", "your", "the", "a", "an", "and", "or",
  "but", "in", "on", "at", "to", "for", "of", "with", "is", "are", "was", "were",
  "be", "been", "being", "have", "has", "had", "do", "does", "did", "this", "that"
]);

function createFallbackVector(text: string): number[] {
  const DIM = 1536;
  const vec = new Array<number>(DIM).fill(0);
  const normalized = text.toLowerCase().replace(/[^\w\s]/g, " ").trim();
  const words = normalized.split(/\s+/).filter((w) => w.length > 0);

  for (const word of words) {
    const isStop = STOP_WORDS.has(word);
    const wordWeight = isStop ? 0.1 : 2.5;

    let wordHash = 0;
    for (let i = 0; i < word.length; i++) {
      wordHash = (wordHash * 31 + word.charCodeAt(i)) >>> 0;
    }
    const idx = wordHash % DIM;
    vec[idx] += wordWeight;

    if (!isStop && word.length >= 2) {
      const nGramLen = word.length === 2 ? 2 : 3;
      for (let i = 0; i <= word.length - nGramLen; i++) {
        let nGramHash = 0;
        for (let j = 0; j < nGramLen; j++) {
          nGramHash = (nGramHash * 37 + word.charCodeAt(i + j)) >>> 0;
        }
        const triIdx = nGramHash % DIM;
        vec[triIdx] += 0.8;
      }
    }
  }

  let sumSq = 0;
  for (let i = 0; i < DIM; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq) || 1.0;
  for (let i = 0; i < DIM; i++) {
    vec[i] = vec[i] / norm;
  }

  return vec;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return createFallbackVector(text);
    }
    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: text,
    });

    return response.data[0].embedding;
  } catch (err) {
    console.warn("OpenAI embeddings API unavailable, using fallback vector:", err instanceof Error ? err.message : String(err));
    return createFallbackVector(text);
  }
}

export async function generateEmbeddings(
  texts: readonly string[]
): Promise<number[][]> {
  if (texts.length === 0) return [];

  try {
    if (!process.env.OPENAI_API_KEY) {
      return texts.map(createFallbackVector);
    }
    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: [...texts],
    });

    return response.data.map((d) => d.embedding);
  } catch (err) {
    console.warn("OpenAI embeddings API unavailable, using fallback vectors:", err instanceof Error ? err.message : String(err));
    return texts.map(createFallbackVector);
  }
}

/**
 * Calculate cosine similarity between two vectors.
 * Used for deduplication check before inserting new memories.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
