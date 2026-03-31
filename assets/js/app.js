const Toast = {
  container: null,
  maxVisible: 3,
  init() {
    this.container = document.getElementById('toast-container');
  },
  show(message, isError = false) {
    if (!this.container) this.init();
    // Enforce max visible toasts - remove oldest if at limit
    while (this.container.children.length >= this.maxVisible) {
      this.container.removeChild(this.container.firstElementChild);
    }
    const toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' toast--error' : '');
    toast.textContent = message;
    this.container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  },
};

const App = {
  async init() {
    // Preloader
    const preloader = document.getElementById('preloader');
    const minTime = new Promise((r) => setTimeout(r, 1800));

    await Promise.all([minTime, this._waitForLoad()]);
    preloader.classList.add('preloader--hidden');

    Toast.init();

    // Check auth
    try {
      const data = await API.post('api/auth/check', {});
      if (data.authenticated) {
        API.setToken(data.csrf_token);
        const restored = await Crypto.restore();
        if (restored) {
          this.showApp();
          return;
        }
      }
    } catch (e) {}

    this.showLogin();
  },

  _waitForLoad() {
    return new Promise((resolve) => {
      if (document.readyState === 'complete') resolve();
      else window.addEventListener('load', resolve);
    });
  },

  showLogin() {
    document.getElementById('login-view').style.display = 'flex';
    document.getElementById('app-view').style.display = 'none';
    Auth.init();
  },

  showApp() {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'block';
    resetInactivity();

    // Init Lenis
    if (window.Lenis) {
      new Lenis({ autoRaf: true });
    }

    // Restore last tab or default to dashboard
    const savedTab = sessionStorage.getItem('encriptor-tab');
    if (savedTab) {
      window.location.hash = savedTab;
    } else if (!window.location.hash || window.location.hash === '#') {
      window.location.hash = '#dashboard';
    }
    this._initTabs();

    // If restoring to settings or chat, enter that mode
    if ((savedTab || window.location.hash) === '#settings') {
      this.enterSettings();
    }
    Dashboard.init();
    TextTab.init();
    ImageTab.init();
    FileTab.init();
    SteganoTab.init();
    // Logout button
    document.getElementById('logout-btn').addEventListener('click', async () => {
      try { await API.post('api/auth/logout', {}); } catch(e) {}
      Chat.destroy();
      Crypto.clear();
      sessionStorage.clear();
      window.location.reload();
    });

    // Chat button
    document.getElementById('chat-nav-btn').addEventListener('click', () => {
      App.goToTab('#chat');
      Chat.open();
    });

    // Settings cog button
    document.getElementById('settings-nav-btn').addEventListener('click', () => {
      App.enterSettings();
    });

    // Settings sub-nav clicks
    document.querySelectorAll('#nav-settings-tabs .nav__tab[data-settings-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        App.showSettingsSection(btn.dataset.settingsSection);
        document.querySelectorAll('#nav-settings-tabs .nav__tab').forEach(b => b.classList.remove('nav__tab--active'));
        btn.classList.add('nav__tab--active');
      });
    });

    try { Settings.init(); } catch(e) { console.error('Settings init error:', e); }
    try { Chat.init(); } catch(e) { console.error('Chat init error:', e); }

    // If restoring to chat tab, load conversations
    const currentTab = savedTab || window.location.hash;
    if (currentTab === '#chat') {
      try { Chat.open(); } catch(e) {}
    }

    // Apply default encryption type to all dropdowns, then replace with custom selects
    const defEnc = localStorage.getItem('encriptor-default-enc') || 'aes-256-gcm';
    const encSelectIds = ['text-strength', 'image-strength', 'file-strength', 'steg-encode-strength', 'text-manual-strength', 'dec-image-strength', 'dec-file-strength', 'steg-decode-strength'];
    encSelectIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = defEnc;
    });
    // Replace native selects with custom dropdowns
    encSelectIds.forEach(id => { try { new CustomSelect(id); } catch(e) {} });
    // Also replace settings dropdowns
    try { new CustomSelect('settings-default-enc'); } catch(e) {}
    try { new CustomSelect('settings-autolock'); } catch(e) {}
    try { new CustomSelect('settings-sidebar-pos'); } catch(e) {}
    try { new CustomSelect('dec-image-mime-val'); } catch(e) {}
  },

  _initTabs() {
    const tabs = document.querySelectorAll('#nav-main-tabs .nav__tab');
    const sections = document.querySelectorAll('.tab-section');

    const activate = (hash) => {
      const target = hash || '#dashboard';
      tabs.forEach((t) => {
        t.classList.toggle('nav__tab--active', t.dataset.tab === target);
      });
      sections.forEach((s) => {
        s.classList.toggle('tab-section--active', '#' + s.id.replace('-section', '') === target);
      });
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        if (TextTab._hasUnsaved && !confirm('You have unsaved encrypted output. Leave without saving?')) return;
        window.location.hash = tab.dataset.tab;
        sessionStorage.setItem('encriptor-tab', tab.dataset.tab);
        activate(tab.dataset.tab);
      });
    });

    window.addEventListener('hashchange', () => activate(window.location.hash));
    activate(window.location.hash || '#dashboard');
  },

  goToTab(hash) {
    window.location.hash = hash;
    sessionStorage.setItem('encriptor-tab', hash);
    // If leaving settings, restore main nav
    if (hash !== '#settings' && document.getElementById('nav-settings-tabs').style.display !== 'none') {
      document.getElementById('nav-main-tabs').style.display = 'flex';
      document.getElementById('nav-settings-tabs').style.display = 'none';
      document.querySelectorAll('.settings-sub').forEach(s => s.style.display = 'block');
    }
    const tabs = document.querySelectorAll('#nav-main-tabs .nav__tab');
    const sections = document.querySelectorAll('.tab-section');
    tabs.forEach((t) => t.classList.toggle('nav__tab--active', t.dataset.tab === hash));
    sections.forEach((s) => s.classList.toggle('tab-section--active', '#' + s.id.replace('-section', '') === hash));
    window.scrollTo(0, 0);
    if (hash === '#dashboard') Dashboard.load();
    if (hash === '#settings') Settings.load();
  },

  enterSettings() {
    // Switch to settings tab and show settings sidebar
    this.goToTab('#settings');
    document.getElementById('nav-main-tabs').style.display = 'none';
    document.getElementById('nav-settings-tabs').style.display = 'flex';
    // Show first section by default
    this.showSettingsSection('settings-profile-section');
    document.querySelectorAll('#nav-settings-tabs .nav__tab').forEach(b => b.classList.remove('nav__tab--active'));
    document.querySelector('#nav-settings-tabs .nav__tab[data-settings-section="settings-profile-section"]').classList.add('nav__tab--active');
    Settings.load();
  },

  exitSettings() {
    document.getElementById('nav-main-tabs').style.display = 'flex';
    document.getElementById('nav-settings-tabs').style.display = 'none';
    // Show all settings sub-sections again
    document.querySelectorAll('.settings-sub').forEach(s => s.style.display = 'block');
    this.goToTab('#dashboard');
  },

  showSettingsSection(id) {
    document.querySelectorAll('.settings-sub').forEach(s => s.style.display = 'none');
    const target = document.getElementById(id);
    if (target) target.style.display = 'block';
  },

  refreshStats() {
    try { Settings.load(); } catch(e) {}
    try { Dashboard.load(); } catch(e) {}
  },
};

function promptInput(message, title, placeholder) {
  return new Promise((resolve) => {
    const modal = document.getElementById('prompt-modal');
    document.getElementById('prompt-modal-title').textContent = title || 'Enter Key';
    document.getElementById('prompt-modal-message').textContent = message || '';
    const input = document.getElementById('prompt-modal-input');
    input.value = '';
    input.placeholder = placeholder || 'Enter key...';
    modal.classList.remove('modal-overlay--hidden');
    input.focus();

    const okBtn = document.getElementById('prompt-modal-ok');
    const cancelBtn = document.getElementById('prompt-modal-cancel');

    function cleanup() {
      modal.classList.add('modal-overlay--hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    }
    function onOk() { cleanup(); resolve(input.value.trim() || null); }
    function onCancel() { cleanup(); resolve(null); }
    function onKey(e) { if (e.key === 'Enter') onOk(); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

function confirmAction(message, title) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-modal-title').textContent = title || 'Confirm';
    document.getElementById('confirm-modal-message').textContent = message;
    modal.classList.remove('modal-overlay--hidden');

    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    function cleanup() {
      modal.classList.add('modal-overlay--hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
    }
    function onOk() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

let inactivityTimer;
function resetInactivity() {
  clearTimeout(inactivityTimer);
  const timeout = parseInt(localStorage.getItem('encriptor-autolock') || '300000');
  if (timeout === 0) return; // Never auto-lock
  inactivityTimer = setTimeout(() => {
    if (document.getElementById('app-view').style.display !== 'none') {
      Crypto.clear();
      sessionStorage.clear();
      Toast.show('Session locked due to inactivity');
      window.location.reload();
    }
  }, timeout);
}
document.addEventListener('mousemove', resetInactivity);
document.addEventListener('keydown', resetInactivity);
document.addEventListener('click', resetInactivity);

window.addEventListener('beforeunload', (e) => {
  if (TextTab._hasUnsaved) {
    e.preventDefault();
    e.returnValue = '';
  }
});

document.addEventListener('DOMContentLoaded', () => App.init());

// ── STRENGTH BUTTONS (global delegation) ──
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.strength-btn');
  if (!btn) return;
  const target = btn.dataset.target;
  const value = btn.dataset.value;
  // Deactivate siblings
  btn.parentElement.querySelectorAll('.strength-btn').forEach(b => b.classList.remove('strength-btn--active'));
  btn.classList.add('strength-btn--active');
  document.getElementById(target).value = value;
});

// ── KEY EYE TOGGLE (global delegation) ──
document.addEventListener('click', (e) => {
  const eye = e.target.closest('.key-eye');
  if (!eye) return;
  const target = document.getElementById(eye.dataset.target);
  if (!target) return;
  const isHidden = target.classList.contains('key-hidden');
  target.classList.toggle('key-hidden', !isHidden);
  target.classList.toggle('key-visible', isHidden);
  eye.textContent = isHidden ? '\u25C9' : '\u25CB';
});

// ── SUB-TAB SWITCHING (global delegation) ──
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.sub-tab');
  if (!tab) return;
  const container = tab.closest('section') || tab.parentElement.parentElement;
  container.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('sub-tab--active'));
  container.querySelectorAll('.sub-panel').forEach(p => p.style.display = 'none');
  tab.classList.add('sub-tab--active');
  document.getElementById(tab.dataset.panel).style.display = 'block';
});

// ── CUSTOM KEY CHECKBOX TOGGLES ──
// Image decrypt custom key toggle
const dicCheck = document.getElementById('dec-image-custom-check');
if (dicCheck) {
  dicCheck.addEventListener('change', function() {
    document.getElementById('dec-image-vault-wrap').style.display = this.checked ? 'none' : 'flex';
    document.getElementById('dec-image-custom-wrap').style.display = this.checked ? 'flex' : 'none';
  });
}

[
  { check: 'image-custom-key-check', wrap: 'image-custom-key-wrap', vault: 'image-vault-key-wrap', input: 'image-custom-key-input' },
  { check: 'steg-custom-key-check', wrap: 'steg-custom-key-wrap', vault: null, input: 'steg-custom-key-input' },
].forEach(({ check: cid, wrap: wid, vault: vid, input: iid }) => {
  const check = document.getElementById(cid);
  const wrap = document.getElementById(wid);
  const vault = vid ? document.getElementById(vid) : null;
  if (check && wrap) {
    check.addEventListener('change', () => {
      wrap.style.display = check.checked ? 'flex' : 'none';
      if (vault) vault.style.display = check.checked ? 'none' : 'flex';
      if (!check.checked) document.getElementById(iid).value = '';
    });
  }
});

// ── CLICK OUTSIDE MODAL TO CLOSE ──
document.addEventListener('click', (e) => {
  const overlay = e.target.closest('.modal-overlay');
  if (!overlay) return;
  if (e.target === overlay) {
    overlay.classList.add('modal-overlay--hidden');
  }
});
