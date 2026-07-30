(() => {
  const originalSetAuthMode = setAuthMode;
  const originalShowAuth = showAuth;
  let verificationPurpose = 'signup';
  let pendingEmail = '';
  let pendingPassword = '';

  const style = document.createElement('style');
  style.textContent = `
    .email-flow-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:12px}
    .email-flow-actions button{border:0;background:transparent;color:#0c6b58;font-family:inherit;font-weight:700;cursor:pointer;padding:8px}
    .email-verification-panel{display:grid;gap:15px}
    .email-verification-panel.hidden{display:none}
    .verification-code-input{font-family:Arial,sans-serif!important;font-size:28px!important;letter-spacing:10px;text-align:center;direction:ltr;font-weight:700}
    .verification-note{padding:12px 14px;border-radius:12px;background:#f1f8f5;color:#45655d;font-size:13px;line-height:1.7}
    .verification-secondary{display:flex;justify-content:center;gap:14px;flex-wrap:wrap}
    .verification-secondary button{border:0;background:transparent;color:#0c6b58;font-family:inherit;font-weight:700;cursor:pointer;padding:6px}
  `;
  document.head.appendChild(style);

  function friendlyError(error) {
    const message = String(error?.message || error || 'حدث خطأ غير متوقع');
    if (/FunctionsHttpError/i.test(message)) return 'تعذر إكمال العملية. تحقق من البيانات وحاول مرة أخرى.';
    if (/invalid login credentials/i.test(message)) return 'البريد أو كلمة المرور غير صحيحة.';
    if (/email not confirmed/i.test(message)) return 'بريدك لم يُوثق بعد. أدخل رمز التوثيق المرسل إلى بريدك.';
    if (/already|مسجل بالفعل/i.test(message)) return 'هذا البريد مسجل بالفعل، استخدم تسجيل الدخول.';
    return message;
  }

  async function invokeFunction(name, body) {
    const { data, error } = await client.functions.invoke(name, { body });
    if (error) {
      let message = error.message;
      try {
        const context = error.context;
        if (context && typeof context.json === 'function') {
          const payload = await context.json();
          message = payload?.error || message;
        }
      } catch (_) {}
      throw new Error(message || 'تعذر الاتصال بالخدمة');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  function ensureVerificationUI() {
    if ($('emailVerificationPanel')) return $('emailVerificationPanel');

    const actions = document.createElement('div');
    actions.id = 'emailFlowActions';
    actions.className = 'email-flow-actions';
    actions.innerHTML = `
      <button id="showSignupCodeBtn" type="button">لدي رمز توثيق</button>
      <button id="showFamilyInviteBtn" type="button">لدي دعوة عائلية</button>`;
    $('authModeToggle').insertAdjacentElement('afterend', actions);

    const panel = document.createElement('div');
    panel.id = 'emailVerificationPanel';
    panel.className = 'email-verification-panel hidden';
    panel.innerHTML = `
      <div class="verification-note" id="verificationIntro">أدخل رمز التوثيق المرسل إلى بريدك.</div>
      <div class="field"><label for="verificationEmail">البريد الإلكتروني</label><input id="verificationEmail" type="email" autocomplete="email" required></div>
      <div class="field"><label for="verificationCode">رمز التوثيق</label><input id="verificationCode" class="verification-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" required></div>
      <div id="familyPasswordFields" class="hidden">
        <div class="field"><label for="familyInvitePassword">اختر كلمة مرور</label><input id="familyInvitePassword" type="password" minlength="8" autocomplete="new-password"></div>
        <div class="field"><label for="familyInvitePasswordConfirm">تأكيد كلمة المرور</label><input id="familyInvitePasswordConfirm" type="password" minlength="8" autocomplete="new-password"></div>
      </div>
      <div id="verificationMessage"></div>
      <button id="verifyEmailCodeBtn" class="btn btn-primary btn-block" type="button">تأكيد الرمز</button>
      <div class="verification-secondary">
        <button id="resendVerificationCodeBtn" type="button">إعادة إرسال الرمز</button>
        <button id="backToAuthBtn" type="button">العودة</button>
      </div>`;
    $('authForm').insertAdjacentElement('afterend', panel);

    $('showSignupCodeBtn').onclick = () => showVerification('signup', $('authEmail').value);
    $('showFamilyInviteBtn').onclick = () => showVerification('family_invite', $('authEmail').value);
    $('backToAuthBtn').onclick = () => hideVerification();
    $('verifyEmailCodeBtn').onclick = verifyCode;
    $('resendVerificationCodeBtn').onclick = resendCode;
    $('verificationCode').addEventListener('input', (event) => {
      event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
    });
    return panel;
  }

  function showVerification(purpose, email = '') {
    ensureVerificationUI();
    verificationPurpose = purpose;
    pendingEmail = String(email || pendingEmail || '').trim().toLowerCase();
    $('authForm').classList.add('hidden');
    $('authModeToggle').classList.add('hidden');
    $('emailFlowActions').classList.add('hidden');
    $('emailVerificationPanel').classList.remove('hidden');
    $('verificationEmail').value = pendingEmail;
    $('verificationCode').value = '';
    showMessage($('verificationMessage'), '');

    const familyInvite = purpose === 'family_invite';
    $('familyPasswordFields').classList.toggle('hidden', !familyInvite);
    $('resendVerificationCodeBtn').classList.toggle('hidden', familyInvite);
    $('authTitle').textContent = familyInvite ? 'قبول دعوة العائلة' : 'توثيق البريد الإلكتروني';
    $('authHint').textContent = familyInvite
      ? 'أدخل الرمز المرسل إلى بريدك، ثم اختر كلمة مرور خاصة بك.'
      : 'أدخل رمز التوثيق المكوّن من 6 أرقام.';
    $('verificationIntro').textContent = familyInvite
      ? 'رمز الدعوة صالح لمدة 10 دقائق. بعد قبوله سيتم ربطك بالعائلة مباشرة.'
      : 'رمز التوثيق صالح لمدة 10 دقائق. بعد التوثيق ينتقل طلبك إلى الإدارة للموافقة.';
    setTimeout(() => $('verificationCode').focus(), 50);
  }

  function hideVerification() {
    ensureVerificationUI();
    $('emailVerificationPanel').classList.add('hidden');
    $('authForm').classList.remove('hidden');
    $('authModeToggle').classList.remove('hidden');
    $('emailFlowActions').classList.remove('hidden');
    originalSetAuthMode('login');
    $('authTitle').textContent = 'تسجيل الدخول';
    $('authHint').textContent = 'ادخل بحسابك للوصول إلى بياناتك وعائلتك.';
    $('authEmail').value = pendingEmail;
  }

  async function resendCode() {
    const email = $('verificationEmail').value.trim().toLowerCase();
    if (!email || !email.includes('@')) return showMessage($('verificationMessage'), 'اكتب البريد الإلكتروني أولًا.');
    const button = $('resendVerificationCodeBtn');
    button.disabled = true;
    try {
      await invokeFunction('register-user', { email, resend: true });
      pendingEmail = email;
      showMessage($('verificationMessage'), 'تم إرسال رمز جديد من no-reply@mailpilot.my.', 'ok');
    } catch (error) {
      showMessage($('verificationMessage'), friendlyError(error));
    } finally {
      button.disabled = false;
    }
  }

  async function verifyCode() {
    const email = $('verificationEmail').value.trim().toLowerCase();
    const code = $('verificationCode').value.replace(/\D/g, '');
    const button = $('verifyEmailCodeBtn');
    if (!email || !email.includes('@')) return showMessage($('verificationMessage'), 'اكتب البريد الإلكتروني الصحيح.');
    if (code.length !== 6) return showMessage($('verificationMessage'), 'أدخل رمز التوثيق المكوّن من 6 أرقام.');

    let password = '';
    if (verificationPurpose === 'family_invite') {
      password = $('familyInvitePassword').value;
      const confirmation = $('familyInvitePasswordConfirm').value;
      if (password.length < 8) return showMessage($('verificationMessage'), 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
      if (password !== confirmation) return showMessage($('verificationMessage'), 'كلمتا المرور غير متطابقتين.');
    }

    button.disabled = true;
    try {
      await invokeFunction('verify-email-code', {
        email,
        code,
        purpose: verificationPurpose,
        ...(password ? { password } : {}),
      });

      const loginPassword = verificationPurpose === 'family_invite' ? password : pendingPassword;
      if (loginPassword) {
        const { data, error } = await client.auth.signInWithPassword({ email, password: loginPassword });
        if (!error && data.session) {
          session = data.session;
          $('emailVerificationPanel').classList.add('hidden');
          await enterApp();
          showToast(verificationPurpose === 'family_invite' ? 'تم قبول دعوة العائلة' : 'تم توثيق بريدك');
          return;
        }
      }

      pendingEmail = email;
      hideVerification();
      $('authEmail').value = email;
      showMessage(
        $('authMessage'),
        verificationPurpose === 'family_invite'
          ? 'تم قبول الدعوة. سجّل الدخول بالبريد وكلمة المرور التي اخترتها.'
          : 'تم توثيق بريدك. طلبك بانتظار الموافقة من الإدارة، ويمكنك تسجيل الدخول لمتابعة حالته.',
        'ok',
      );
    } catch (error) {
      showMessage($('verificationMessage'), friendlyError(error));
    } finally {
      button.disabled = false;
    }
  }

  setAuthMode = function enhancedAuthMode(mode) {
    originalSetAuthMode(mode);
    ensureVerificationUI();
    $('emailVerificationPanel').classList.add('hidden');
    $('authForm').classList.remove('hidden');
    $('emailFlowActions').classList.remove('hidden');
    const signup = mode === 'signup';
    $('authHint').textContent = signup
      ? 'سيصلك رمز توثيق من no-reply@mailpilot.my، وبعد التوثيق تتم مراجعة طلبك من الإدارة.'
      : 'ادخل بحسابك للوصول إلى بياناتك وعائلتك.';
    $('authSubmit').textContent = signup ? 'إنشاء الحساب وإرسال الرمز' : 'دخول';
    const obsoleteResend = $('resendConfirmationBtn');
    if (obsoleteResend) obsoleteResend.classList.add('hidden');
  };

  showAuth = async function enhancedShowAuth(mode = 'login') {
    await originalShowAuth(mode);
    ensureVerificationUI();
    setAuthMode(mode);
  };

  $('showAuthBtn').onclick = () => showAuth('login');
  $('startFamilyBtn').onclick = () => showAuth('signup');
  document.querySelectorAll('.landing-cta').forEach((button) => { button.onclick = () => showAuth('signup'); });
  $('authModeToggle').onclick = () => setAuthMode($('authForm').dataset.mode === 'signup' ? 'login' : 'signup');

  $('authForm').onsubmit = async (event) => {
    event.preventDefault();
    showMessage($('authMessage'), '');
    const submit = $('authSubmit');
    submit.disabled = true;
    const email = $('authEmail').value.trim().toLowerCase();
    const password = $('authPassword').value;
    const mode = $('authForm').dataset.mode;

    try {
      if (mode === 'signup') {
        const fullName = $('authName').value.trim();
        if (!fullName) throw new Error('اكتب الاسم الكامل');
        if (password.length < 8) throw new Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
        await invokeFunction('register-user', { email, password, full_name: fullName });
        pendingEmail = email;
        pendingPassword = password;
        showVerification('signup', email);
        showMessage($('verificationMessage'), 'تم إرسال رمز التوثيق إلى بريدك من no-reply@mailpilot.my.', 'ok');
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        session = data.session;
        await enterApp();
      }
    } catch (error) {
      const message = String(error?.message || error);
      if (/email not confirmed/i.test(message)) {
        pendingPassword = password;
        showVerification('signup', email);
        showMessage($('verificationMessage'), 'أدخل رمز التوثيق المرسل إلى بريدك، أو اطلب رمزًا جديدًا.');
      } else {
        showMessage($('authMessage'), friendlyError(error));
      }
    } finally {
      submit.disabled = false;
    }
  };

  ensureVerificationUI();
})();
