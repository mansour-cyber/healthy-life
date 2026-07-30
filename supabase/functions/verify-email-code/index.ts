import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration error" }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const code = String(body.code ?? "").replace(/\D/g, "").slice(0, 6);
    const purpose = String(body.purpose ?? "signup");
    const password = String(body.password ?? "");

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("اكتب بريدًا إلكترونيًا صحيحًا");
    if (!/^[0-9]{6}$/.test(code)) throw new Error("أدخل رمز التوثيق المكوّن من 6 أرقام");
    if (!["signup", "family_invite"].includes(purpose)) throw new Error("نوع التوثيق غير صحيح");
    if (purpose === "family_invite" && password.length < 8) throw new Error("كلمة المرور يجب أن تكون 8 أحرف على الأقل");

    const { data: consumed, error: consumeError } = await admin.rpc("consume_email_verification", {
      p_email: email,
      p_purpose: purpose,
      p_code: code,
    });
    if (consumeError) throw consumeError;

    const result = Array.isArray(consumed) ? consumed[0] : consumed;
    if (!result?.success || !result?.user_id) {
      const messages: Record<string, string> = {
        invalid_code: "رمز التوثيق غير صحيح",
        expired_or_missing: "انتهت صلاحية الرمز أو لا يوجد رمز نشط. اطلب رمزًا جديدًا.",
        too_many_attempts: "تم إيقاف هذا الرمز بعد محاولات متعددة. اطلب رمزًا جديدًا.",
      };
      return json({ error: messages[result?.reason] || "تعذر التحقق من الرمز", reason: result?.reason }, 400);
    }

    const userId = result.user_id as string;
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,email,role,manager_id,is_platform_admin")
      .eq("id", userId)
      .single();
    if (profileError || !profile || String(profile.email).toLowerCase() !== email) throw new Error("الحساب لا يطابق طلب التوثيق");

    if (purpose === "signup") {
      if (profile.role !== "admin" || profile.manager_id || profile.is_platform_admin) throw new Error("طلب التسجيل غير صالح");
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
      if (updateError) throw updateError;
      return json({ ok: true, purpose, account_status: "pending", message: "تم توثيق بريدك، وطلبك بانتظار الموافقة." });
    }

    if (profile.role !== "member" || !profile.manager_id) throw new Error("دعوة العائلة غير صالحة");
    const { data: authUser, error: getUserError } = await admin.auth.admin.getUserById(userId);
    if (getUserError || !authUser.user) throw getUserError ?? new Error("تعذر العثور على الحساب");

    const metadata = {
      ...(authUser.user.user_metadata || {}),
      setup_required: false,
      setup_complete: true,
      invitation_accepted_at: new Date().toISOString(),
    };
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      email_confirm: true,
      password,
      user_metadata: metadata,
    });
    if (updateError) throw updateError;

    return json({ ok: true, purpose, account_status: "approved", message: "تم قبول دعوة العائلة وتجهيز حسابك." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "حدث خطأ غير متوقع";
    return json({ error: message }, 400);
  }
});
