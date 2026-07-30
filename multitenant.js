(() => {
  const originalShowAuth = showAuth;
  const originalSetAuthMode = setAuthMode;
  const productionRedirect = `${window.location.origin}${window.location.pathname}`;

  function translateAuthError(error) {
    const message = String(error?.message || error || 'حدث خطأ غير متوقع');
    if (/already registered/i.test(message)) return 'هذا البريد مسجل بالفعل، استخدم تسجيل الدخول.';
    if (/email rate limit|rate limit/i.test(message)) return 'تم تجاوز حد إرسال البريد مؤقتًا. يلزم ربط خدمة البريد قبل إطلاق التجربة.';
    if (/email address not authorized/i.test(message)) return 'البريد الافتراضي في Supabase لا يسمح بالإرسال لهذا العنوان. يلزم ربط SMTP مخصص.';
    if (/invalid login credentials/i.test(message)) return 'البريد أو كلمة المرور غير صحيحة.';
    if (/password/i.test(message) && /weak|least/i.test(message)) return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.';
    return message;
  }

  setAuthMode = function setPublicAuthMode(mode) {
    originalSetAuthMode(mode);
    const signup = mode === 'signup';
    $('authModeToggle').classList.remove('hidden');
    $('authModeToggle').textContent = signup ? 'لدي حساب بالفعل' : 'إنشاء حساب جديد';
    $('authTitle').textContent = signup ? 'أنشئ حسابك المستقل' : 'تسجيل الدخول';
    $('authHint').textContent = signup
      ? 'كل حساب جديد يبدأ مستقلًا، وبعد الدخول يمكنك دعوة أفراد عائلتك.'
      : 'ادخل بحسابك للوصول إلى بياناتك وعائلتك.';
    $('authSubmit').textContent = signup ? 'إنشاء الحساب' : 'دخول';
  };

  showAuth = async function showPublicAuth(mode = 'login') {
    await originalShowAuth();
    $('authModeToggle').classList.remove('hidden');
    setAuthMode(mode);
  };

  $('showAuthBtn').onclick = () => showAuth('login');
  $('startFamilyBtn').onclick = () => showAuth('signup');
  document.querySelectorAll('.landing-cta').forEach((button) => {
    button.onclick = () => showAuth('signup');
  });
  $('authModeToggle').onclick = () => {
    setAuthMode($('authForm').dataset.mode === 'signup' ? 'login' : 'signup');
  };

  $('authForm').onsubmit = async (event) => {
    event.preventDefault();
    showMessage($('authMessage'), '');
    $('authSubmit').disabled = true;

    const email = $('authEmail').value.trim().toLowerCase();
    const password = $('authPassword').value;
    const mode = $('authForm').dataset.mode;

    try {
      if (mode === 'signup') {
        const fullName = $('authName').value.trim();
        if (!fullName) throw new Error('اكتب الاسم الكامل');
        if (password.length < 8) throw new Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');

        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: productionRedirect,
            data: {
              full_name: fullName,
              account_type: 'family_admin',
            },
          },
        });
        if (error) throw error;

        if (data.session) {
          session = data.session;
          await enterApp();
          showToast('تم إنشاء حسابك المستقل');
        } else {
          showMessage(
            $('authMessage'),
            'تم إنشاء الحساب. افتح رسالة التأكيد في بريدك، ثم ارجع وسجل الدخول.',
            'ok',
          );
          setAuthMode('login');
        }
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        session = data.session;
        await enterApp();
      }
    } catch (error) {
      showMessage($('authMessage'), translateAuthError(error));
    } finally {
      $('authSubmit').disabled = false;
    }
  };

  const createUserForm = $('createUserForm');
  if (createUserForm) {
    $('newUserPassword')?.closest('.field')?.remove();
    const card = createUserForm.closest('.form-card');
    const heading = card?.querySelector('.form-card-title h2');
    const description = card?.querySelector('.form-card-title p');
    const submit = createUserForm.querySelector('button[type="submit"]');
    if (heading) heading.textContent = 'دعوة فرد من العائلة';
    if (description) description.textContent = 'سنرسل له رابطًا آمنًا ليختار كلمة المرور بنفسه';
    if (submit) submit.textContent = 'إرسال الدعوة بالإيميل';

    createUserForm.onsubmit = async (event) => {
      event.preventDefault();
      showMessage($('createUserMessage'), '');
      const submitButton = event.submitter || submit;
      submitButton.disabled = true;

      try {
        const { data, error } = await client.functions.invoke('invite-family-member', {
          body: {
            full_name: $('newUserName').value.trim(),
            email: $('newUserEmail').value.trim().toLowerCase(),
            redirect_to: productionRedirect,
          },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message || 'تعذر إرسال الدعوة');

        showMessage($('createUserMessage'), 'تم إرسال الدعوة وربط الحساب بعائلتك.', 'ok');
        createUserForm.reset();
        await renderMembers();
      } catch (error) {
        showMessage($('createUserMessage'), translateAuthError(error));
      } finally {
        submitButton.disabled = false;
      }
    };
  }

  function ensurePasswordModal() {
    if ($('passwordSetupModal')) return $('passwordSetupModal');
    const modal = document.createElement('div');
    modal.id = 'passwordSetupModal';
    modal.className = 'onboarding hidden';
    modal.innerHTML = `
      <div class="onboarding-card">
        <div class="onboarding-copy">
          <span>إكمال الدعوة</span>
          <h2>اختر كلمة مرور لحسابك</h2>
          <p>تم ربطك بعائلتك، بقي أن تختار كلمة مرور خاصة بك.</p>
        </div>
        <form id="passwordSetupForm">
          <div class="field">
            <label for="invitedPassword">كلمة المرور الجديدة</label>
            <input id="invitedPassword" type="password" minlength="8" autocomplete="new-password" required>
          </div>
          <div class="field">
            <label for="invitedPasswordConfirm">تأكيد كلمة المرور</label>
            <input id="invitedPasswordConfirm" type="password" minlength="8" autocomplete="new-password" required>
          </div>
          <div id="passwordSetupMessage"></div>
          <button class="btn btn-primary btn-block" type="submit">حفظ وبدء الاستخدام</button>
        </form>
      </div>`;
    document.body.appendChild(modal);

    $('passwordSetupForm').onsubmit = async (event) => {
      event.preventDefault();
      const password = $('invitedPassword').value;
      const confirmation = $('invitedPasswordConfirm').value;
      const button = event.submitter;
      showMessage($('passwordSetupMessage'), '');

      if (password.length < 8) return showMessage($('passwordSetupMessage'), 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');
      if (password !== confirmation) return showMessage($('passwordSetupMessage'), 'كلمتا المرور غير متطابقتين');

      button.disabled = true;
      const { error } = await client.auth.updateUser({
        password,
        data: { setup_required: false, setup_complete: true },
      });
      button.disabled = false;
      if (error) return showMessage($('passwordSetupMessage'), translateAuthError(error));

      modal.classList.add('hidden');
      showToast('تم تجهيز حسابك بنجاح');
    };
    return modal;
  }

  function maybeShowPasswordSetup(currentSession) {
    const metadata = currentSession?.user?.user_metadata || {};
    if (metadata.setup_required && !metadata.setup_complete) {
      ensurePasswordModal().classList.remove('hidden');
    }
  }

  client.auth.onAuthStateChange((_event, newSession) => {
    if (newSession) setTimeout(() => maybeShowPasswordSetup(newSession), 0);
  });

  setTimeout(async () => {
    const { data } = await client.auth.getSession();
    maybeShowPasswordSetup(data.session);
  }, 500);
})();
