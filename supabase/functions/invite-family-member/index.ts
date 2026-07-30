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

function randomPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function esc(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char] || char));
}

function invitationEmail(code: string, inviterName: string, familyName: string, appUrl: string) {
  const safeInviter = esc(inviterName);
  const safeFamily = esc(familyName);
  const safeAppUrl = esc(appUrl);
  const text = `دعوة عضوية في صحتي العائلية\n\nدعاك ${inviterName} للانضمام إلى ${familyName}.\nرمز قبول الدعوة: ${code}\n\nافتح التطبيق، اختر «لدي دعوة عائلية»، ثم أدخل بريدك والرمز واختر كلمة مرور خاصة بك.\n${appUrl}\n\nالرمز صالح لمدة 10 دقائق.`;
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"><title>دعوة عضوية عائلية</title></head><body style="margin:0;background-color:#f4f8f6;font-family:Tahoma,Arial,Helvetica,sans-serif;color:#17332c"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f4f8f6"><tr><td align="center" style="padding-top:32px;padding-right:12px;padding-bottom:32px;padding-left:12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #dfeae5;border-radius:22px"><tr><td bgcolor="#0c6b58" style="height:8px;background-color:#0c6b58;font-size:1px;line-height:1px">&nbsp;</td></tr><tr><td align="center" style="padding-top:34px;padding-right:30px;padding-bottom:26px;padding-left:30px"><p style="margin-top:0;margin-right:0;margin-bottom:8px;margin-left:0;font-family:Tahoma,Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#0c6b58;font-weight:700">صحتي العائلية</p><h1 style="margin-top:0;margin-right:0;margin-bottom:12px;margin-left:0;font-family:Tahoma,Arial,Helvetica,sans-serif;font-size:25px;line-height:38px;color:#17332c">دعوة للانضمام إلى العائلة</h1><p style="margin-top:0;margin-right:0;margin-bottom:18px;margin-left:0;font-family:Tahoma,Arial,Helvetica,sans-serif;font-size:15px;line-height:27px;color:#6f817b">دعاك <strong style="color:#17332c">${safeInviter}</strong> للانضمام إلى <strong style="color:#17332c">${safeFamily}</strong> ومشاركة المتابعة الصحية المصرح بها.</p><p style="margin-top:0;margin-right:0;margin-bottom:8px;margin-left:0;font-family:Tahoma,Arial,Helvetica,sans-serif;font-size:13px;line-height:22px;color:#6f817b">رمز قبول الدعوة</p><p style="margin-top:0;margin-right:0;margin-bottom:20px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:38px;line-height:48px;letter-spacing:9px;color:#0c6b58;font-weight:700;direction:ltr">${code}</p><p style="margin-top:0;margin-right:0;margin-bottom:22px;margin-left:0;font-family:Tahoma,Arial,Helvetica,sans-serif;font-size:13px;line-height:23px;color:#6f817b">افتح التطبيق، اختر «لدي دعوة عائلية»، أدخل بريدك والرمز، ثم اختر كلمة مرور خاصة بك.</p><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#0c6b58" style="background-color:#0c6b58;border-radius:13px"><a href="${safeAppUrl}" style="display:inline-block;padding-top:13px;padding-right:24px;padding-bottom:13px;padding-left:24px;font-family:Tahoma,Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#ffffff;text-decoration:none;font-weight:700">فتح صحتي العائلية</a></td></tr></table><p style="margin-top:20px;margin-right:0;margin-bottom:0;margin-left:0;font-family:Tahoma,Arial,Helvetica,sans-serif;font-size:12px;line-height:21px;color:#8a9994">الرمز صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.</p></td></tr><tr><td bgcolor="#f8fbf9" align="center" style="padding-top:17px;padding-right:24px;padding-bottom:17px;padding-left:24px;background-color:#f8fbf9"><p style="margin:0;font-family:Tahoma,Arial,Helvetica,sans-serif;font-size:11px;line-height:18px;color:#83928d">إذا لم تكن تعرف مرسل الدعوة، تجاهل هذه الرسالة.</p></td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let createdUserId: string | null = null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Server configuration error" }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return json({ error: "Unauthorized" }, 401);

    const { data: callerProfile, error: callerProfileError } = await admin
      .from("profiles")
      .select("id,role,is_active,account_status,full_name,email")
      .eq("id", callerData.user.id)
      .single();
    if (callerProfileError || callerProfile?.role !== "admin" || callerProfile.account_status !== "approved" || !callerProfile.is_active) {
      return json({ error: "يلزم حساب مدير عائلة معتمد" }, 403);
    }

    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.full_name ?? "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("اكتب بريدًا إلكترونيًا صحيحًا");
    if (fullName.length < 2) throw new Error("اكتب اسم فرد العائلة");
    if (email === String(callerProfile.email || "").toLowerCase()) throw new Error("لا يمكن دعوة بريد حسابك نفسه");

    const { data: existingProfile, error: lookupError } = await admin
      .from("profiles")
      .select("id,email_confirmed_at,role,manager_id,full_name")
      .ilike("email", email)
      .maybeSingle();
    if (lookupError) throw lookupError;

    let userId: string;
    let memberName = fullName;
    if (existingProfile) {
      if (existingProfile.role !== "member" || existingProfile.manager_id !== callerData.user.id) {
        throw new Error("هذا البريد مرتبط بحساب آخر ولا يمكن إضافته إلى هذه العائلة");
      }
      if (existingProfile.email_confirmed_at) throw new Error("هذا الفرد عضو فعّال في العائلة بالفعل");
      userId = existingProfile.id;
      memberName = existingProfile.full_name || fullName;
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: randomPassword(),
        email_confirm: false,
        user_metadata: {
          full_name: fullName,
          invited_by: callerData.user.id,
          invited_by_name: callerProfile.full_name || "مدير العائلة",
          inviter_email: callerProfile.email || callerData.user.email || "",
          family_name: `عائلة ${callerProfile.full_name || "العائلة"}`,
          account_type: "family_member",
          invitation_context: "family_membership",
          setup_required: true,
        },
      });
      if (createError || !created.user) throw createError ?? new Error("تعذر إنشاء دعوة العضوية");
      userId = created.user.id;
      createdUserId = userId;
    }

    const code = sixDigitCode();
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip")?.trim() || null;
    const { error: issueError } = await admin.rpc("issue_email_verification", {
      p_user_id: userId,
      p_email: email,
      p_purpose: "family_invite",
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

    const inviterName = callerProfile.full_name || "مدير العائلة";
    const familyName = `عائلة ${inviterName}`;
    const content = invitationEmail(code, inviterName, familyName, settings.app_url);
    const sendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${keyData}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${settings.from_name} <${settings.from_email}>`,
        to: [email],
        subject: "دعوة عضوية في صحتي العائلية",
        text: content.text,
        html: content.html,
        tags: [{ name: "flow", value: "family_invitation" }],
      }),
    });
    const sendResult = await sendResponse.json().catch(() => ({}));
    if (!sendResponse.ok || !sendResult.id) throw new Error(sendResult?.message || "تعذر إرسال دعوة العضوية");

    await admin.rpc("mark_email_verification_delivered", {
      p_user_id: userId,
      p_email: email,
      p_purpose: "family_invite",
      p_provider: "resend",
      p_message_id: sendResult.id,
    });

    return json({
      ok: true,
      id: userId,
      email,
      full_name: memberName,
      family_name: familyName,
      invited_by_name: inviterName,
      resend: !createdUserId,
      expires_in_seconds: 600,
    }, createdUserId ? 201 : 200);
  } catch (error) {
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId).catch(() => undefined);
    const message = error instanceof Error ? error.message : "حدث خطأ غير متوقع";
    const status = /already|بالفعل|مرتبط/.test(message) ? 409 : /too many|انتظر|wait/.test(message) ? 429 : 400;
    return json({ error: message }, status);
  }
});
