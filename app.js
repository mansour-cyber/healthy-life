const SUPABASE_URL = 'https://jakqxutwhwygbmqrhkyz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_E3A11k7ecKPoYVbqZaDWOQ_dFJ3Zv6x';
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let session = null;
let profile = null;
let activeOwnerId = null;
let goals = [];
let medications = [];
let schedules = [];
let reminders = [];

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));

$('dayPicker').value = dateKey(new Date());

function showMessage(el, text, type = 'error') {
  el.innerHTML = text ? `<div class="${type}">${esc(text)}</div>` : '';
}

function formatDate(key) {
  return new Intl.DateTimeFormat('ar-SA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date(`${key}T12:00:00`));
}

async function isAdminInitialized() {
  const { data, error } = await client.rpc('admin_initialized');
  if (error) throw error;
  return Boolean(data);
}

async function showAuth() {
  $('authScreen').classList.remove('hidden');
  $('appScreen').classList.add('hidden');
  $('authForm').reset();
  showMessage($('authMessage'), '');

  try {
    const initialized = await isAdminInitialized();
    $('authModeToggle').classList.toggle('hidden', initialized);
    setAuthMode(initialized ? 'login' : 'signup');
  } catch (error) {
    setAuthMode('login');
    showMessage($('authMessage'), `تعذر الاتصال بقاعدة البيانات: ${error.message}`);
  }
}

function setAuthMode(mode) {
  const signup = mode === 'signup';
  $('authForm').dataset.mode = mode;
  $('authTitle').textContent = signup ? 'إنشاء حساب المدير الأول' : 'تسجيل الدخول';
  $('authHint').textContent = signup
    ? 'أنشئ حسابك الآن ليكون حساب المدير الرئيسي.'
    : 'ادخل بحسابك للوصول إلى بياناتك.';
  $('nameField').classList.toggle('hidden', !signup);
  $('authSubmit').textContent = signup ? 'إنشاء حساب المدير' : 'دخول';
  $('authModeToggle').textContent = signup ? 'العودة لتسجيل الدخول' : 'إنشاء حساب المدير الأول';
}

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
      if (!fullName) throw new Error('اكتب الاسم');
      if (password.length < 8) throw new Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');

      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } }
      });
      if (error) throw error;

      if (data.session) {
        const { error: claimError } = await client.rpc('claim_first_admin', { p_full_name: fullName });
        if (claimError) throw claimError;
        session = data.session;
        await enterApp();
      } else {
        showMessage($('authMessage'), 'تم إنشاء الحساب. افتح رسالة التأكيد في بريدك ثم سجل الدخول.', 'ok');
        setAuthMode('login');
      }
    } else {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      session = data.session;

      if (!(await isAdminInitialized())) {
        const { error: claimError } = await client.rpc('claim_first_admin', {
          p_full_name: data.user.user_metadata?.full_name || ''
        });
        if (claimError) throw claimError;
      }
      await enterApp();
    }
  } catch (error) {
    const message = error?.message === 'Load failed'
      ? 'تعذر الوصول إلى Supabase. حدّث الصفحة وحاول مرة أخرى.'
      : error?.message || 'حدث خطأ غير متوقع';
    showMessage($('authMessage'), message);
  } finally {
    $('authSubmit').disabled = false;
  }
};

async function enterApp() {
  const userId = session.user.id;
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;

  profile = data;
  activeOwnerId = userId;
  document.body.classList.toggle('admin', profile.role === 'admin');
  $('welcomeName').textContent = `مرحبًا، ${profile.full_name || session.user.email}`;
  $('viewingName').textContent = '';
  $('authScreen').classList.add('hidden');
  $('appScreen').classList.remove('hidden');
  renderProfile();
  await loadAll();
}

async function loadAll() {
  const ownerId = activeOwnerId;
  const [goalResult, medResult, scheduleResult, reminderResult] = await Promise.all([
    client.from('goals').select('*').eq('owner_id', ownerId).eq('active', true).order('sort_order'),
    client.from('medications').select('*').eq('owner_id', ownerId).eq('active', true).order('created_at'),
    client.from('medication_schedules').select('*').eq('owner_id', ownerId).eq('enabled', true).order('time_of_day'),
    client.from('reminders').select('*').eq('owner_id', ownerId).eq('enabled', true).order('time_of_day')
  ]);

  for (const result of [goalResult, medResult, scheduleResult, reminderResult]) {
    if (result.error) throw result.error;
  }

  goals = goalResult.data || [];
  medications = medResult.data || [];
  schedules = scheduleResult.data || [];
  reminders = reminderResult.data || [];

  await renderToday();
  renderGoals();
  renderMedications();
  renderReminders();
  if (profile.role === 'admin') await renderMembers();
}

async function renderToday() {
  const day = $('dayPicker').value;
  $('dayLabel').textContent = formatDate(day);
  const dayOfWeek = new Date(`${day}T12:00:00`).getDay();

  const [goalLogResult, medLogResult] = await Promise.all([
    client.from('goal_logs').select('*').eq('owner_id', activeOwnerId).eq('log_date', day),
    client.from('medication_logs').select('*').eq('owner_id', activeOwnerId).eq('log_date', day)
  ]);
  if (goalLogResult.error) throw goalLogResult.error;
  if (medLogResult.error) throw medLogResult.error;

  const goalLogMap = new Map((goalLogResult.data || []).map((x) => [x.goal_id, x]));
  const medLogMap = new Map((medLogResult.data || []).map((x) => [x.schedule_id, x]));
  const dailyGoals = goals.filter((goal) => goal.frequency === 'daily');
  const dueSchedules = schedules.filter((schedule) => (schedule.days_of_week || []).includes(dayOfWeek));

  $('todayGoals').innerHTML = dailyGoals.length ? '' : '<div class="empty">لا توجد أهداف يومية</div>';
  dailyGoals.forEach((goal) => {
    const completed = Boolean(goalLogMap.get(goal.id)?.completed);
    const row = document.createElement('label');
    row.className = 'item';
    row.innerHTML = `<input class="check" type="checkbox" ${completed ? 'checked' : ''}><div><div class="title">${esc(goal.title)}</div><div class="hint">${esc(goal.category || 'عام')}</div></div>`;
    row.querySelector('input').onchange = async (e) => {
      const { error } = await client.from('goal_logs').upsert({
        goal_id: goal.id,
        owner_id: activeOwnerId,
        log_date: day,
        completed: e.target.checked
      }, { onConflict: 'goal_id,log_date' });
      if (error) return alert(error.message);
      await renderToday();
    };
    $('todayGoals').appendChild(row);
  });

  $('todayMeds').innerHTML = dueSchedules.length ? '' : '<div class="empty">لا توجد جرعات لهذا اليوم</div>';
  dueSchedules.forEach((schedule) => {
    const medication = medications.find((m) => m.id === schedule.medication_id);
    const taken = medLogMap.get(schedule.id)?.status === 'taken';
    const row = document.createElement('label');
    row.className = 'item';
    row.innerHTML = `<input class="check" type="checkbox" ${taken ? 'checked' : ''}><div><div class="title">${esc(medication?.name || 'علاج')}</div><div class="hint">${esc(medication?.instructions || 'اضغط بعد أخذ الجرعة')}</div></div><span class="chip">${esc(String(schedule.time_of_day).slice(0, 5))}</span>`;
    row.querySelector('input').onchange = async (e) => {
      let result;
      if (e.target.checked) {
        result = await client.from('medication_logs').upsert({
          schedule_id: schedule.id,
          owner_id: activeOwnerId,
          log_date: day,
          status: 'taken',
          taken_at: new Date().toISOString()
        }, { onConflict: 'schedule_id,log_date' });
      } else {
        result = await client.from('medication_logs').delete().eq('schedule_id', schedule.id).eq('log_date', day);
      }
      if (result.error) return alert(result.error.message);
      await renderToday();
    };
    $('todayMeds').appendChild(row);
  });

  const todayReminders = reminders.filter((reminder) => (reminder.days_of_week || []).includes(dayOfWeek));
  $('todayReminders').innerHTML = todayReminders.length ? '' : '<div class="empty">لا توجد تذكيرات</div>';
  todayReminders.forEach((reminder) => {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<div>🔔</div><div><div class="title">${esc(reminder.title)}</div><div class="hint">${esc(reminder.reminder_type)}</div></div><span class="chip">${esc(String(reminder.time_of_day).slice(0, 5))}</span>`;
    $('todayReminders').appendChild(row);
  });

  const total = dailyGoals.length + dueSchedules.length;
  const doneGoals = [...goalLogMap.values()].filter((x) => x.completed).length;
  const doneMeds = [...medLogMap.values()].filter((x) => x.status === 'taken').length;
  const score = total ? Math.round(((doneGoals + doneMeds) / total) * 100) : 0;
  $('score').textContent = `${score}%`;
  $('bar').style.width = `${score}%`;
}

function renderGoals() {
  const box = $('goalsList');
  box.innerHTML = goals.length ? '' : '<div class="empty">أضف أول هدف</div>';
  goals.forEach((goal) => {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<div>🎯</div><div><div class="title">${esc(goal.title)}</div><div class="hint">${goal.frequency === 'daily' ? 'يومي' : 'أسبوعي'}، ${esc(goal.category)}</div></div><button class="chip">حذف</button>`;
    row.querySelector('button').onclick = async () => {
      if (!confirm('حذف الهدف؟')) return;
      const { error } = await client.from('goals').delete().eq('id', goal.id);
      if (error) return alert(error.message);
      await loadAll();
    };
    box.appendChild(row);
  });
}

function renderMedications() {
  const box = $('medsList');
  box.innerHTML = medications.length ? '' : '<div class="empty">أضف أول علاج</div>';
  medications.forEach((medication) => {
    const times = schedules.filter((s) => s.medication_id === medication.id).map((s) => String(s.time_of_day).slice(0, 5)).join('، ');
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<div>💊</div><div><div class="title">${esc(medication.name)}</div><div class="hint">${esc(medication.instructions || '')}${times ? ` - ${esc(times)}` : ''}</div></div><button class="chip">حذف</button>`;
    row.querySelector('button').onclick = async () => {
      if (!confirm('حذف العلاج ومواعيده؟')) return;
      const { error } = await client.from('medications').delete().eq('id', medication.id);
      if (error) return alert(error.message);
      await loadAll();
    };
    box.appendChild(row);
  });
}

function renderReminders() {
  const box = $('remindersList');
  box.innerHTML = reminders.length ? '' : '<div class="empty">أضف أول تذكير</div>';
  reminders.forEach((reminder) => {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<div>🔔</div><div><div class="title">${esc(reminder.title)}</div><div class="hint">${esc(reminder.reminder_type)}</div></div><button class="chip">${esc(String(reminder.time_of_day).slice(0, 5))}، حذف</button>`;
    row.querySelector('button').onclick = async () => {
      if (!confirm('حذف التذكير؟')) return;
      const { error } = await client.from('reminders').delete().eq('id', reminder.id);
      if (error) return alert(error.message);
      await loadAll();
    };
    box.appendChild(row);
  });
}

$('goalForm').onsubmit = async (event) => {
  event.preventDefault();
  const { error } = await client.from('goals').insert({
    owner_id: activeOwnerId,
    title: $('goalTitle').value.trim(),
    category: $('goalCategory').value.trim() || 'عام',
    frequency: $('goalFrequency').value
  });
  if (error) return alert(error.message);
  event.target.reset();
  $('goalCategory').value = 'عام';
  await loadAll();
};

$('medForm').onsubmit = async (event) => {
  event.preventDefault();
  const { data: medication, error } = await client.from('medications').insert({
    owner_id: activeOwnerId,
    name: $('medName').value.trim(),
    instructions: $('medInstructions').value.trim()
  }).select().single();
  if (error) return alert(error.message);

  const times = [$('medTime1').value, $('medTime2').value].filter(Boolean);
  const { error: scheduleError } = await client.from('medication_schedules').insert(times.map((time) => ({
    medication_id: medication.id,
    owner_id: activeOwnerId,
    time_of_day: time
  })));
  if (scheduleError) return alert(scheduleError.message);
  event.target.reset();
  await loadAll();
};

$('reminderForm').onsubmit = async (event) => {
  event.preventDefault();
  const { error } = await client.from('reminders').insert({
    owner_id: activeOwnerId,
    title: $('reminderTitle').value.trim(),
    reminder_type: $('reminderType').value,
    time_of_day: $('reminderTime').value
  });
  if (error) return alert(error.message);
  event.target.reset();
  await loadAll();
};

function renderProfile() {
  $('profileInfo').innerHTML = `<p><b>${esc(profile.full_name || 'بدون اسم')}</b></p><p class="sub">${esc(session.user.email)}</p><p class="sub">نوع الحساب: ${profile.role === 'admin' ? 'مدير' : 'مستخدم'}</p>`;
}

async function renderMembers() {
  const { data, error } = await client.from('profiles').select('*').eq('manager_id', profile.id).order('created_at');
  if (error) throw error;
  const members = data || [];
  const box = $('membersList');
  box.innerHTML = members.length ? '' : '<div class="empty">لا توجد حسابات بعد</div>';
  members.forEach((member) => {
    const row = document.createElement('div');
    row.className = 'member-card';
    row.innerHTML = `<div class="row between"><div><b>${esc(member.full_name || 'بدون اسم')}</b><div class="sub">${member.is_active ? 'فعال' : 'معطل'}</div></div><button class="btn secondary">فتح بياناته</button></div>`;
    row.querySelector('button').onclick = async () => {
      activeOwnerId = member.id;
      $('viewingName').textContent = `أنت تدير بيانات: ${member.full_name}`;
      $('viewSelfBtn').classList.remove('hidden');
      await loadAll();
      document.querySelector('[data-tab="today"]').click();
    };
    box.appendChild(row);
  });
}

$('viewSelfBtn').onclick = async () => {
  activeOwnerId = profile.id;
  $('viewingName').textContent = '';
  $('viewSelfBtn').classList.add('hidden');
  await loadAll();
};

$('createUserForm').onsubmit = async (event) => {
  event.preventDefault();
  showMessage($('createUserMessage'), '');
  const { data, error } = await client.functions.invoke('admin-create-user', {
    body: {
      full_name: $('newUserName').value.trim(),
      email: $('newUserEmail').value.trim(),
      password: $('newUserPassword').value
    }
  });
  if (error || data?.error) {
    const message = data?.error || error?.message || 'تعذر إنشاء الحساب. يلزم نشر وظيفة Supabase أولًا.';
    return showMessage($('createUserMessage'), message);
  }
  showMessage($('createUserMessage'), 'تم إنشاء الحساب', 'ok');
  event.target.reset();
  await renderMembers();
};

$('logoutBtn').onclick = async () => {
  await client.auth.signOut();
  session = null;
  profile = null;
  await showAuth();
};

$('prevDay').onclick = async () => {
  const d = new Date(`${$('dayPicker').value}T12:00:00`);
  d.setDate(d.getDate() - 1);
  $('dayPicker').value = dateKey(d);
  await renderToday();
};

$('todayBtn').onclick = async () => {
  $('dayPicker').value = dateKey(new Date());
  await renderToday();
};

$('dayPicker').onchange = renderToday;

document.querySelectorAll('.tab').forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll('.tab,.panel').forEach((el) => el.classList.remove('active'));
    button.classList.add('active');
    $(button.dataset.tab).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
});

client.auth.onAuthStateChange((_event, newSession) => {
  if (!newSession && session) showAuth();
});

(async function boot() {
  try {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    session = data.session;
    if (session) await enterApp();
    else await showAuth();
  } catch (error) {
    await showAuth();
    showMessage($('authMessage'), `تعذر بدء التطبيق: ${error.message}`);
  }
})();
