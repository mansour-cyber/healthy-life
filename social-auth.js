(() => {
  const redirectUrl = 'https://mansour-cyber.github.io/healthy-life/';
  const supportedProviders = new Set(['google', 'apple']);
  let handledUserId = null;

  const style = document.createElement('style');
  style.textContent = `
    .social-auth{display:grid;gap:10px;margin:0 0 18px}
    .social-auth.hidden{display:none}
    .social-divider{display:flex;align-items:center;gap:12px;color:#82928d;font-size:12px;margin:2px 0}
    .social-divider::before,.social-divider::after{content:"";height:1px;background:#dfe8e4;flex:1}
    .social-button{min-height:48px;border:1px solid #d8e2de;border-radius:14px;background:#fff;color:#17332c;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:.2s ease}
    .social-button:hover{border-color:#9bb8ae;transform:translateY(-1px)}
    .social-button:disabled{opacity:.55;cursor:wait;transform:none}
    .social-icon{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-family:Arial,sans-serif;font-size:17px;font-weight:700}
    .google-icon{color:#4285f4;border:1px solid #e5e9e7;background:#fff}
    .apple-icon{color:#fff;background:#111;font-size:16px}
    .social-note{margin:0;text-align:center;color:#7a8c86;font-size:11px;line-height:1.7}
    .social-name-modal .onboarding-card{max-width:430px}
  `;
  document.head.appendChild(style);

  function providerName(provider) {
    return provider === 'apple' ? 'Apple' : 'Google';
  }

  function friendlySocialError(error, provider) {
    const message = String(error?.message || error || 'تعذر تسجيل الدخول');
    if (/provider.*not enabled|unsupported provider/i.test(message)) {
      return `دخول ${providerName(provider)} غير مفعّل في إعدادات المصادقة بعد.`;
    }
    if (/redirect|callback/i.test(message)) {
      return 'تعذر إكمال العودة إلى التطبيق. تحقق من إعدادات رابط التحويل.';
    }
    return message;
  }

  function ensureSocialButtons() {
    if ($('socialAuth')) return $('socialAuth');
    const form = $('authForm');
    if (!form) return null;

    const box = document.createElement('div');
    box.id = 'socialAuth';
    box.className = 'social-auth';
    box.innerHTML = `
      <button id="googleSignInBtn" class="social-button" type="button">
        <span class="social-icon google-icon">G</span><span>المتابعة باستخدام Google</span>
      </button>
      <button id="appleSignInBtn" class="social-button" type="button">
        <span class="social-icon apple-icon">●</span><span>المتابعة باستخدام Apple</span>
      </button>
      <div class="social-divider"><span>أو بالبريد الإلكتروني</span></div>
      <p class="social-note">عند أول دخول يُنشأ طلب تسجيل، وتبقى البيانات الصحية مغلقة حتى موافقة الإدارة.</p>`;
    form.insertAdjacentElement('beforebegin', box);

    $('googleSignInBtn').onclick = () => signInWithProvider('google');
    $('appleSignInBtn').onclick = () => signInWithProvider('apple');

    const observer = new MutationObserver(() => {
      box.classList.toggle('hidden', form.classList.contains('hidden'));
    });
    observer.observe(form, { attributes: true, attributeFilter: ['class'] });
    return box;
  }

  async function signInWithProvider(provider) {
    const button = $(provider === 'apple' ? 'appleSignInBtn' : 'googleSignInBtn');
    if (!button) return;
    button.disabled = true;
    showMessage($('authMessage'), '');
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl,
          scopes: provider === 'apple' ? 'name email' : 'openid email profile',
          queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
        },
      });
      if (error) throw error;
    } catch (error) {
      button.disabled = false;
      showMessage($('authMessage'), friendlySocialError(error, provider));
    }
  }

  function socialProvider(user) {
    const provider = user?.app_metadata?.provider;
    if (supportedProviders.has(provider)) return provider;
    const identity = (user?.identities || []).find((item) => supportedProviders.has(item.provider));
    return identity?.provider || null;
  }

  function metadataName(user) {
    const data = user?.user_metadata || {};
    return [
      data.full_name,
      data.name,
      [data.given_name, data.family_name].filter(Boolean).join(' '),
    ].map((value) => String(value || '').trim()).find(Boolean) || '';
  }

  function ensureNameModal() {
    if ($('socialNameModal')) return $('socialNameModal');
    const modal = document.createElement('section');
    modal.id = 'socialNameModal';
    modal.className = 'onboarding social-name-modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="onboarding-card">
        <div class="onboarding-copy">
          <span>إكمال الملف</span>
          <h2>ما اسمك الكامل؟</h2>
          <p>نحتاج الاسم لعرض طلب التسجيل ولوحة العائلة. لن نطلب كلمة مرور لحسابك الاجتماعي.</p>
        </div>
        <form id="socialNameForm">
          <div class="field"><label for="socialFullName">الاسم الكامل</label><input id="socialFullName" autocomplete="name" minlength="2" required placeholder="مثال: أحمد محمد"></div>
          <div id="socialNameMessage"></div>
          <button class="btn btn-primary btn-block" type="submit">حفظ ومتابعة</button>
        </form>
      </div>`;
    document.body.appendChild(modal);

    $('socialNameForm').onsubmit = async (event) => {
      event.preventDefault();
      const fullName = $('socialFullName').value.trim();
      const button = event.submitter;
      if (fullName.length < 2) return showMessage($('socialNameMessage'), 'اكتب الاسم الكامل.');
      button.disabled = true;
      try {
        const { data: userData, error: userError } = await client.auth.updateUser({
          data: { full_name: fullName, name: fullName },
        });
        if (userError) throw userError;

        const userId = userData.user?.id || session?.user?.id;
        const { error: profileError } = await client
          .from('profiles')
          .update({ full_name: fullName })
          .eq('id', userId);
        if (profileError) throw profileError;

        if (profile?.id === userId) profile.full_name = fullName;
        modal.classList.add('hidden');
        showToast('تم حفظ اسمك');
      } catch (error) {
        showMessage($('socialNameMessage'), String(error?.message || error));
      } finally {
        button.disabled = false;
      }
    };
    return modal;
  }

  async function fetchProfile(userId) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (!error && data) return data;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
    return null;
  }

  async function handleSocialSession(currentSession) {
    const user = currentSession?.user;
    const provider = socialProvider(user);
    if (!user || !provider) return;
    if (handledUserId === user.id) return;
    handledUserId = user.id;

    const account = await fetchProfile(user.id);
    if (!account) return;
    const availableName = metadataName(user);

    if (!String(account.full_name || '').trim() && availableName) {
      const { error } = await client.from('profiles').update({ full_name: availableName }).eq('id', user.id);
      if (!error && profile?.id === user.id) profile.full_name = availableName;
    }

    if (!String(account.full_name || availableName || '').trim()) {
      const modal = ensureNameModal();
      $('socialFullName').value = '';
      showMessage($('socialNameMessage'), '');
      modal.classList.remove('hidden');
      setTimeout(() => $('socialFullName').focus(), 50);
    }
  }

  ensureSocialButtons();

  client.auth.onAuthStateChange((_event, currentSession) => {
    if (currentSession) setTimeout(() => handleSocialSession(currentSession), 0);
  });

  setTimeout(async () => {
    const { data } = await client.auth.getSession();
    if (data.session) handleSocialSession(data.session);
  }, 900);
})();
