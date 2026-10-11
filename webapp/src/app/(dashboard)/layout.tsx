import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Sidebar } from "./sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let displayName = "Abhradip Pal";
  let unreadCount = 0;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const [{ data: profile }, { count }] = await Promise.all([
        supabase
          .from("users")
          .select("display_name")
          .eq("id", user.id)
          .single(),
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_read", false),
      ]);

      displayName = profile?.display_name ?? user.email ?? "User";
      unreadCount = count ?? 0;
    }
  } catch {
    // Fallback gracefully for local dev and demo sessions
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar displayName={displayName} unreadCount={unreadCount ?? 0} />
      <main className="flex-1 bg-background p-8">{children}</main>
    </div>
  );
}
