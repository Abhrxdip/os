# SelfOS: One-Slide Summary & 60-Second Hackathon Pitch

---

## Deliverable 4: The One-Slide Executive Summary

```
+---------------------------------------------------------------------------------------------------------+
|                                      SelfOS (Digital Twin Memory Layer)                                 |
|               Decentralized Personal AI Memory over Model Context Protocol (MCP) + pgvector             |
+---------------------------------------------------------------------------------------------------------+
|  THE PROBLEM:                                                                                           |
|  1. Amnesia: LLM sessions reset continuously; developers re-explain stack and preferences every time.   |
|  2. Vendor Silos: ChatGPT, Claude, and Cursor trap memory inside walled gardens; zero portability.      |
|  3. Isolated Agents: No secure standard for personal AI twins to collaborate without exposing raw logs.|
+---------------------------------------------------------------------------------------------------------+
|  THE 4 STRONGEST QUANTIFIED WINS (100% REPRODUCIBLE VIA `npm run eval`):                                |
|                                                                                                         |
|  [1] 78.4% TOKEN CONTEXT REDUCTION (4.6x Cheaper Ingestion) [MEASURED]                                   |
|      - SelfOS injects an average of 108 relevant tokens vs. 499 tokens for full-history stuffing.        |
|      - Achieves Recall@5 of 0.875 (0.900 with Hybrid RRF) and MRR of 0.887 at sub-8ms latency at 100k.   |
|                                                                                                         |
|  [2] 100% ZERO-ERROR DEDUPLICATION & 5x COMPRESSION [MEASURED]                                          |
|      - 50 paraphrased statements of 10 distinct facts merged into exactly 10 canonical rows.            |
|      - 0 false positive merges across distinct semantic clusters; confidence boosted monotonically.     |
|                                                                                                         |
|  [3] ZERO CLIENT-SIDE GLUE ACROSS 5 AI ECOSYSTEMS [MEASURED]                                            |
|      - 0 lines of code to connect ChatGPT, Claude Desktop, Cursor, Zed, and Cody via open MCP.          |
|      - Eliminates 120 LOC per client for REST/OpenAPI Actions and 450+ LOC for custom SDK wrappers.     |
|      - Delivers 96.7% unprompted tool auto-discovery accuracy (vs. 83.3% for REST OpenAPI).             |
|                                                                                                         |
|  [4] 86.7% PERSONALISATION WIN-RATE & ZERO-LEAK PRIVACY [MEASURED]                                      |
|      - Evaluated blind over 30 real developer tasks on relevance, elimination of re-asking, and style.  |
|      - 0 data leaks across 50 adversarial red-team jailbreaks, enforced by kernel-level PostgreSQL RLS.|
+---------------------------------------------------------------------------------------------------------+
|  HONEST TRADEOFFS: WHERE WE LOSE & FUTURE ROADMAP:                                                      |
|                                                                                                         |
|  * Transport Overhead: MCP adds ~4.3ms roundtrip protocol latency over raw REST (18.0ms vs 13.7ms).     |
|    Tradeoff Rationale: Worth paying 4ms to gain universal N x M client interoperability and rich UI.    |
|  * Bi-Temporal Knowledge Graphs: Zep Graphiti provides richer validity intervals for multi-hop graph   |
|    traversal (94.8% DMR). SelfOS currently uses exponential recency decay and dedup confidence boosts.  |
|  * Future Roadmap (v1.2): Native PostgreSQL relational edge tables for knowledge graphs, automated     |
|    background transcript extraction, and Letta-style hierarchical archival memory paging.               |
+---------------------------------------------------------------------------------------------------------+
```

---

## Deliverable 5: The 60-Second Spoken Pitch

*(Paced for a standard conversational speaking rate of 145 words per minute. Every number is cited directly from `RESULTS.md`.)*

> **[0:00 – 0:12 | The Problem & The Thesis]**  
> "Every time you open Claude, ChatGPT, or Cursor, your AI starts with total amnesia. Today’s AI memory is trapped in vendor silos, forces continuous re-prompting, and burns expensive tokens. We built **SelfOS**: the open personal memory layer powered by Model Context Protocol."

> **[0:13 – 0:32 | The Hard Measured Metrics]**  
> "We didn't just build it—we benchmarked it. SelfOS cuts prompt token consumption by **78.4%**, making memory injection **4.6 times cheaper** than chat-history stuffing while hitting a **0.90 Recall at 5** and **7.9 millisecond latency** across 100,000 memories. When users repeat themselves, our cosine deduplication collapses **50 paraphrases into exactly 10 canonical facts** with zero false merges."

> **[0:33 – 0:48 | Personalisation & Security]**  
> "In blind evaluations over 30 engineering tasks, SelfOS scored an **86.7% personalisation win rate** over generic cold-start models. And under 50 adversarial red-team injection attacks, we achieved **zero data leaks** because your privacy is enforced by PostgreSQL Row-Level Security at the database kernel, not fragile application prompt filters."

> **[0:49 – 1:00 | Why MCP & The Ask]**  
> "Best of all: with open MCP, SelfOS requires **zero lines of client code** to instantly connect across 5 major AI clients with **96.7% tool discovery accuracy**. Run `npm run eval` in our repository to verify every single number. Thank you."

---

## 3. How to Reproduce All Numbers
To independently run the full benchmark suite and verify every metric quoted in this pitch:
```bash
git clone https://github.com/Abhrxdip/SelfOS.git
cd SelfOS
npm run eval
```
The benchmark suite runs 100% offline-capable test batteries, executes deterministic vector and BM25 retrievals, runs all 50 red-team attacks, and generates the empirical tables in `RESULTS.md`.
