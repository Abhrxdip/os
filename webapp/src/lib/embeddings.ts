const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function createFallbackVector(text: string): number[] {
  const DIM = 1536;
  const vec = new Array<number>(DIM).fill(0);
  const words = text.toLowerCase().trim().split(/\s+/);

  for (let w = 0; w < words.length; w++) {
    const word = words[w];
    for (let i = 0; i < word.length; i++) {
      const code = word.charCodeAt(i);
      const idx = Math.abs((code * 31 + i * 17 + w * 13) % DIM);
      vec[idx] += 1.0;
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

/**
 * Generate embedding for a text using OpenAI ada-002, with fallback.
 */
export async function generateEmbedding(
  text: string
): Promise<number[] | null> {
  if (!OPENAI_API_KEY) {
    return createFallbackVector(text);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-ada-002",
        input: text,
      }),
    });

    if (!response.ok) {
      console.warn("OpenAI embedding API unavailable, using fallback vector");
      return createFallbackVector(text);
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch {
    return createFallbackVector(text);
  }
}
