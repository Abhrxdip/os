/**
 * Okapi BM25 implementation for Baseline C
 */

export interface Document {
  readonly id: string;
  readonly content: string;
  readonly category: string;
}

export class BM25 {
  private readonly k1: number = 1.2;
  private readonly b: number = 0.75;
  private readonly docs: readonly Document[];
  private readonly tokenizedDocs: readonly string[][];
  private readonly docLengths: readonly number[];
  private readonly avgDocLength: number;
  private readonly idf: Map<string, number> = new Map();

  constructor(docs: readonly Document[]) {
    this.docs = docs;
    this.tokenizedDocs = docs.map((d) => this.tokenize(d.content));
    this.docLengths = this.tokenizedDocs.map((t) => t.length);
    const totalLength = this.docLengths.reduce((acc, len) => acc + len, 0);
    this.avgDocLength = totalLength / (docs.length || 1);
    this.computeIdf();
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  private computeIdf(): void {
    const N = this.docs.length;
    const docFreq = new Map<string, number>();

    for (const tokens of this.tokenizedDocs) {
      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    for (const [token, df] of docFreq.entries()) {
      // Standard BM25 IDF formulation
      const idfValue = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      this.idf.set(token, idfValue);
    }
  }

  public search(query: string, limit: number = 10, categoryFilter?: string): readonly { readonly id: string; readonly score: number; readonly content: string }[] {
    const queryTokens = this.tokenize(query);
    const scores: { id: string; score: number; content: string }[] = [];

    for (let i = 0; i < this.docs.length; i++) {
      const doc = this.docs[i];
      if (categoryFilter && doc.category !== categoryFilter) {
        continue;
      }

      const tokens = this.tokenizedDocs[i];
      const docLen = this.docLengths[i];
      const termFreq = new Map<string, number>();
      for (const t of tokens) {
        termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
      }

      let score = 0;
      for (const qToken of queryTokens) {
        const tf = termFreq.get(qToken) ?? 0;
        if (tf === 0) continue;
        const idfVal = this.idf.get(qToken) ?? 0.1;
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength));
        score += idfVal * (numerator / denominator);
      }

      if (score > 0) {
        scores.push({ id: doc.id, score, content: doc.content });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, limit);
  }
}
