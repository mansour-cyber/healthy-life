const SUPABASE_URL = 'https://jakqxutwhwygbmgrhkyz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_E3A11k7ecKPoYVbqZaDWOQ_dFJ3Zv6x';
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let session = null;
let profile = null;
let activeOwnerId = null;
let activeOwnerName = '';
let goals = [];
let medications = [];
let schedules = [];
let reminders = [];
let familyMembers = [];
let currentNudges = [];
let onboardingStep = 0;

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const initials = (name) => String(name || 'ع').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('');
const timeLabel = (value) => String(value || '').slice(0, 5);
const isMissingFeature = (error) => error?.code === '42P01' || /does not exist|not found/i.test(error?.message || '');

$('dayPicker').value = dateKey(new Date());

function showMessage(el, text, type = 'error') {
  el.innerHTML = text ? `<div class="${type}">${esc(text)}</div>` : '';
}

function showToast(text) {
  const toast = $('toast');
  toast.textContent = text;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

function formatDate(key) {
  return new Intl.DateTimeFormat('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${key}T12:00:00`));
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'صباح الخير';
  if (hour < 18) return 'مساء الخير';
  return 'مساء النور';
}

function showOnly(screenId) {
  ['landingScreen', 'authScreen', 'appScreen'].forEach((id) => $(id).classList.toggle('hidden', id !== screenId));
}

function showLanding() {
  showOnly('landingScreen');
  $('onboardingScreen').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function isAdminInitialized() {
  const { data, error } = await client.rpc('admin_initialized');
  if (error) throw error;
  return Boolean(data);
}

async function showAuth() {
  showOnly('authScreen');
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
  $('authTitle').textContent = signup ? 'أنشئ عائلتك' : 'تسجيل الدخول';
  $('authHint').textContent = signup
    ? 'أنشئ حساب المدير الرئيسي، ثم أضف أفراد العائلة من داخل التطبيق.'
    : 'ادخل بحسابك للوصول إلى بيانات عائلتك.';
  $('nameField').classList.toggle('hidden', !signup);
  $('authSubmit').textContent = signup ? 'إنشاء حساب العائلة' : 'دخول';
  $('authModeToggle').textContent = signup ? 'لدي حساب بالفعل' : 'إنشاء حساب المدير الأول';
}

$('showAuthBtn').onclick = showAuth;
$('startFamilyBtn').onclick = showAuth;
document.querySelectorAll('.landing-cta').forEach((button) => button.onclick = showAuth);
$('backToLanding').onclick = showLanding;
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
  activeOwnerName = profile.full_name || session.user.email;
  document.body.classList.toggle('admin', profile.role === 'admin');
  $('welcomeOverline').textContent = greeting();
  $('welcomeName').textContent = activeOwnerName;
  $('logoutBtn').textContent = initials(activeOwnerName);
  $('viewingBanner').classList.add('hidden');
  showOnly('appScreen');
  renderProfile();
  await loadAll();
  maybeShowOnboarding();
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
  await renderMembers();
  await loadNudges();
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
    row.innerHTML = `<input class="check" type="checkbox" ${completed ? 'checked' : ''}><div><div class="title">${esc(goal.title)}</div><div class="hint">${esc(goal.category || 'عام')}</div></div><span class="chip">${completed ? 'مكتمل' : 'اليوم'}</span>`;
    row.querySelector('input').onchange = async (e) => {
      const { error } = await client.from('goal_logs').upsert({
        goal_id: goal.id,
        owner_id: activeOwnerId,
        log_date: day,
        completed: e.target.checked
      }, { onConflict: 'goal_id,log_date' });
      if (error) return showToast(error.message);
      await renderToday();
      await renderFamilyPulse();
    };
    $('todayGoals').appendChild(row);
  });

  $('todayMeds').innerHTML = dueSchedules.length ? '' : '<div class="empty">لا توجد جرعات لهذا اليوم</div>';
  dueSchedules.forEach((schedule) => {
    const medication = medications.find((m) => m.id === schedule.medication_id);
    const taken = medLogMap.get(schedule.id)?.status === 'taken';
    const row = document.createElement('label');
    row.className = 'item';
    row.innerHTML = `<input class="check" type="checkbox" ${taken ? 'checked' : ''}><div><div class="title">${esc(medication?.name || 'علاج')}</div><div class="hint">${esc(medication?.instructions || 'اضغط بعد أخذ الجرعة')}</div></div><span class="chip">${esc(timeLabel(schedule.time_of_day))}</span>`;
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
      if (result.error) return showToast(result.error.message);
      await renderToday();
      await renderFamilyPulse();
    };
    $('todayMeds').appendChild(row);
  });

  const todayReminders = reminders.filter((reminder) => (reminder.days_of_week || []).includes(dayOfWeek));
  $('todayReminders').innerHTML = todayReminders.length ? '' : '<div class="empty">لا توجد تذكيرات</div>';
  todayReminders.forEach((reminder) => {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<div class="task-icon reminder">♢</div><div><div class="title">${esc(reminder.title)}</div><div class="hint">${esc(reminderTypeLabel(reminder.reminder_type))}</div></div><span class="chip">${esc(timeLabel(reminder.time_of_day))}</span>`;
    $('todayReminders').appendChild(row);
  });

  const total = dailyGoals.length + dueSchedules.length;
  const doneGoals = dailyGoals.filter((goal) => goalLogMap.get(goal.id)?.completed).length;
  const doneMeds = dueSchedules.filter((schedule) => medLogMap.get(schedule.id)?.status === 'taken').length;
  const score = total ? Math.round(((doneGoals + doneMeds) / total) * 100) : 0;
  $('score').textContent = `${score}%`;
  document.querySelector('.score-ring').style.setProperty('--score-angle', `${score * 3.6}deg`);
}

function reminderTypeLabel(type) {
  return ({ general: 'عام', water: 'شرب الماء', sleep: 'النوم', appointment: 'موعد' })[type] || type || 'عام';
}

function renderGoals() {
  const box = $('goalsList');
  $('goalsCount').textContent = `${goals.length} ${goals.length === 1 ? 'هدف' : 'أهداف'}`;
  box.innerHTML = goals.length ? '' : '<div class="empty">أضف أول هدف صحي</div>';
  goals.forEach((goal) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<div class="task-icon goal">◎</div><div><h3>${esc(goal.title)}</h3><p>${goal.frequency === 'daily' ? 'يومي' : 'أسبوعي'}، ${esc(goal.category || 'عام')}</p></div><button class="delete-button">حذف</button>`;
    row.querySelector('button').onclick = async () => {
      if (!confirm('حذف الهدف؟')) return;
      const { error } = await client.from('goals').delete().eq('id', goal.id);
      if (error) return showToast(error.message);
      await loadAll();
    };
    box.appendChild(row);
  });
}

function renderMedications() {
  const box = $('medsList');
  $('medsCount').textContent = `${medications.length} ${medications.length === 1 ? 'علاج' : 'علاجات'}`;
  box.innerHTML = medications.length ? '' : '<div class="empty">أضف أول علاج</div>';
  medications.forEach((medication) => {
    const times = schedules.filter((s) => s.medication_id === medication.id).map((s) => timeLabel(s.time_of_day)).join('، ');
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<div class="task-icon med">✚</div><div><h3>${esc(medication.name)}</h3><p>${esc(medication.instructions || 'بدون تعليمات')}${times ? `، ${esc(times)}` : ''}</p></div><button class="delete-button">حذف</button>`;
    row.querySelector('button').onclick = async () => {
      if (!confirm('حذف العلاج ومواعيده؟')) return;
      const { error } = await client.from('medications').delete().eq('id', medication.id);
      if (error) return showToast(error.message);
      await loadAll();
    };
    box.appendChild(row);
  });
}

function renderReminders() {
  const box = $('remindersList');
  $('remindersCount').textContent = `${reminders.length} ${reminders.length === 1 ? 'تذكير' : 'تذكيرات'}`;
  box.innerHTML = reminders.length ? '' : '<div class="empty">أضف أول تذكير</div>';
  reminders.forEach((reminder) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<div class="task-icon reminder">♢</div><div><h3>${esc(reminder.title)}</h3><p>${esc(reminderTypeLabel(reminder.reminder_type))}، ${esc(timeLabel(reminder.time_of_day))}</p></div><button class="delete-button">حذف</button>`;
    row.querySelector('button').onclick = async () => {
      if (!confirm('حذف التذكير؟')) return;
      const { error } = await client.from('reminders').delete().eq('id', reminder.id);
      if (error) return showToast(error.message);
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
    category: $('goalCategory').value || 'عام',
    frequency: $('goalFrequency').value
  });
  if (error) return showToast(error.message);
  event.target.reset();
  showToast('تمت إضافة الهدف');
  await loadAll();
};

$('medForm').onsubmit = async (event) => {
  event.preventDefault();
  const { data: medication, error } = await client.from('medications').insert({
    owner_id: activeOwnerId,
    name: $('medName').value.trim(),
    instructions: $('medInstructions').value.trim()
  }).select().single();
  if (error) return showToast(error.message);

  const times = [$('medTime1').value, $('medTime2').value].filter(Boolean);
  const { error: scheduleError } = await client.from('medication_schedules').insert(times.map((time) => ({
    medication_id: medication.id,
    owner_id: activeOwnerId,
    time_of_day: time
  })));
  if (scheduleError) return showToast(scheduleError.message);
  event.target.reset();
  showToast('تمت إضافة العلاج');
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
  if (error) return showToast(error.message);
  event.target.reset();
  showToast('تمت إضافة التذكير');
  await loadAll();
};

function renderProfile() {
  const name = profile.full_name || 'بدون اسم';
  $('profileInfo').innerHTML = `<div class="profile-avatar">${esc(initials(name))}</div><h3>${esc(name)}</h3><p>${esc(session.user.email)}</p><p>${profile.role === 'admin' ? 'مدير العائلة' : 'فرد في العائلة'}</p>`;
}

async function renderMembers() {
  const { data, error } = await client.from('profiles').select('*').order('created_at');
  if (error) throw error;

  familyMembers = data || [];
  if (!familyMembers.some((member) => member.id === profile.id)) familyMembers.unshift(profile);
  familyMembers = familyMembers.filter((member, index, list) => list.findIndex((x) => x.id === member.id) === index);

  const box = $('membersList');
  box.innerHTML = familyMembers.length ? '' : '<div class="empty">لا توجد حسابات بعد</div>';
  familyMembers.forEach((member, index) => {
    const memberName = member.full_name || 'بدون اسم';
    const row = document.createElement('div');
    row.className = 'member-card';
    row.innerHTML = `<div class="person-avatar ${['amber','blue','rose'][index % 3]}">${esc(initials(memberName))}</div><div><h3>${esc(memberName)}${member.id === profile.id ? ' (أنت)' : ''}</h3><p>${member.role === 'admin' ? 'مدير العائلة' : 'فرد في العائلة'}، ${member.is_active ? 'الحساب فعال' : 'الحساب معطل'}</p></div><div class="member-actions"><button class="open-member">فتح بياناته</button>${member.id !== session.user.id ? '<button class="nudge-member">إرسال تذكير</button>' : ''}</div>`;
    row.querySelector('.open-member').onclick = () => openMember(member);
    row.querySelector('.nudge-member')?.addEventListener('click', () => sendNudge(member.id, memberName));
    box.appendChild(row);
  });

  await renderFamilyPulse();
}

async function renderFamilyPulse() {
  const box = $('familyPulse');
  if (!familyMembers.length) {
    box.innerHTML = '<div class="empty">أضف أفراد العائلة لتظهر حالتهم هنا</div>';
    return;
  }

  const memberIds = familyMembers.map((member) => member.id);
  const today = dateKey(new Date());
  const dayOfWeek = new Date().getDay();
  const [scheduleResult, medResult, logResult] = await Promise.all([
    client.from('medication_schedules').select('*').in('owner_id', memberIds).eq('enabled', true),
    client.from('medications').select('*').in('owner_id', memberIds).eq('active', true),
    client.from('medication_logs').select('*').in('owner_id', memberIds).eq('log_date', today)
  ]);

  if (scheduleResult.error || medResult.error || logResult.error) {
    box.innerHTML = '<div class="empty">تعذر تحميل حالة العائلة</div>';
    return;
  }

  const allSchedules = scheduleResult.data || [];
  const allLogs = logResult.data || [];
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  box.innerHTML = '';
  familyMembers.forEach((member, index) => {
    const due = allSchedules.filter((schedule) => schedule.owner_id === member.id && (schedule.days_of_week || []).includes(dayOfWeek));
    const takenIds = new Set(allLogs.filter((log) => log.owner_id === member.id && log.status === 'taken').map((log) => log.schedule_id));
    const missed = due.filter((schedule) => {
      const [hours, minutes] = timeLabel(schedule.time_of_day).split(':').map(Number);
      return !takenIds.has(schedule.id) && (hours * 60 + minutes) < nowMinutes;
    });
    const done = due.filter((schedule) => takenIds.has(schedule.id)).length;
    const statusText = missed.length ? `${missed.length} متأخرة` : due.length ? `${done}/${due.length} جرعات` : 'لا جرعات';
    const statusClass = missed.length ? 'warn' : 'good';
    const card = document.createElement('article');
    card.className = `family-status-card ${member.id === activeOwnerId ? 'active-person' : ''}`;
    card.innerHTML = `<div class="person-avatar ${['amber','blue','rose'][index % 3]}">${esc(initials(member.full_name))}</div><div><b>${esc(member.full_name || 'بدون اسم')}</b><small>${missed.length ? 'يحتاج تذكيرًا الآن' : due.length ? 'متابع اليوم' : 'لا توجد مهام دوائية'}</small></div><div class="family-status-actions"><em class="${statusClass}">${statusText}</em>${missed.length && member.id !== session.user.id ? '<button>ذكّره الآن</button>' : ''}</div>`;
    card.querySelector('button')?.addEventListener('click', () => sendNudge(member.id, member.full_name || 'فرد العائلة', missed[0]?.id));
    card.ondblclick = () => openMember(member);
    box.appendChild(card);
  });
}

async function openMember(member) {
  activeOwnerId = member.id;
  activeOwnerName = member.full_name || 'فرد العائلة';
  $('viewingName').textContent = `أنت تعرض بيانات: ${activeOwnerName}`;
  $('viewingBanner').classList.toggle('hidden', member.id === profile.id);
  await loadAll();
  setPanel('today');
}

$('viewSelfBtn').onclick = async () => {
  activeOwnerId = profile.id;
  activeOwnerName = profile.full_name || session.user.email;
  $('viewingBanner').classList.add('hidden');
  await loadAll();
};

$('createUserForm').onsubmit = async (event) => {
  event.preventDefault();
  showMessage($('createUserMessage'), '');
  const submitButton = event.submitter;
  submitButton.disabled = true;
  const { data, error } = await client.functions.invoke('admin-create-user', {
    body: {
      full_name: $('newUserName').value.trim(),
      email: $('newUserEmail').value.trim(),
      password: $('newUserPassword').value
    }
  });
  submitButton.disabled = false;
  if (error || data?.error) {
    const message = data?.error || error?.message || 'تعذر إنشاء الحساب. يلزم نشر وظيفة Supabase أولًا.';
    return showMessage($('createUserMessage'), message);
  }
  showMessage($('createUserMessage'), 'تم إنشاء الحساب وربطه بالعائلة', 'ok');
  event.target.reset();
  await renderMembers();
};

async function sendNudge(recipientId, recipientName, scheduleId = null) {
  if (recipientId === session.user.id) return;
  const senderName = profile.full_name || 'أحد أفراد العائلة';
  const message = `${senderName} يذكّرك بلطف بمتابعة صحتك اليوم.`;
  const { error } = await client.from('family_nudges').insert({
    sender_id: session.user.id,
    recipient_id: recipientId,
    medication_schedule_id: scheduleId,
    message
  });
  if (error) {
    if (isMissingFeature(error)) return showToast('ميزة التذكير العائلي تحتاج تطبيق تحديث قاعدة البيانات الجديد');
    return showToast(error.message);
  }
  showToast(`تم إرسال التذكير إلى ${recipientName}`);
}

async function loadNudges() {
  const { data, error } = await client.from('family_nudges')
    .select('*, sender:profiles!family_nudges_sender_id_fkey(full_name)')
    .eq('recipient_id', session.user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    if (isMissingFeature(error)) {
      $('nudgeInbox').classList.add('hidden');
      $('notificationBadge').classList.add('hidden');
      return;
    }
    return;
  }

  currentNudges = data || [];
  const box = $('nudgeInbox');
  const badge = $('notificationBadge');
  badge.textContent = currentNudges.length;
  badge.classList.toggle('hidden', !currentNudges.length);
  box.classList.toggle('hidden', !currentNudges.length);
  box.innerHTML = currentNudges.map((nudge) => `<div class="nudge-row"><div><b>${esc(nudge.sender?.full_name || 'العائلة')} يذكّرك ♡</b><small>${esc(nudge.message)}</small></div><button data-nudge-id="${esc(nudge.id)}">تم الاطلاع</button></div>`).join('');
  box.querySelectorAll('[data-nudge-id]').forEach((button) => button.onclick = () => markNudgeRead(button.dataset.nudgeId));
}

async function markNudgeRead(id) {
  const { error } = await client.from('family_nudges').update({ status: 'read', read_at: new Date().toISOString() }).eq('id', id);
  if (error) return showToast(error.message);
  await loadNudges();
}

$('notificationBtn').onclick = () => {
  if (!currentNudges.length) return showToast('لا توجد تنبيهات جديدة');
  $('nudgeInbox').scrollIntoView({ behavior: 'smooth', block: 'center' });
};

function setPanel(tabName) {
  document.querySelectorAll('.tab,.panel').forEach((el) => el.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tabName}"]`)?.classList.add('active');
  $(tabName)?.classList.add('active');
  $('quickAddSheet').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('.tab').forEach((button) => button.onclick = () => setPanel(button.dataset.tab));
document.querySelectorAll('[data-open-tab]').forEach((button) => button.onclick = () => setPanel(button.dataset.openTab));
$('quickAddBtn').onclick = () => $('quickAddSheet').classList.remove('hidden');
document.querySelectorAll('[data-close-sheet]').forEach((button) => button.onclick = () => $('quickAddSheet').classList.add('hidden'));

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

const onboardingSlides = [
  { icon: '♡', title: 'أضف عائلتك', text: 'أنشئ حسابًا لكل فرد حتى تظهر حالته الصحية في لوحة عائلية واحدة.' },
  { icon: '＋', title: 'أضف هدفًا أو علاجًا', text: 'من زر الإضافة اختر هدفًا صحيًا أو علاجًا، ثم حدد الوقت والتكرار.' },
  { icon: '✓', title: 'تابعوا وذكّروا بعضكم', text: 'عند تأخر جرعة، يظهر ذلك للعائلة ويمكن إرسال تذكير لطيف مباشرة.' }
];

function renderOnboarding() {
  const slide = onboardingSlides[onboardingStep];
  $('onboardingIcon').textContent = slide.icon;
  $('onboardingStepLabel').textContent = `${onboardingStep + 1} من ${onboardingSlides.length}`;
  $('onboardingTitle').textContent = slide.title;
  $('onboardingText').textContent = slide.text;
  $('nextOnboarding').textContent = onboardingStep === onboardingSlides.length - 1 ? 'ابدأ الآن' : 'التالي';
  document.querySelectorAll('#onboardingDots i').forEach((dot, index) => dot.classList.toggle('active', index === onboardingStep));
}

function maybeShowOnboarding() {
  const key = `family-health-onboarding-${session.user.id}`;
  if (localStorage.getItem(key)) return;
  onboardingStep = 0;
  renderOnboarding();
  $('onboardingScreen').classList.remove('hidden');
}

function finishOnboarding() {
  localStorage.setItem(`family-health-onboarding-${session.user.id}`, 'done');
  $('onboardingScreen').classList.add('hidden');
}

$('nextOnboarding').onclick = () => {
  if (onboardingStep < onboardingSlides.length - 1) {
    onboardingStep += 1;
    renderOnboarding();
  } else {
    finishOnboarding();
  }
};
$('skipOnboarding').onclick = finishOnboarding;

async function logout() {
  await client.auth.signOut();
  session = null;
  profile = null;
  showLanding();
}

$('logoutBtn').onclick = logout;
$('profileLogoutBtn').onclick = logout;

client.auth.onAuthStateChange((_event, newSession) => {
  if (!newSession && session) showLanding();
});

(async function boot() {
  try {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    session = data.session;
    if (session) await enterApp();
    else showLanding();
  } catch (error) {
    showLanding();
    showToast(`تعذر بدء التطبيق: ${error.message}`);
  }
})();
