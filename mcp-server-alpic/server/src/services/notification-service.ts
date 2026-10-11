import type { SupabaseClient } from "@supabase/supabase-js";
import type { Notification, NotificationType } from "../types.js";

export async function getUnreadNotifications(
  supabase: SupabaseClient,
  userId: string
): Promise<readonly Notification[]> {
  try {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .eq("is_read", false)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn(`[Notifications] Notifications table notice: ${error.message}`);
      return [];
    }

    return (data ?? []) as Notification[];
  } catch {
    return [];
  }
}

export async function markAllRead(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error)
    throw new Error(`Error updating notifications: ${error.message}`);
}

export async function createNotification(
  supabase: SupabaseClient,
  targetUserId: string,
  type: NotificationType,
  title: string,
  body?: string,
  metadata?: Record<string, unknown>
): Promise<string> {
  const { data, error } = await supabase.rpc("create_notification", {
    p_user_id: targetUserId,
    p_type: type,
    p_title: title,
    p_body: body ?? null,
    p_metadata: metadata ?? {},
  });

  if (error)
    throw new Error(`Error creating notification: ${error.message}`);

  return data as string;
}
