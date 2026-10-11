import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryCategory } from "../types.js";

const MAX_PER_CATEGORY: Record<MemoryCategory, number> = {
  identity: 3,
  skill: 5,
  preference: 5,
  decision: 3,
  project: 3,
  relationship: 3,
  opinion: 5,
  communication: 2,
  goal: 3,
};

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  identity: "Identity",
  skill: "Skills",
  preference: "Preferences",
  decision: "Past Decisions",
  project: "Current Projects",
  relationship: "Relationships",
  opinion: "Opinions",
  communication: "Communication Style",
  goal: "Goals",
};

interface MemoryRow {
  readonly category: string;
  readonly content: string;
  readonly confidence: number;
  readonly created_at: string;
}

function memoryScore(m: MemoryRow): number {
  const recencyDays =
    (Date.now() - new Date(m.created_at).getTime()) / (1000 * 60 * 60 * 24);
  const recencyFactor = Math.max(0.1, 1 - recencyDays / 365);
  return m.confidence * recencyFactor;
}

/**
 * Build prompt for the user's own Twin.
 * Uses the user's Supabase client (respects RLS — reads own data).
 */
export async function buildAgentPrompt(
  supabaseClient: SupabaseClient,
  userId: string
): Promise<string> {
  const { data: user } = await supabaseClient
    .from("users")
    .select("display_name")
    .eq("id", userId)
    .single();

  const displayName = user?.display_name ?? "User";

  const { data: memories } = await supabaseClient
    .from("memories")
    .select("category, content, confidence, created_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("confidence", { ascending: false });

  if (!memories || memories.length === 0) {
    return buildMinimalPrompt(displayName);
  }

  return buildPromptFromData(displayName, memories);
}

/**
 * Build prompt from pre-fetched memories (used by ask_agent).
 * The memories are returned by the SECURITY DEFINER function.
 */
export function buildAgentPromptFromMemories(
  displayName: string,
  memories: readonly MemoryRow[]
): string {
  if (!memories || memories.length === 0) {
    return buildMinimalPrompt(displayName);
  }

  return buildPromptFromData(displayName, [...memories]);
}

function buildPromptFromData(
  displayName: string,
  memories: MemoryRow[]
): string {
  const grouped = new Map<string, MemoryRow[]>();
  for (const m of memories) {
    const existing = grouped.get(m.category) ?? [];
    grouped.set(m.category, [...existing, m]);
  }

  const sections: string[] = [];

  for (const [category, items] of grouped) {
    const max = MAX_PER_CATEGORY[category as MemoryCategory] ?? 3;
    const sorted = [...items].sort((a, b) => memoryScore(b) - memoryScore(a));
    const selected = sorted.slice(0, max);
    const label = CATEGORY_LABELS[category as MemoryCategory] ?? category;

    const lines = selected.map((m) => `- ${m.content}`).join("\n");
    sections.push(`## ${label}\n${lines}`);
  }

  return `You are the Digital Twin of ${displayName}.

You represent this person in interactions with other agents. Respond as ${displayName} would respond, based on what you know about them.

IMPORTANT: You are not ${displayName} in person. You are an AI representation based on their memory. Always make this clear when providing feedback.

${sections.join("\n\n")}

RULES:
- Always respond from the perspective of ${displayName}
- Use their communication style
- Base answers on their actual skills and real experiences
- If you lack sufficient context on a topic, state it clearly
- For technical decisions, cite relevant past decisions
- Always include a disclaimer: "This is the analysis of ${displayName}'s Digital Twin, not ${displayName} in person."`;
}

function buildMinimalPrompt(displayName: string): string {
  return `You are the Digital Twin of ${displayName}.

You do not yet have sufficient memories to accurately represent this person. Respond generically and note that your profile is still being built.

Disclaimer: "This Digital Twin has few memories and may not accurately represent the perspective of ${displayName}."`;
}
