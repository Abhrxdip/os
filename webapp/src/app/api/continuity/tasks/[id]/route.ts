import { createClient } from "@/lib/supabase/server";
import { getTaskDetail } from "@/lib/continuity";
import { NextResponse } from "next/server";

const DEFAULT_DEMO_USER_ID = "eb049ac8-5cee-4d7e-a1d4-0d4698030f76";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let userId = DEFAULT_DEMO_USER_ID;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) userId = user.id;
  } catch {
    // fallback
  }

  const { id } = await params;
  const detail = getTaskDetail(userId, id);

  if (!detail) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ data: detail });
}
