/**
 * Vector operations and embeddings engine matching SelfOS
 */

export const EMBEDDING_DIMENSION = 1536;

const STOP_WORDS = new Set([
  "i", "me", "my", "we", "our", "you", "your", "the", "a", "an", "and", "or",
  "but", "in", "on", "at", "to", "for", "of", "with", "is", "are", "was", "were",
  "be", "been", "being", "have", "has", "had", "do", "does", "did", "this", "that"
]);

export function generateDeterministicVector(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  const normalized = text.toLowerCase().replace(/[^\w\s]/g, " ").trim();
  const words = normalized.split(/\s+/).filter((w) => w.length > 0);

  for (const word of words) {
    const isStop = STOP_WORDS.has(word);
    const wordWeight = isStop ? 0.1 : 2.5;

    // 1. Full word hash
    let wordHash = 0;
    for (let i = 0; i < word.length; i++) {
      wordHash = (wordHash * 31 + word.charCodeAt(i)) >>> 0;
    }
    const idx = wordHash % EMBEDDING_DIMENSION;
    vec[idx] += wordWeight;

    // 2. Character 2-grams and 3-grams for morphology and technical acronyms (e.g. js, ts, pr, ai)
    if (!isStop && word.length >= 2) {
      const nGramLen = word.length === 2 ? 2 : 3;
      for (let i = 0; i <= word.length - nGramLen; i++) {
        let nGramHash = 0;
        for (let j = 0; j < nGramLen; j++) {
          nGramHash = (nGramHash * 37 + word.charCodeAt(i + j)) >>> 0;
        }
        const nGramIdx = nGramHash % EMBEDDING_DIMENSION;
        vec[nGramIdx] += 0.8;
      }
    }
  }

  // L2 normalize
  let sumSq = 0;
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq) || 1.0;
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    vec[i] = vec[i] / norm;
  }
  return vec;
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Reciprocal Rank Fusion (RRF) for combining Dense Vector + BM25 keyword rankings
 */
export function reciprocalRankFusion(
  rankedLists: readonly (readonly string[])[],
  k: number = 60
): readonly { readonly id: string; readonly rrfScore: number }[] {
  const scores = new Map<string, number>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank];
      const prev = scores.get(id) ?? 0;
      scores.set(id, prev + 1.0 / (k + rank + 1));
    }
  }

  const results = Array.from(scores.entries()).map(([id, rrfScore]) => ({
    id,
    rrfScore,
  }));

  results.sort((a, b) => b.rrfScore - a.rrfScore);
  return results;
}
