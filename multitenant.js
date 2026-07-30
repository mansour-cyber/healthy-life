(() => {
  const originalShowAuth = showAuth;
  const originalSetAuthMode = setAuthMode;
  const originalEnterApp = enterApp;
  const originalRenderMembers = renderMembers;
  const productionRedirect = `${window.location.origin}${window.location.pathname}`;

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = 'multitenant.css?v=2';
  document.head.appendChild(stylesheet);

  function translateAuthError(error) {
    const message = String(error?.message || error || 'حدث خطأ غير متوقع');
    if (/already registered/i.test(message)) return 'هذا البريد مسجل بالفعل، استخدم تسجيل الدخول.';
    if (/email rate limit|rate limit/i.test(message)) return 'تم تجاوز حد إرسال البريد مؤقتًا. يلزم ربط خدمة بريد مخصصة قبل الإطلاق.';
    if (/email address not authorized/i.test(message)) return 'خدمة البريد الافتراضية لا تسمح بالإرسال لهذا العنوان. يلزم ربط SMTP مخصص.';
    if (/invalid login credentials/i.test(message)) return 'البريد أو كلمة المرور غير صحيحة.';
    if (/email not confirmed/i.test(message)) return 'أكد بريدك الإلكتروني أولًا من الرسالة المرسلة إليك.';
    if (/password/i.test(message) && /weak|least/i.test(message)) return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.';
    return message;
  }

  function hidePrimaryScreens() {
    ['landingScreen', 'authScreen', 'appScreen'].forEach((id) => $(id)?.classList.add('hidden'));
  }

  function ensureApprovalScreen() {
    if ($('approvalScreen')) return $('approvalScreen');
    const screen = document.createElement('section');
    screen.id = 'approvalScreen';
    screen.className = 'approval-screen hidden';
    screen.innerHTML = `
      <div class="approval-card">
        <img src="assets/logo-mark.svg" alt="صحتي العائلية">
        <div id="approvalStatusIcon" class="approval-status-icon">✓</div>
        <span id="approvalStatusKicker">تم تأكيد بريدك</span>
        <h1 id="approvalStatusTitle">طلبك بانتظار موافقة الإدارة</h1>
        <p id="approvalStatusText">سيراجع منصور طلب التسجيل، وبعد الموافقة يفتح حسابك كاملًا.</p>
        <div class="approval-actions">
          <button id="refreshApprovalBtn" class="btn btn-primary">تحقق من حالة الطلب</button>
          <button id="approvalLogoutBtn" class="btn btn-ghost">تسجيل الخروج</button>
        </div>
      </div>`;
    document.body.appendChild(screen);

    $('refreshApprovalBtn').onclick = async () => {
      $('refreshApprovalBtn').disabled = true;
      try {
        const { data, error } = await client.from('profiles').select('*').eq('id', session.user.id).single();
        if (error) throw error;
        if (data.account_status === 'approved' && data.is_active) {
          screen.classList.add('hidden');
          await originalEnterApp();
          showToast('تمت الموافقة على حسابك');
        } else {
          showApprovalState(data);
          showToast('لا يزال الطلب بانتظار الموافقة');
        }
      } catch (error) {
        showToast(translateAuthError(error));
      } finally {
        $('refreshApprovalBtn').disabled = false;
      }
    };
    $('approvalLogoutBtn').onclick = logout;
    return screen;
  }

  function showApprovalState(account) {
    const screen = ensureApprovalScreen();
    hidePrimaryScreens();
    screen.classList.remove('hidden');
    const rejected = account.account_status === 'rejected';
    $('approvalStatusIcon').textContent = rejected ? '×' : '✓';
    $('approvalStatusIcon').classList.toggle('rejected', rejected);
    $('approvalStatusKicker').textContent = rejected ? 'تمت مراجعة الطلب' : 'تم تأكيد بريدك';
    $('approvalStatusTitle').textContent = rejected ? 'تعذر قبول طلب التسجيل' : 'طلبك بانتظار موافقة منصور';
    $('approvalStatusText').textContent = rejected
      ? account.rejection_reason || 'تم رفض الطلب. تواصل مع إدارة التطبيق لمراجعة السبب.'
      : 'لن تظهر بياناتك الصحية ولن تتمكن من إنشاء عائلة حتى يوافق منصور من لوحة الإدارة.';
    $('refreshApprovalBtn').classList.toggle('hidden', rejected);
  }

  enterApp = async function enterAppWithApproval() {
    const userId = session.user.id;
    const { data, error } = await client.from('profiles').select('*').eq('id', userId).single();
    if (error) throw error;
    profile = data;

    const independentAccount = profile.role === 'admin' && !profile.manager_id && !profile.is_platform_admin;
    if (independentAccount && (profile.account_status !== 'approved' || !profile.is_active)) {
      showApprovalState(profile);
      return;
    }

    $('approvalScreen')?.classList.add('hidden');
    await originalEnterApp();
    await renderRegistrationAdmin();
  };

  setAuthMode = function setPublicAuthMode(mode) {
    originalSetAuthMode(mode);
    const signup = mode === 'signup';
    $('authModeToggle').classList.remove('hidden');
    $('authModeToggle').textContent = signup ? 'لدي حساب بالفعل' : 'إنشاء حساب جديد';
    $('authTitle').textContent = signup ? 'إنشاء حساب جديد' : 'تسجيل الدخول';
    $('authHint').textContent = signup
      ? 'سيرسل لك بريد تأكيد، ثم يراجع منصور طلبك قبل تفعيل الحساب.'
      : 'ادخل بحسابك للوصول إلى بياناتك وعائلتك.';
    $('authSubmit').textContent = signup ? 'إنشاء الحساب وإرسال التأكيد' : 'دخول';
  };

  showAuth = async function showPublicAuth(mode = 'login') {
    $('approvalScreen')?.classList.add('hidden');
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
              account_type: 'independent_admin',
              approval_required: true,
            },
          },
        });
        if (error) throw error;

        if (data.session) {
          session = data.session;
          await enterApp();
        } else {
          showMessage(
            $('authMessage'),
            'تم استلام طلبك. أرسلنا رسالة تأكيد إلى بريدك، وبعد التأكيد سيظهر الطلب لمنصور للموافقة.',
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
    if (description) description.textContent = 'سيصله بريد رسمي ليقبل العضوية ويختار كلمة المرور';
    if (submit) submit.textContent = 'إرسال دعوة العضوية';

    createUserForm.onsubmit = async (event) => {
      event.preventDefault();
      showMessage($('createUserMessage'), '');
      const submitButton = event.submitter || submit;
      submitButton.disabled = true;

      try {
        const fullName = $('newUserName').value.trim();
        const email = $('newUserEmail').value.trim().toLowerCase();
        const { data, error } = await client.functions.invoke('invite-family-member', {
          body: { full_name: fullName, email, redirect_to: productionRedirect },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message || 'تعذر إرسال الدعوة');

        showMessage(
          $('createUserMessage'),
          `تم إرسال دعوة رسمية إلى ${email}. يمكنك أيضًا مشاركة التفاصيل معه عبر زر واتساب بجانب حسابه.`,
          'ok',
        );
        createUserForm.reset();
        await renderMembers();
      } catch (error) {
        showMessage($('createUserMessage'), translateAuthError(error));
      } finally {
        submitButton.disabled = false;
      }
    };
  }

  function memberWhatsAppMessage(member) {
    const inviterName = profile?.full_name || 'أحد أفراد عائلتك';
    const memberName = member.full_name || 'مرحبًا';
    return [
      `مرحبًا ${memberName}،`,
      '',
      `دعاك ${inviterName} للانضمام كعضو في عائلته داخل تطبيق صحتي العائلية.`,
      `تم إرسال رابط قبول الدعوة إلى بريدك: ${member.email || 'البريد المسجل'}`,
      '',
      'افتح البريد، اضغط قبول الدعوة، ثم اختر كلمة مرور خاصة بك.',
      `رابط التطبيق: ${productionRedirect}`,
      '',
      'مهم: لا تشارك كلمة مرورك مع أي شخص.',
    ].join('\n');
  }

  function decorateMemberRows() {
    const rows = [...document.querySelectorAll('#membersList .member-card')];
    rows.forEach((row, index) => {
      const member = familyMembers[index];
      if (!member) return;

      const details = row.querySelector('p');
      if (details && member.id !== session.user.id) {
        const emailState = member.email_confirmed_at ? 'البريد مؤكد' : 'بانتظار قبول الدعوة';
        details.textContent = `${details.textContent}، ${emailState}`;
      }

      if (member.id === session.user.id || row.querySelector('.whatsapp-share')) return;
      const actions = row.querySelector('.member-actions');
      if (!actions) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'whatsapp-share';
      button.title = 'مشاركة تفاصيل العضوية عبر واتساب';
      button.setAttribute('aria-label', `مشاركة دعوة ${member.full_name || ''} عبر واتساب`);
      button.innerHTML = '<span>◉</span> واتساب';
      button.onclick = () => {
        const url = `https://wa.me/?text=${encodeURIComponent(memberWhatsAppMessage(member))}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      };
      actions.appendChild(button);
    });
  }

  renderMembers = async function renderMembersWithSharing() {
    await originalRenderMembers();
    decorateMemberRows();
    await renderRegistrationAdmin();
  };

  function ensureRegistrationAdminCard() {
    if ($('registrationAdminCard')) return $('registrationAdminCard');
    const familyLayout = document.querySelector('#family .family-layout');
    if (!familyLayout) return null;
    const card = document.createElement('div');
    card.id = 'registrationAdminCard';
    card.className = 'list-card registration-admin-card hidden';
    card.innerHTML = `
      <div class="list-card-head">
        <div><span class="admin-kicker">إدارة المنصة</span><h2>طلبات تسجيل المستخدمين</h2></div>
        <span id="pendingRegistrationCount">0 طلب</span>
      </div>
      <div id="registrationRequests"></div>`;
    familyLayout.prepend(card);
    return card;
  }

  async function renderRegistrationAdmin() {
    const card = ensureRegistrationAdminCard();
    if (!card || !profile?.is_platform_admin) {
      card?.classList.add('hidden');
      return;
    }

    card.classList.remove('hidden');
    const box = $('registrationRequests');
    box.innerHTML = '<div class="empty">جارٍ تحميل الطلبات...</div>';

    const { data, error } = await client
      .from('profiles')
      .select('id,full_name,email,email_confirmed_at,account_status,rejection_reason,created_at')
      .eq('role', 'admin')
      .is('manager_id', null)
      .eq('is_platform_admin', false)
      .in('account_status', ['pending', 'rejected'])
      .order('created_at', { ascending: false });

    if (error) {
      box.innerHTML = `<div class="error">${esc(error.message)}</div>`;
      return;
    }

    const requests = data || [];
    const pendingCount = requests.filter((item) => item.account_status === 'pending').length;
    $('pendingRegistrationCount').textContent = `${pendingCount} ${pendingCount === 1 ? 'طلب' : 'طلبات'}`;
    box.innerHTML = requests.length ? '' : '<div class="empty">لا توجد طلبات تسجيل معلقة</div>';

    requests.forEach((request) => {
      const rejected = request.account_status === 'rejected';
      const emailConfirmed = Boolean(request.email_confirmed_at);
      const row = document.createElement('article');
      row.className = 'registration-request';
      row.innerHTML = `
        <div class="registration-avatar">${esc(initials(request.full_name || 'م'))}</div>
        <div class="registration-details">
          <h3>${esc(request.full_name || 'بدون اسم')}</h3>
          <p>${esc(request.email || 'لا يوجد بريد')}</p>
          <div class="registration-badges">
            <span class="${emailConfirmed ? 'confirmed' : 'waiting'}">${emailConfirmed ? 'البريد مؤكد' : 'لم يؤكد البريد'}</span>
            ${rejected ? `<span class="rejected">مرفوض سابقًا</span>` : '<span class="waiting">بانتظار الموافقة</span>'}
          </div>
          ${request.rejection_reason ? `<small>${esc(request.rejection_reason)}</small>` : ''}
        </div>
        <div class="registration-actions">
          <button class="approve-registration" ${emailConfirmed ? '' : 'disabled'}>موافقة</button>
          <button class="reject-registration">رفض</button>
        </div>`;

      row.querySelector('.approve-registration').onclick = () => reviewRegistration(request.id, 'approved');
      row.querySelector('.reject-registration').onclick = () => {
        const reason = prompt('سبب الرفض، اختياري:') || '';
        reviewRegistration(request.id, 'rejected', reason);
      };
      box.appendChild(row);
    });
  }

  async function reviewRegistration(userId, decision, reason = '') {
    const buttonSelector = decision === 'approved' ? '.approve-registration' : '.reject-registration';
    document.querySelectorAll(buttonSelector).forEach((button) => { button.disabled = true; });
    const { error } = await client.rpc('review_registration', {
      p_target_uid: userId,
      p_decision: decision,
      p_reason: reason || null,
    });
    if (error) {
      showToast(translateAuthError(error));
    } else {
      showToast(decision === 'approved' ? 'تمت الموافقة على الحساب' : 'تم رفض الطلب');
      await renderRegistrationAdmin();
    }
  }

  function ensurePasswordModal() {
    if ($('passwordSetupModal')) return $('passwordSetupModal');
    const modal = document.createElement('div');
    modal.id = 'passwordSetupModal';
    modal.className = 'onboarding hidden';
    modal.innerHTML = `
      <div class="onboarding-card">
        <div class="onboarding-copy">
          <span>دعوة عضوية عائلية</span>
          <h2>اختر كلمة مرور لحسابك</h2>
          <p>تم ربطك بعائلتك، بقي أن تختار كلمة مرور خاصة بك.</p>
        </div>
        <form id="passwordSetupForm">
          <div class="field"><label for="invitedPassword">كلمة المرور الجديدة</label><input id="invitedPassword" type="password" minlength="8" autocomplete="new-password" required></div>
          <div class="field"><label for="invitedPasswordConfirm">تأكيد كلمة المرور</label><input id="invitedPasswordConfirm" type="password" minlength="8" autocomplete="new-password" required></div>
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
      showToast('تم تجهيز حساب العضوية بنجاح');
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
    if (!data.session) return;
    session = data.session;
    maybeShowPasswordSetup(data.session);
    try {
      const { data: account } = await client.from('profiles').select('*').eq('id', data.session.user.id).single();
      if (account?.role === 'admin' && !account.manager_id && !account.is_platform_admin && account.account_status !== 'approved') {
        profile = account;
        showApprovalState(account);
      } else {
        decorateMemberRows();
        await renderRegistrationAdmin();
      }
    } catch (_) {
      // The main application handles connection errors.
    }
  }, 700);
})();
