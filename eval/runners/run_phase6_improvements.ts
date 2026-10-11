import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BM25 } from "../lib/bm25.js";
import { generateDeterministicVector, cosineSimilarity, reciprocalRankFusion } from "../lib/vector.js";
import { recallAtK, meanReciprocalRank, ndcgAtK } from "../lib/metrics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ImprovementResult {
  readonly technique: string;
  readonly recallAt5: number;
  readonly mrr: number;
  readonly ndcgAt5: number;
  readonly liftRecallPct: number;
  readonly liftMrrPct: number;
  readonly label: "MEASURED";
}

export function runPhase6Improvements(): readonly ImprovementResult[] {
  const memoriesPath = join(__dirname, "../fixtures/ground_truth_memories.json");
  const queriesPath = join(__dirname, "../fixtures/retrieval_queries.json");

  const memories = JSON.parse(readFileSync(memoriesPath, "utf-8"));
  const queries = JSON.parse(readFileSync(queriesPath, "utf-8"));

  const memoryVectors = memories.map((m: any) => ({
    id: m.id,
    content: m.content,
    vector: generateDeterministicVector(m.content),
  }));

  const bm25Engine = new BM25(memories);

  const denseScores = { recall: [] as number[], mrr: [] as number[], ndcg: [] as number[] };
  const hybridScores = { recall: [] as number[], mrr: [] as number[], ndcg: [] as number[] };

  for (const q of queries) {
    const targetIds: string[] = q.target_ids;
    const relevanceMap: Record<string, number> = {};
    for (const t of targetIds) relevanceMap[t] = 2;

    // 1. Dense Vector only
    const queryVec = generateDeterministicVector(q.query);
    const denseRanked = memoryVectors
      .map((mv: any) => ({ id: mv.id, score: cosineSimilarity(queryVec, mv.vector) }))
      .sort((a: any, b: any) => b.score - a.score)
      .map((r: any) => r.id);

    denseScores.recall.push(recallAtK(denseRanked, targetIds, 5));
    denseScores.mrr.push(meanReciprocalRank(denseRanked, targetIds));
    denseScores.ndcg.push(ndcgAtK(denseRanked, relevanceMap, 5));

    // 2. Hybrid Dense + BM25 via Reciprocal Rank Fusion (RRF)
    const bm25Ranked = bm25Engine.search(q.query, 10).map((r) => r.id);
    const fused = reciprocalRankFusion([denseRanked.slice(0, 10), bm25Ranked], 60);
    const hybridRanked = fused.map((f) => f.id);

    hybridScores.recall.push(recallAtK(hybridRanked, targetIds, 5));
    hybridScores.mrr.push(meanReciprocalRank(hybridRanked, targetIds));
    hybridScores.ndcg.push(ndcgAtK(hybridRanked, relevanceMap, 5));
  }

  const avg = (arr: readonly number[]) => Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3));

  const denseRecall = avg(denseScores.recall);
  const denseMrr = avg(denseScores.mrr);
  const denseNdcg = avg(denseScores.ndcg);

  const hybridRecall = avg(hybridScores.recall);
  const hybridMrr = avg(hybridScores.mrr);
  const hybridNdcg = avg(hybridScores.ndcg);

  const liftRecall = Number((((hybridRecall - denseRecall) / (denseRecall || 1)) * 100).toFixed(1));
  const liftMrr = Number((((hybridMrr - denseMrr) / (denseMrr || 1)) * 100).toFixed(1));

  return [
    {
      technique: "Before Optimization: Dense Vector Only (pgvector cosine)",
      recallAt5: denseRecall,
      mrr: denseMrr,
      ndcgAt5: denseNdcg,
      liftRecallPct: 0.0,
      liftMrrPct: 0.0,
      label: "MEASURED",
    },
    {
      technique: "After Optimization: Hybrid RRF (pgvector + BM25 Reciprocal Rank Fusion)",
      recallAt5: hybridRecall,
      mrr: hybridMrr,
      ndcgAt5: hybridNdcg,
      liftRecallPct: liftRecall,
      liftMrrPct: liftMrr,
      label: "MEASURED",
    },
  ];
}
