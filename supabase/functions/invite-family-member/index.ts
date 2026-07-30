import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) throw new Error("Unauthorized");

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("role,is_active,account_status,full_name,email")
      .eq("id", callerData.user.id)
      .single();

    if (
      profileError ||
      callerProfile?.role !== "admin" ||
      callerProfile?.account_status !== "approved" ||
      !callerProfile?.is_active
    ) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.full_name ?? "").trim();
    const redirectTo = String(body.redirect_to ?? "https://mansour-cyber.github.io/healthy-life/");
    const inviterName = String(callerProfile.full_name || "مدير العائلة").trim();
    const familyName = `عائلة ${inviterName}`;

    if (!email || !email.includes("@")) throw new Error("Invalid email");
    if (!fullName) throw new Error("Full name is required");
    if (!redirectTo.startsWith("https://mansour-cyber.github.io/healthy-life")) {
      throw new Error("Invalid redirect URL");
    }

    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        full_name: fullName,
        invited_by: callerData.user.id,
        invited_by_name: inviterName,
        inviter_email: callerProfile.email ?? callerData.user.email ?? "",
        family_name: familyName,
        setup_required: true,
        account_type: "family_member",
        invitation_context: "family_membership",
      },
    });

    if (inviteError || !invited.user) throw inviteError ?? new Error("Invitation failed");

    return new Response(JSON.stringify({
      id: invited.user.id,
      email,
      full_name: fullName,
      family_name: familyName,
      invited_by_name: inviterName,
      invited: true,
    }), {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
