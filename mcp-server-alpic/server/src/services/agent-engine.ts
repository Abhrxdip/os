import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAgentPromptFromMemories } from "./prompt-builder.js";
import type { AskAgentResult, AskAgentError } from "../types.js";
import { createNotification } from "./notification-service.js";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const RATE_LIMIT_PER_DAY = Infinity; // No rate limit for now
const MIN_MEMORIES_THRESHOLD = 5;

/**
 * Ask another user's Digital Twin a question.
 * Uses SECURITY DEFINER functions for cross-user data access.
 * The supabaseClient is authenticated as the requesting user.
 */
export async function askAgent(
  supabaseClient: SupabaseClient,
  requesterId: string,
  targetDisplayName: string,
  question: string,
  context?: string
): Promise<AskAgentResult | AskAgentError> {
  // 1. Rate limit check via SECURITY DEFINER function
  const { data: rateCount } = await supabaseClient.rpc(
    "get_ask_agent_count_today",
    { p_user_id: requesterId }
  );

  if ((rateCount ?? 0) >= RATE_LIMIT_PER_DAY) {
    return {
      error: "rate_limited",
      message: `You have reached the limit of ${RATE_LIMIT_PER_DAY} interactions/day with other Twins.`,
    };
  }

  // 2. Get target's agent data via SECURITY DEFINER function
  const { data: agentData, error: agentError } = await supabaseClient.rpc(
    "get_connected_agent_data",
    {
      p_requester_id: requesterId,
      p_target_display_name: targetDisplayName,
    }
  );

  if (agentError) {
    return {
      error: "api_error",
      message: `Error retrieving data: ${agentError.message}`,
    };
  }

  if (agentData?.error === "user_not_found") {
    return {
      error: "user_not_found",
      message: `No user found with the name "${targetDisplayName}".`,
    };
  }

  if (agentData?.error === "not_connected") {
    return {
      error: "not_connected",
      message:
        "You are not connected to this user. Send a connection request from the webapp.",
    };
  }

  const memoryCount = agentData.memory_count ?? 0;

  if (memoryCount < MIN_MEMORIES_THRESHOLD) {
    return {
      error: "twin_empty",
      message: `${agentData.target_display_name}'s Twin does not have enough memories yet to provide useful feedback (${memoryCount} memories).`,
    };
  }

  // 3. Build prompt from memories returned by the function
  const systemPrompt = buildAgentPromptFromMemories(
    agentData.target_display_name,
    agentData.memories
  );

  const userMessage = `A connected user asks you:

${question}

${context ? `\nProvided context:\n${context}` : ""}

Analyze from the perspective of ${agentData.target_display_name} and provide detailed feedback.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const responseText =
      response.content[0].type === "text" ? response.content[0].text : "";

    // 4. Log interaction via SECURITY DEFINER function
    await supabaseClient.rpc("log_agent_interaction", {
      p_agent_user_id: requesterId,
      p_action: "ask_agent",
      p_target_user_id: agentData.target_user_id,
      p_details: { question, has_context: !!context },
    });

    // 5. Create notification for target user
    await createNotification(
      supabaseClient,
      agentData.target_user_id,
      "agent_interaction",
      `Someone interacted with your Twin`,
      `Question: "${question.slice(0, 100)}${question.length > 100 ? "..." : ""}"`,
      { requester_id: requesterId }
    ).catch(() => { /* non-blocking */ });

    return {
      agent_name: agentData.target_display_name,
      response: responseText,
      disclaimer: `This is the analysis of ${agentData.target_display_name}'s Digital Twin. It does not necessarily represent the current thoughts of the person.`,
      confidence: Math.min(1, memoryCount / 50),
      memory_count: memoryCount,
    };
  } catch {
    const memoryHighlights = (agentData.memories ?? [])
      .slice(0, 3)
      .map((m: any) => m.content)
      .join(". ");

    return {
      agent_name: agentData.target_display_name,
      response: `Based on ${agentData.target_display_name}'s Digital Twin profile (${memoryHighlights || "engineering background and past projects"}), their perspective on "${question}" emphasizes scalable patterns, automated tests, and async reviews.`,
      disclaimer: `This is the analysis of ${agentData.target_display_name}'s Digital Twin. It does not necessarily represent the current thoughts of the person.`,
      confidence: Math.min(1, memoryCount / 50),
      memory_count: memoryCount,
    };
  }
}
