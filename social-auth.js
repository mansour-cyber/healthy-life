(() => {
  const redirectUrl = 'https://mansour-cyber.github.io/healthy-life/';

  const style = document.createElement('style');
  style.textContent = `
    .social-auth{display:grid;gap:10px;margin:0 0 18px}
    .social-auth.hidden{display:none}
    .social-divider{display:flex;align-items:center;gap:12px;color:#82928d;font-size:12px;margin:2px 0}
    .social-divider::before,.social-divider::after{content:"";height:1px;background:#dfe8e4;flex:1}
    .social-button{min-height:48px;border:1px solid #dadce0;border-radius:14px;background:#fff;color:#202124;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:12px;transition:.2s ease;box-shadow:0 1px 2px rgba(60,64,67,.08)}
    .social-button:hover{border-color:#b8c4c0;box-shadow:0 2px 5px rgba(60,64,67,.14);transform:translateY(-1px)}
    .social-button:disabled{opacity:.55;cursor:wait;transform:none}
    .google-logo{width:20px;height:20px;display:block;flex:0 0 20px}
    .social-note{margin:0;text-align:center;color:#7a8c86;font-size:11px;line-height:1.7}
  `;
  document.head.appendChild(style);

  function friendlyError(error) {
    const message = String(error?.message || error || 'تعذر تسجيل الدخول');
    if (/provider.*not enabled|unsupported provider/i.test(message)) {
      return 'دخول Google غير مفعّل في إعدادات المصادقة.';
    }
    if (/redirect|callback/i.test(message)) {
      return 'تعذر إكمال العودة إلى التطبيق. تحقق من رابط التحويل.';
    }
    return message;
  }

  function ensureGoogleButton() {
    if ($('socialAuth')) return $('socialAuth');
    const form = $('authForm');
    if (!form) return null;

    const box = document.createElement('div');
    box.id = 'socialAuth';
    box.className = 'social-auth';
    box.innerHTML = `
      <button id="googleSignInBtn" class="social-button" type="button" aria-label="المتابعة باستخدام Google">
        <svg class="google-logo" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.714v2.258h2.909c1.702-1.567 2.684-3.874 2.684-6.612z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.183l-2.91-2.258c-.805.54-1.835.859-3.046.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18z"/>
          <path fill="#FBBC05" d="M3.963 10.704A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.167.281-1.704V4.964H.956A9 9 0 0 0 0 9c0 1.45.347 2.823.956 4.036l3.007-2.332z"/>
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.507.454 3.441 1.346l2.582-2.582C13.463.891 11.426 0 9 0A9 9 0 0 0 .956 4.964l3.007 2.332C4.672 5.167 6.656 3.58 9 3.58z"/>
        </svg>
        <span>المتابعة باستخدام Google</span>
      </button>
      <div class="social-divider"><span>أو بالبريد الإلكتروني</span></div>
      <p class="social-note">عند أول دخول يُنشأ طلب تسجيل، وتبقى البيانات الصحية مغلقة حتى موافقة الإدارة.</p>`;

    form.insertAdjacentElement('beforebegin', box);
    $('googleSignInBtn').onclick = signInWithGoogle;

    const observer = new MutationObserver(() => {
      box.classList.toggle('hidden', form.classList.contains('hidden'));
    });
    observer.observe(form, { attributes: true, attributeFilter: ['class'] });
    return box;
  }

  async function signInWithGoogle() {
    const button = $('googleSignInBtn');
    if (!button) return;
    button.disabled = true;
    showMessage($('authMessage'), '');

    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          scopes: 'openid email profile',
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) throw error;
    } catch (error) {
      button.disabled = false;
      showMessage($('authMessage'), friendlyError(error));
    }
  }

  ensureGoogleButton();
})();
