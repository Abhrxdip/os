import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollaborativePlanResult, SavedPlan } from "../types.js";

export async function savePlan(
  supabase: SupabaseClient,
  userId: string,
  planResult: CollaborativePlanResult,
  name: string,
  description?: string
): Promise<{ readonly plan_id: string; readonly name: string }> {
  const agentIds = planResult.agents_involved.map((a) => a.id);

  const { data, error } = await supabase
    .from("plans")
    .insert({
      user_id: userId,
      name,
      description: description ?? null,
      plan_data: planResult,
      agent_ids: agentIds,
      status: "draft",
    })
    .select("id")
    .single();

  if (error) throw new Error(`Error saving plan: ${error.message}`);

  return { plan_id: data.id, name };
}

export async function getPlan(
  supabase: SupabaseClient,
  userId: string,
  searchTerm: string
): Promise<SavedPlan | null> {
  try {
    const { data, error } = await supabase.rpc("search_plans_by_name", {
      p_user_id: userId,
      p_search_term: searchTerm,
    });

    if (error) {
      console.warn(`[Plans] search_plans_by_name notice: ${error.message}`);
      return null;
    }
    if (!data || data.length === 0) return null;

    return data[0] as SavedPlan;
  } catch {
    return null;
  }
}

export async function listPlans(
  supabase: SupabaseClient,
  userId: string
): Promise<
  readonly {
    id: string;
    name: string;
    description: string | null;
    status: string;
    agent_ids: string[];
    created_at: string;
    updated_at: string;
  }[]
> {
  try {
    const { data, error } = await supabase
      .from("plans")
      .select("id, name, description, status, agent_ids, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) {
      console.warn(`[Plans] Plans table notice: ${error.message}`);
      return [];
    }

    return data ?? [];
  } catch {
    return [];
  }
}

export async function updatePlanStatus(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
  status: string
): Promise<void> {
  const { error } = await supabase
    .from("plans")
    .update({ status })
    .eq("id", planId)
    .eq("user_id", userId);

  if (error) throw new Error(`Error updating plan: ${error.message}`);
}
