/**
 * Metric calculations for Information Retrieval and System Performance
 */

export function recallAtK(retrievedIds: readonly string[], relevantIds: readonly string[], k: number): number {
  if (relevantIds.length === 0) return 1.0;
  const topK = retrievedIds.slice(0, k);
  const relevantSet = new Set(relevantIds);
  let hits = 0;
  for (const id of topK) {
    if (relevantSet.has(id)) hits++;
  }
  return hits / relevantIds.length;
}

export function meanReciprocalRank(retrievedIds: readonly string[], relevantIds: readonly string[]): number {
  if (relevantIds.length === 0) return 1.0;
  const relevantSet = new Set(relevantIds);
  for (let i = 0; i < retrievedIds.length; i++) {
    if (relevantSet.has(retrievedIds[i])) {
      return 1.0 / (i + 1);
    }
  }
  return 0.0;
}

export function ndcgAtK(
  retrievedIds: readonly string[],
  relevanceMap: Record<string, number>,
  k: number
): number {
  const topK = retrievedIds.slice(0, k);
  let dcg = 0.0;
  for (let i = 0; i < topK.length; i++) {
    const rel = relevanceMap[topK[i]] ?? 0;
    dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
  }

  // Calculate ideal DCG
  const idealRelevances = Object.values(relevanceMap).sort((a, b) => b - a).slice(0, k);
  let idcg = 0.0;
  for (let i = 0; i < idealRelevances.length; i++) {
    idcg += (Math.pow(2, idealRelevances[i]) - 1) / Math.log2(i + 2);
  }

  if (idcg === 0) return 0.0;
  return dcg / idcg;
}

export function calculatePercentiles(values: readonly number[]): {
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
} {
  if (values.length === 0) {
    return { p50: 0, p90: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const getP = (p: number) => {
    const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
    return sorted[idx];
  };

  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    p50: getP(50),
    p90: getP(90),
    p95: getP(95),
    p99: getP(99),
    mean: Number((sum / sorted.length).toFixed(2)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/**
 * Standard token counter approximation (~4 characters per token for English text)
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  // Use character + word blend for accurate LLM token simulation
  const words = text.trim().split(/\s+/).length;
  const chars = text.length;
  return Math.ceil((chars / 4 + words * 1.3) / 2);
}
