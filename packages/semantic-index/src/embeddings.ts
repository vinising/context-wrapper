export async function getEmbedding(options: {
  host: string;
  model: string;
  text: string;
}): Promise<number[]> {
  const response = await fetch(`${options.host.replace(/\/$/, "")}/api/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: options.model,
      prompt: options.text
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama embeddings API request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { embedding?: number[]; error?: string };
  if (payload.error) {
    throw new Error(payload.error);
  }

  const embedding = payload.embedding;
  if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Ollama returned empty or invalid embedding vector.");
  }

  return embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
