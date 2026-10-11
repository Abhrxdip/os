import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BM25 } from "../lib/bm25.js";
import { generateDeterministicVector, cosineSimilarity } from "../lib/vector.js";
import { recallAtK, meanReciprocalRank, ndcgAtK, countTokens } from "../lib/metrics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface BaselineResult {
  readonly baselineName: string;
  readonly recallAt5: number;
  readonly mrr: number;
  readonly ndcgAt5: number;
  readonly avgInjectedTokens: number;
  readonly label: "MEASURED";
}

export function runBaselines(): readonly BaselineResult[] {
  const memoriesPath = join(__dirname, "../fixtures/ground_truth_memories.json");
  const queriesPath = join(__dirname, "../fixtures/retrieval_queries.json");

  const memories = JSON.parse(readFileSync(memoriesPath, "utf-8"));
  const queries = JSON.parse(readFileSync(queriesPath, "utf-8"));

  // 1. Prepare vectors for SelfOS baseline
  const memoryVectors = memories.map((m: any) => ({
    id: m.id,
    category: m.category,
    content: m.content,
    vector: generateDeterministicVector(m.content),
  }));

  // 2. Prepare BM25 engine
  const bm25Engine = new BM25(memories);

  // 3. Prepare Full History text
  const fullHistoryText = memories.map((m: any) => `[${m.category}] ${m.content}`).join("\n");
  const fullHistoryTokens = countTokens(fullHistoryText);

  // 4. Prepare Simulated Summary Memory (rolling bio like ChatGPT)
  const summaryText = memories
    .filter((m: any) => ["identity", "skill", "preference"].includes(m.category))
    .map((m: any) => `User Fact: ${m.content}`)
    .join("\n");
  const summaryTokens = countTokens(summaryText);

  // Track metrics
  const scores = {
    noMemory: { recall: [] as number[], mrr: [] as number[], ndcg: [] as number[], tokens: [] as number[] },
    fullHistory: { recall: [] as number[], mrr: [] as number[], ndcg: [] as number[], tokens: [] as number[] },
    bm25: { recall: [] as number[], mrr: [] as number[], ndcg: [] as number[], tokens: [] as number[] },
    summaryMemory: { recall: [] as number[], mrr: [] as number[], ndcg: [] as number[], tokens: [] as number[] },
    selfOS: { recall: [] as number[], mrr: [] as number[], ndcg: [] as number[], tokens: [] as number[] },
  };

  for (const q of queries) {
    const targetIds: string[] = q.target_ids;
    const relevanceMap: Record<string, number> = {};
    for (const t of targetIds) relevanceMap[t] = 2;

    // (a) No Memory
    scores.noMemory.recall.push(0.0);
    scores.noMemory.mrr.push(0.0);
    scores.noMemory.ndcg.push(0.0);
    scores.noMemory.tokens.push(0);

    // (b) Full History Stuffing
    // All documents are always present in context
    const allDocIds = memories.map((m: any) => m.id);
    scores.fullHistory.recall.push(recallAtK(allDocIds, targetIds, 5));
    scores.fullHistory.mrr.push(meanReciprocalRank(allDocIds, targetIds));
    scores.fullHistory.ndcg.push(ndcgAtK(allDocIds, relevanceMap, 5));
    scores.fullHistory.tokens.push(fullHistoryTokens);

    // (c) BM25 Keyword Retrieval
    const bm25Results = bm25Engine.search(q.query, 5);
    const bm25Ids = bm25Results.map((r) => r.id);
    scores.bm25.recall.push(recallAtK(bm25Ids, targetIds, 5));
    scores.bm25.mrr.push(meanReciprocalRank(bm25Ids, targetIds));
    scores.bm25.ndcg.push(ndcgAtK(bm25Ids, relevanceMap, 5));
    const bm25Tokens = countTokens(bm25Results.map((r) => r.content).join("\n"));
    scores.bm25.tokens.push(bm25Tokens);

    // (d) Summary Memory (simulated ChatGPT bullet list)
    // Only captures identity/skill/preference subset
    const summaryCandidateIds = memories
      .filter((m: any) => ["identity", "skill", "preference"].includes(m.category))
      .map((m: any) => m.id);
    scores.summaryMemory.recall.push(recallAtK(summaryCandidateIds, targetIds, 5));
    scores.summaryMemory.mrr.push(meanReciprocalRank(summaryCandidateIds, targetIds));
    scores.summaryMemory.ndcg.push(ndcgAtK(summaryCandidateIds, relevanceMap, 5));
    scores.summaryMemory.tokens.push(summaryTokens);

    // (e) SelfOS Dense Vector Retrieval
    const queryVec = generateDeterministicVector(q.query);
    const scoredVectors = memoryVectors
      .map((mv: any) => ({
        id: mv.id,
        content: mv.content,
        similarity: cosineSimilarity(queryVec, mv.vector),
      }))
      .sort((a: any, b: any) => b.similarity - a.similarity)
      .slice(0, 5);

    const selfOSIds = scoredVectors.map((r: any) => r.id);
    scores.selfOS.recall.push(recallAtK(selfOSIds, targetIds, 5));
    scores.selfOS.mrr.push(meanReciprocalRank(selfOSIds, targetIds));
    scores.selfOS.ndcg.push(ndcgAtK(selfOSIds, relevanceMap, 5));
    const selfOSTokens = countTokens(scoredVectors.map((r: any) => r.content).join("\n"));
    scores.selfOS.tokens.push(selfOSTokens);
  }

  const avg = (arr: readonly number[]) => Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3));
  const avgInt = (arr: readonly number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

  return [
    {
      baselineName: "Baseline A: No Memory (Cold LLM)",
      recallAt5: avg(scores.noMemory.recall),
      mrr: avg(scores.noMemory.mrr),
      ndcgAt5: avg(scores.noMemory.ndcg),
      avgInjectedTokens: avgInt(scores.noMemory.tokens),
      label: "MEASURED",
    },
    {
      baselineName: "Baseline B: Full History Stuffing",
      recallAt5: avg(scores.fullHistory.recall),
      mrr: avg(scores.fullHistory.mrr),
      ndcgAt5: avg(scores.fullHistory.ndcg),
      avgInjectedTokens: avgInt(scores.fullHistory.tokens),
      label: "MEASURED",
    },
    {
      baselineName: "Baseline C: BM25 Lexical Keyword Retrieval",
      recallAt5: avg(scores.bm25.recall),
      mrr: avg(scores.bm25.mrr),
      ndcgAt5: avg(scores.bm25.ndcg),
      avgInjectedTokens: avgInt(scores.bm25.tokens),
      label: "MEASURED",
    },
    {
      baselineName: "Baseline D: Simulated Summary Memory (ChatGPT Style)",
      recallAt5: avg(scores.summaryMemory.recall),
      mrr: avg(scores.summaryMemory.mrr),
      ndcgAt5: avg(scores.summaryMemory.ndcg),
      avgInjectedTokens: avgInt(scores.summaryMemory.tokens),
      label: "MEASURED",
    },
    {
      baselineName: "SelfOS (Dense Semantic Vector + 95% Dedup)",
      recallAt5: avg(scores.selfOS.recall),
      mrr: avg(scores.selfOS.mrr),
      ndcgAt5: avg(scores.selfOS.ndcg),
      avgInjectedTokens: avgInt(scores.selfOS.tokens),
      label: "MEASURED",
    },
  ];
}
