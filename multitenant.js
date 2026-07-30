(() => {
  const baseShowAuth = showAuth;
  const baseSetAuthMode = setAuthMode;
  const baseEnterApp = enterApp;
  const redirectUrl = `${window.location.origin}${window.location.pathname}`;

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = 'multitenant.css?v=3';
  document.head.appendChild(stylesheet);

  function authError(error) {
    const message = String(error?.message || error || 'حدث خطأ غير متوقع');
    if (/already registered/i.test(message)) return 'هذا البريد مسجل بالفعل، استخدم تسجيل الدخول.';
    if (/email rate limit|rate limit/i.test(message)) return 'تم تجاوز حد إرسال البريد مؤقتًا. يلزم ربط خدمة بريد مخصصة.';
    if (/email address not authorized/i.test(message)) return 'خدمة البريد الافتراضية لا تسمح بهذا العنوان. يلزم ربط SMTP مخصص.';
    if (/invalid login credentials/i.test(message)) return 'البريد أو كلمة المرور غير صحيحة.';
    if (/email not confirmed/i.test(message)) return 'أكد بريدك الإلكتروني أولًا من الرسالة المرسلة إليك.';
    if (/email must be confirmed/i.test(message)) return 'لا يمكن اعتماد الحساب قبل تأكيد البريد.';
    if (/password/i.test(message) && /weak|least/i.test(message)) return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.';
    return message;
  }

  function hideMainScreens() {
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
        <h1 id="approvalStatusTitle">طلبك بانتظار موافقة منصور</h1>
        <p id="approvalStatusText">لن يفتح الحساب قبل مراجعته من لوحة الإدارة.</p>
        <div class="approval-actions">
          <button id="refreshApprovalBtn" class="btn btn-primary">تحقق من حالة الطلب</button>
          <button id="approvalLogoutBtn" class="btn btn-ghost">تسجيل الخروج</button>
        </div>
      </div>`;
    document.body.appendChild(screen);
    $('approvalLogoutBtn').onclick = logout;
    $('refreshApprovalBtn').onclick = async () => {
      const button = $('refreshApprovalBtn');
      button.disabled = true;
      try {
        const { data, error } = await client.from('profiles').select('*').eq('id', session.user.id).single();
        if (error) throw error;
        profile = data;
        if (data.account_status === 'approved' && data.is_active) {
          screen.classList.add('hidden');
          await baseEnterApp();
          await renderMembers();
          await renderPlatformRequests();
          showToast('تمت الموافقة على حسابك');
        } else {
          showApprovalState(data);
          showToast('لا يزال الطلب بانتظار الموافقة');
        }
      } catch (error) {
        showToast(authError(error));
      } finally {
        button.disabled = false;
      }
    };
    return screen;
  }

  function showApprovalState(account) {
    const screen = ensureApprovalScreen();
    hideMainScreens();
    screen.classList.remove('hidden');
    const rejected = account.account_status === 'rejected';
    $('approvalStatusIcon').textContent = rejected ? '×' : '✓';
    $('approvalStatusIcon').classList.toggle('rejected', rejected);
    $('approvalStatusKicker').textContent = rejected ? 'تمت مراجعة الطلب' : 'تم تأكيد بريدك';
    $('approvalStatusTitle').textContent = rejected ? 'تعذر قبول طلب التسجيل' : 'طلبك بانتظار موافقة منصور';
    $('approvalStatusText').textContent = rejected
      ? account.rejection_reason || 'تم رفض الطلب. تواصل مع إدارة التطبيق للمراجعة.'
      : 'بياناتك الصحية مغلقة حتى يوافق منصور من لوحة الإدارة.';
    $('refreshApprovalBtn').classList.toggle('hidden', rejected);
  }

  enterApp = async function enterApprovedAccount() {
    const { data, error } = await client.from('profiles').select('*').eq('id', session.user.id).single();
    if (error) throw error;
    profile = data;
    const independent = profile.role === 'admin' && !profile.manager_id && !profile.is_platform_admin;
    if (independent && (profile.account_status !== 'approved' || !profile.is_active)) {
      showApprovalState(profile);
      return;
    }
    $('approvalScreen')?.classList.add('hidden');
    await baseEnterApp();
    await renderMembers();
    await renderPlatformRequests();
  };

  setAuthMode = function publicAuthMode(mode) {
    baseSetAuthMode(mode);
    const signup = mode === 'signup';
    $('authModeToggle').classList.remove('hidden');
    $('authModeToggle').textContent = signup ? 'لدي حساب بالفعل' : 'إنشاء حساب جديد';
    $('authTitle').textContent = signup ? 'إنشاء حساب جديد' : 'تسجيل الدخول';
    $('authHint').textContent = signup
      ? 'سيصلك بريد تأكيد، ثم يراجع منصور طلبك قبل التفعيل.'
      : 'ادخل بحسابك للوصول إلى بياناتك وعائلتك.';
    $('authSubmit').textContent = signup ? 'إنشاء الحساب وإرسال التأكيد' : 'دخول';
  };

  showAuth = async function publicShowAuth(mode = 'login') {
    $('approvalScreen')?.classList.add('hidden');
    await baseShowAuth();
    $('authModeToggle').classList.remove('hidden');
    setAuthMode(mode);
  };

  $('showAuthBtn').onclick = () => showAuth('login');
  $('startFamilyBtn').onclick = () => showAuth('signup');
  document.querySelectorAll('.landing-cta').forEach((button) => { button.onclick = () => showAuth('signup'); });
  $('authModeToggle').onclick = () => setAuthMode($('authForm').dataset.mode === 'signup' ? 'login' : 'signup');

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
            emailRedirectTo: redirectUrl,
            data: { full_name: fullName, account_type: 'independent_admin', approval_required: true },
          },
        });
        if (error) throw error;
        if (data.session) {
          session = data.session;
          await enterApp();
        } else {
          showMessage($('authMessage'), 'تم استلام طلبك. أكد بريدك، وبعدها سيظهر الطلب لمنصور للموافقة.', 'ok');
          setAuthMode('login');
        }
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        session = data.session;
        await enterApp();
      }
    } catch (error) {
      showMessage($('authMessage'), authError(error));
    } finally {
      $('authSubmit').disabled = false;
    }
  };

  const createUserForm = $('createUserForm');
  if (createUserForm) {
    $('newUserPassword')?.closest('.field')?.remove();
    const card = createUserForm.closest('.form-card');
    card.querySelector('.form-card-title h2').textContent = 'دعوة فرد من العائلة';
    card.querySelector('.form-card-title p').textContent = 'سيصله بريد رسمي ليقبل العضوية ويختار كلمة المرور';
    const submit = createUserForm.querySelector('button[type="submit"]');
    submit.textContent = 'إرسال دعوة العضوية';
    createUserForm.onsubmit = async (event) => {
      event.preventDefault();
      showMessage($('createUserMessage'), '');
      const button = event.submitter || submit;
      button.disabled = true;
      try {
        const fullName = $('newUserName').value.trim();
        const email = $('newUserEmail').value.trim().toLowerCase();
        const { data, error } = await client.functions.invoke('invite-family-member', {
          body: { full_name: fullName, email, redirect_to: redirectUrl },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message || 'تعذر إرسال الدعوة');
        showMessage($('createUserMessage'), `تم إرسال الدعوة إلى ${email}. استخدم زر واتساب بجانب العضو لمشاركة التفاصيل.`, 'ok');
        createUserForm.reset();
        await renderMembers();
      } catch (error) {
        showMessage($('createUserMessage'), authError(error));
      } finally {
        button.disabled = false;
      }
    };
  }

  function whatsappText(member) {
    const inviter = profile?.full_name || 'أحد أفراد عائلتك';
    return [
      `مرحبًا ${member.full_name || ''}،`,
      '',
      `دعاك ${inviter} للانضمام كعضو في عائلته داخل تطبيق صحتي العائلية.`,
      `وصل رابط قبول الدعوة إلى بريدك: ${member.email || 'البريد المسجل'}`,
      '',
      'افتح البريد، اقبل الدعوة، ثم اختر كلمة مرور خاصة بك.',
      `رابط التطبيق: ${redirectUrl}`,
      '',
      'لا تشارك كلمة مرورك مع أي شخص.',
    ].join('\n');
  }

  renderMembers = async function renderScopedFamily() {
    const rootId = profile.role === 'admin' ? profile.id : profile.manager_id;
    const query = client.from('profiles').select('*').or(`id.eq.${rootId},manager_id.eq.${rootId}`).order('created_at');
    const { data, error } = await query;
    if (error) throw error;

    familyMembers = data || [];
    if (!familyMembers.some((member) => member.id === profile.id)) familyMembers.unshift(profile);
    familyMembers = familyMembers.filter((member, index, list) => list.findIndex((item) => item.id === member.id) === index);

    const box = $('membersList');
    box.innerHTML = familyMembers.length ? '' : '<div class="empty">لا توجد حسابات بعد</div>';
    familyMembers.forEach((member, index) => {
      const name = member.full_name || 'بدون اسم';
      const invited = member.id !== session.user.id;
      const emailState = member.email_confirmed_at ? 'البريد مؤكد' : 'بانتظار قبول الدعوة';
      const row = document.createElement('div');
      row.className = 'member-card';
      row.innerHTML = `
        <div class="person-avatar ${['amber', 'blue', 'rose'][index % 3]}">${esc(initials(name))}</div>
        <div><h3>${esc(name)}${member.id === profile.id ? ' (أنت)' : ''}</h3><p>${member.role === 'admin' ? 'مدير العائلة' : 'فرد في العائلة'}، ${invited ? emailState : 'الحساب فعال'}</p></div>
        <div class="member-actions">
          <button class="open-member">فتح بياناته</button>
          ${member.id !== session.user.id ? '<button class="nudge-member">إرسال تذكير</button><button class="whatsapp-share"><span>◉</span> واتساب</button>' : ''}
        </div>`;
      row.querySelector('.open-member').onclick = () => openMember(member);
      row.querySelector('.nudge-member')?.addEventListener('click', () => sendNudge(member.id, name));
      row.querySelector('.whatsapp-share')?.addEventListener('click', () => {
        window.open(`https://wa.me/?text=${encodeURIComponent(whatsappText(member))}`, '_blank', 'noopener,noreferrer');
      });
      box.appendChild(row);
    });
    await renderFamilyPulse();
  };

  function ensurePlatformCard() {
    if ($('registrationAdminCard')) return $('registrationAdminCard');
    const layout = document.querySelector('#family .family-layout');
    if (!layout) return null;
    const card = document.createElement('div');
    card.id = 'registrationAdminCard';
    card.className = 'list-card registration-admin-card hidden';
    card.innerHTML = `
      <div class="list-card-head"><div><span class="admin-kicker">إدارة المنصة</span><h2>طلبات تسجيل المستخدمين</h2></div><span id="pendingRegistrationCount">0 طلب</span></div>
      <div id="registrationRequests"></div>`;
    layout.prepend(card);
    return card;
  }

  async function renderPlatformRequests() {
    const card = ensurePlatformCard();
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
    const count = requests.filter((item) => item.account_status === 'pending').length;
    $('pendingRegistrationCount').textContent = `${count} ${count === 1 ? 'طلب' : 'طلبات'}`;
    box.innerHTML = requests.length ? '' : '<div class="empty">لا توجد طلبات تسجيل معلقة</div>';
    requests.forEach((request) => {
      const confirmed = Boolean(request.email_confirmed_at);
      const rejected = request.account_status === 'rejected';
      const row = document.createElement('article');
      row.className = 'registration-request';
      row.innerHTML = `
        <div class="registration-avatar">${esc(initials(request.full_name || 'م'))}</div>
        <div class="registration-details"><h3>${esc(request.full_name || 'بدون اسم')}</h3><p>${esc(request.email || 'لا يوجد بريد')}</p>
          <div class="registration-badges"><span class="${confirmed ? 'confirmed' : 'waiting'}">${confirmed ? 'البريد مؤكد' : 'لم يؤكد البريد'}</span>${rejected ? '<span class="rejected">مرفوض سابقًا</span>' : '<span class="waiting">بانتظار الموافقة</span>'}</div>
          ${request.rejection_reason ? `<small>${esc(request.rejection_reason)}</small>` : ''}
        </div>
        <div class="registration-actions"><button class="approve-registration" ${confirmed ? '' : 'disabled'}>موافقة</button><button class="reject-registration">رفض</button></div>`;
      row.querySelector('.approve-registration').onclick = () => reviewRequest(request.id, 'approved');
      row.querySelector('.reject-registration').onclick = () => reviewRequest(request.id, 'rejected', prompt('سبب الرفض، اختياري:') || '');
      box.appendChild(row);
    });
  }

  async function reviewRequest(userId, decision, reason = '') {
    const { error } = await client.rpc('review_registration', {
      p_target_uid: userId,
      p_decision: decision,
      p_reason: reason || null,
    });
    if (error) return showToast(authError(error));
    showToast(decision === 'approved' ? 'تمت الموافقة على الحساب' : 'تم رفض الطلب');
    await renderPlatformRequests();
  }

  function ensurePasswordModal() {
    if ($('passwordSetupModal')) return $('passwordSetupModal');
    const modal = document.createElement('div');
    modal.id = 'passwordSetupModal';
    modal.className = 'onboarding hidden';
    modal.innerHTML = `
      <div class="onboarding-card"><div class="onboarding-copy"><span>دعوة عضوية عائلية</span><h2>اختر كلمة مرور لحسابك</h2><p>تم ربطك بعائلتك، بقي أن تختار كلمة مرور خاصة بك.</p></div>
        <form id="passwordSetupForm"><div class="field"><label for="invitedPassword">كلمة المرور الجديدة</label><input id="invitedPassword" type="password" minlength="8" required></div><div class="field"><label for="invitedPasswordConfirm">تأكيد كلمة المرور</label><input id="invitedPasswordConfirm" type="password" minlength="8" required></div><div id="passwordSetupMessage"></div><button class="btn btn-primary btn-block" type="submit">حفظ وبدء الاستخدام</button></form>
      </div>`;
    document.body.appendChild(modal);
    $('passwordSetupForm').onsubmit = async (event) => {
      event.preventDefault();
      const password = $('invitedPassword').value;
      const confirmation = $('invitedPasswordConfirm').value;
      if (password.length < 8) return showMessage($('passwordSetupMessage'), 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');
      if (password !== confirmation) return showMessage($('passwordSetupMessage'), 'كلمتا المرور غير متطابقتين');
      const button = event.submitter;
      button.disabled = true;
      const { error } = await client.auth.updateUser({ password, data: { setup_required: false, setup_complete: true } });
      button.disabled = false;
      if (error) return showMessage($('passwordSetupMessage'), authError(error));
      modal.classList.add('hidden');
      showToast('تم تجهيز حساب العضوية بنجاح');
    };
    return modal;
  }

  function showPasswordSetup(currentSession) {
    const metadata = currentSession?.user?.user_metadata || {};
    if (metadata.setup_required && !metadata.setup_complete) ensurePasswordModal().classList.remove('hidden');
  }

  client.auth.onAuthStateChange((_event, newSession) => {
    if (newSession) setTimeout(() => showPasswordSetup(newSession), 0);
  });

  setTimeout(async () => {
    const { data } = await client.auth.getSession();
    if (!data.session) return;
    session = data.session;
    showPasswordSetup(data.session);
    try {
      const { data: account } = await client.from('profiles').select('*').eq('id', session.user.id).single();
      profile = account;
      const pending = account?.role === 'admin' && !account.manager_id && !account.is_platform_admin && account.account_status !== 'approved';
      if (pending) showApprovalState(account);
      else {
        await renderMembers();
        await renderPlatformRequests();
      }
    } catch (_) {
      // The main application displays connection errors.
    }
  }, 700);
})();
