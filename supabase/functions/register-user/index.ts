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

function sixDigitCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

function verificationEmail(code: string) {
  const text = `رمز توثيق بريدك في صحتي العائلية هو: ${code}\n\nالرمز صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.`;
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"><title>رمز توثيق البريد</title></head><body style="margin:0;background-color:#f4f8f6;font-family:Tahoma,Arial,Helvetica,sans-serif;color:#17332c"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f4f8f6"><tr><td align="center" style="padding-top:32px;padding-right:12px;padding-bottom:32px;padding-left:12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #dfeae5;border-radius:22px"><tr><td bgcolor="#0c6b58" style="height:8px;background-color:#0c6b58;font-size:1px;line-height:1px">&nbsp;</td></tr><tr><td align="center" style="padding-top:36px;padding-right:30px;padding-bottom:12px;padding-left:30px"><p style="margin-top:0;margin-right:0;margin-bottom:8px;margin-left:0;font-family:Tahoma,Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#0c6b58;font-weight:700">صحتي العائلية</p><h1 style="margin-top:0;margin-right:0;margin-bottom:12px;margin-left:0;font-family:Tahoma,Arial,Helvetica,sans-serif;font-size:25px;line-height:38px;color:#17332c">رمز توثيق بريدك</h1><p style="margin-top:0;margin-right:0;margin-bottom:22px;margin-left:0;font-family:Tahoma,Arial,Helvetica,sans-serif;font-size:15px;line-height:26px;color:#6f817b">أدخل الرمز التالي داخل التطبيق لإكمال توثيق حسابك.</p><p style="margin-top:0;margin-right:0;margin-bottom:20px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:38px;line-height:48px;letter-spacing:9px;color:#0c6b58;font-weight:700;direction:ltr">${code}</p><p style="margin-top:0;margin-right:0;margin-bottom:0;margin-left:0;font-family:Tahoma,Arial,Helvetica,sans-serif;font-size:12px;line-height:21px;color:#8a9994">الرمز صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.</p></td></tr><tr><td bgcolor="#f8fbf9" align="center" style="padding-top:17px;padding-right:24px;padding-bottom:17px;padding-left:24px;background-color:#f8fbf9"><p style="margin:0;font-family:Tahoma,Arial,Helvetica,sans-serif;font-size:11px;line-height:18px;color:#83928d">إذا لم تطلب إنشاء الحساب، تجاهل هذه الرسالة.</p></td></tr></table></td></tr></table></body></html>`;
  return { text, html };
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

  let createdUserId: string | null = null;
  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim();
    const resend = body.resend === true;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("اكتب بريدًا إلكترونيًا صحيحًا");
    if (!resend && fullName.length < 2) throw new Error("اكتب الاسم الكامل");
    if (!resend && password.length < 8) throw new Error("كلمة المرور يجب أن تكون 8 أحرف على الأقل");

    const { data: existingProfile, error: lookupError } = await admin
      .from("profiles")
      .select("id,email_confirmed_at,role,manager_id,is_platform_admin")
      .ilike("email", email)
      .maybeSingle();
    if (lookupError) throw lookupError;

    let userId: string;
    if (resend) {
      if (!existingProfile || existingProfile.email_confirmed_at || existingProfile.role !== "admin" || existingProfile.manager_id || existingProfile.is_platform_admin) {
        throw new Error("لا يوجد طلب تسجيل غير موثق لهذا البريد");
      }
      userId = existingProfile.id;
    } else {
      if (existingProfile) {
        if (!existingProfile.email_confirmed_at && existingProfile.role === "admin" && !existingProfile.manager_id) {
          throw new Error("هذا البريد لديه طلب غير موثق. استخدم إعادة إرسال رمز التوثيق.");
        }
        throw new Error("هذا البريد مسجل بالفعل، استخدم تسجيل الدخول.");
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
        user_metadata: {
          full_name: fullName,
          account_type: "independent_admin",
          approval_required: true,
        },
      });
      if (createError || !created.user) throw createError ?? new Error("تعذر إنشاء الحساب");
      userId = created.user.id;
      createdUserId = userId;
    }

    const code = sixDigitCode();
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip")?.trim() || null;
    const { error: issueError } = await admin.rpc("issue_email_verification", {
      p_user_id: userId,
      p_email: email,
      p_purpose: "signup",
      p_code: code,
      p_request_ip: forwarded,
    });
    if (issueError) throw issueError;

    const [{ data: keyData, error: keyError }, { data: settingsData, error: settingsError }] = await Promise.all([
      admin.rpc("get_healthy_life_resend_key"),
      admin.rpc("get_healthy_life_email_settings"),
    ]);
    if (keyError || !keyData) throw keyError ?? new Error("Email provider key unavailable");
    const settings = Array.isArray(settingsData) ? settingsData[0] : settingsData;
    if (settingsError || !settings?.from_email) throw settingsError ?? new Error("Email settings unavailable");

    const content = verificationEmail(code);
    const sendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${keyData}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${settings.from_name} <${settings.from_email}>`,
        to: [email],
        subject: "رمز توثيق بريدك في صحتي العائلية",
        text: content.text,
        html: content.html,
        tags: [{ name: "flow", value: "signup_verification" }],
      }),
    });
    const sendResult = await sendResponse.json().catch(() => ({}));
    if (!sendResponse.ok || !sendResult.id) throw new Error(sendResult?.message || "تعذر إرسال رمز التوثيق");

    await admin.rpc("mark_email_verification_delivered", {
      p_user_id: userId,
      p_email: email,
      p_purpose: "signup",
      p_provider: "resend",
      p_message_id: sendResult.id,
    });

    return json({ ok: true, email, resend, expires_in_seconds: 600 }, createdUserId ? 201 : 200);
  } catch (error) {
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId).catch(() => undefined);
    const message = error instanceof Error ? error.message : "حدث خطأ غير متوقع";
    const status = /already|مسجل بالفعل|لديه طلب/.test(message) ? 409 : /too many|انتظر|wait/.test(message) ? 429 : 400;
    return json({ error: message }, status);
  }
});
