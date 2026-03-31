const Settings = {
  init() {
    this.displayNameInput = document.getElementById('settings-display-name');
    this.saveNameBtn = document.getElementById('settings-save-name');
    this.autoClearToggle = document.getElementById('settings-auto-clear');
    this.confirmDeleteToggle = document.getElementById('settings-confirm-delete');
    this.themeToggle = document.getElementById('settings-theme-toggle');
    this.deleteDataBtn = document.getElementById('settings-delete-data');
    this.deleteAccountBtn = document.getElementById('settings-delete-account');
    this.userHash = document.getElementById('settings-user-hash');
    this.createdAt = document.getElementById('settings-created-at');

    this.autoSaveToggle = document.getElementById('settings-auto-save');

    this.saveNameBtn.addEventListener('click', () => this.saveName());
    document.getElementById('settings-save-uid').addEventListener('click', () => this.saveUniqueId());
    this.autoClearToggle.addEventListener('click', () => this.toggleSetting('auto_clear', this.autoClearToggle));
    this.confirmDeleteToggle.addEventListener('click', () => this.toggleSetting('confirm_delete', this.confirmDeleteToggle));
    this.autoSaveToggle.addEventListener('click', () => this.toggleSetting('auto_save', this.autoSaveToggle));
    this.themeToggle.addEventListener('click', () => this.toggleTheme());
    this.deleteDataBtn.addEventListener('click', () => this.deleteAllData());
    this.deleteAccountBtn.addEventListener('click', () => this.deleteAccount());

    // PIN controls
    this._hasPIN = false;
    document.getElementById('pin-enable-btn').addEventListener('click', () => this.showPinSetup('enable'));
    document.getElementById('pin-disable-btn').addEventListener('click', () => this.showPinSetup('disable'));
    document.getElementById('pin-submit-btn').addEventListener('click', () => this.submitPin());
    document.getElementById('pin-cancel-btn').addEventListener('click', () => this.hidePinSetup());

    // TOTP controls
    document.getElementById('totp-enable-btn').addEventListener('click', () => this.showTotpSetup());
    document.getElementById('totp-disable-btn').addEventListener('click', () => this.showTotpDisable());
    document.getElementById('totp-confirm-btn').addEventListener('click', () => this.confirmTotp());
    document.getElementById('totp-cancel-btn').addEventListener('click', () => this.hideTotpSetup());
    document.getElementById('totp-disable-confirm-btn').addEventListener('click', () => this.disableTotp());
    document.getElementById('totp-disable-cancel-btn').addEventListener('click', () => this.hideTotpDisable());

    // Export / Import
    document.getElementById('settings-export-vault').addEventListener('click', () => this.exportVault());
    document.getElementById('settings-import-vault').addEventListener('click', () => {
      document.getElementById('settings-import-file').click();
    });
    document.getElementById('settings-import-file').addEventListener('change', (e) => {
      if (e.target.files.length) this.importVault(e.target.files[0]);
      e.target.value = '';
    });

    // Default encryption type
    const defEncSelect = document.getElementById('settings-default-enc');
    const savedDefEnc = localStorage.getItem('encriptor-default-enc') || 'aes-256-gcm';
    defEncSelect.value = savedDefEnc;
    defEncSelect.addEventListener('change', () => {
      localStorage.setItem('encriptor-default-enc', defEncSelect.value);
      // Update all encrypt dropdowns to the new default
      ['text-strength', 'image-strength', 'file-strength', 'steg-encode-strength', 'text-manual-strength', 'dec-image-strength', 'dec-file-strength', 'steg-decode-strength'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = defEncSelect.value;
      });
      Toast.show('Default encryption type updated');
    });

    // Auto-lock timeout
    const autolockSelect = document.getElementById('settings-autolock');
    const savedAutolock = localStorage.getItem('encriptor-autolock') || '300000';
    autolockSelect.value = savedAutolock;
    autolockSelect.addEventListener('change', () => {
      localStorage.setItem('encriptor-autolock', autolockSelect.value);
      resetInactivity();
      Toast.show('Auto-lock timeout updated');
    });

    // Regenerate seed phrase
    document.getElementById('regen-seed-btn').addEventListener('click', () => this.showRegenSeed());
    document.getElementById('regen-verify-btn').addEventListener('click', () => this.verifyRegenSeed());
    document.getElementById('regen-cancel-btn').addEventListener('click', () => this.hideRegenSeed());
    document.getElementById('regen-copy-btn').addEventListener('click', () => this._copyRegenSeed());
    document.getElementById('regen-done-btn').addEventListener('click', () => this.completeRegenSeed());

    // Timezone
    this._initTimezone();

    // Session info
    this._initSession();

    // Appearance controls
    document.getElementById('settings-sidebar-pos').addEventListener('change', (e) => {
      if (e.target.value === 'right') {
        document.documentElement.setAttribute('data-sidebar', 'right');
      } else {
        document.documentElement.removeAttribute('data-sidebar');
      }
      localStorage.setItem('encriptor-sidebar', e.target.value);
    });

    // Restore all appearance settings from localStorage
    const savedTheme = localStorage.getItem('encriptor-theme') || 'dark';
    if (savedTheme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      this.themeToggle.classList.add('toggle--active');
    }


    // Clear any leftover accent color
    document.documentElement.removeAttribute('data-accent');
    localStorage.removeItem('encriptor-accent');
    localStorage.removeItem('encriptor-compact');

    const savedSidebar = localStorage.getItem('encriptor-sidebar') || 'left';
    if (savedSidebar === 'right') {
      document.documentElement.setAttribute('data-sidebar', 'right');
      document.getElementById('settings-sidebar-pos').value = 'right';
    }

    // Header font (FontPicker) - clear stale "default" values from old UI
    let savedHeaderFont = localStorage.getItem('encriptor-header-font') || '';
    if (savedHeaderFont === 'default') { savedHeaderFont = ''; localStorage.removeItem('encriptor-header-font'); }
    if (savedHeaderFont) {
      document.getElementById('settings-header-font').value = savedHeaderFont;
      document.documentElement.style.setProperty('--font-title', "'" + savedHeaderFont + "', serif");
    }
    new FontPicker('settings-header-font', (font) => {
      if (font) {
        document.documentElement.style.setProperty('--font-title', "'" + font + "', serif");
        localStorage.setItem('encriptor-header-font', font);
      } else {
        document.documentElement.style.setProperty('--font-title', "'EB Garamond', Garamond, 'Times New Roman', serif");
        localStorage.removeItem('encriptor-header-font');
      }
    }, 'EB Garamond');

    // Body font (FontPicker) - clear stale "default" values from old UI
    let savedBodyFont = localStorage.getItem('encriptor-body-font') || '';
    if (savedBodyFont === 'default') { savedBodyFont = ''; localStorage.removeItem('encriptor-body-font'); }
    if (savedBodyFont) {
      document.getElementById('settings-body-font').value = savedBodyFont;
      document.documentElement.style.setProperty('--font-body', "'" + savedBodyFont + "', sans-serif");
    }
    new FontPicker('settings-body-font', (font) => {
      if (font) {
        document.documentElement.style.setProperty('--font-body', "'" + font + "', sans-serif");
        localStorage.setItem('encriptor-body-font', font);
      } else {
        document.documentElement.style.setProperty('--font-body', "'DM Sans', 'Helvetica Neue', Arial, sans-serif");
        localStorage.removeItem('encriptor-body-font');
      }
    }, 'DM Sans');

    this.load();
    this.loadAuditLog();
  },

  async loadAuditLog() {
    try {
      const entries = await API.get('api/settings/audit');
      const container = document.getElementById('audit-log-list');
      if (!entries || entries.length === 0) {
        container.innerHTML = '<p style="font-size:0.85rem;color:var(--color-text-muted);">No activity yet.</p>';
        return;
      }
      const actionLabels = {
        register: 'Account created', login: 'Login', text_save: 'Saved text', text_delete: 'Deleted text',
        image_save: 'Saved image', image_delete: 'Deleted image', stegano_save: 'Saved stego', stegano_delete: 'Deleted stego',
        delete_all_data: 'Deleted all data', delete_account: 'Deleted account', pin_set: 'PIN enabled', pin_remove: 'PIN disabled',
        totp_enable: '2FA enabled', totp_disable: '2FA disabled',
      };
      container.innerHTML = entries.map(e => {
        const date = Settings.formatDate(e.created_at);
        const label = actionLabels[e.action] || e.action;
        const detail = e.detail ? ' - ' + e.detail : '';
        return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:var(--border-muted);font-size:0.8rem;">' +
          '<span>' + label + detail + '</span>' +
          '<span style="color:var(--color-text-muted);white-space:nowrap;margin-left:16px;">' + date + '</span>' +
          '</div>';
      }).join('');
    } catch (e) {
      // Silent fail
    }
  },

  toggleTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) {
      document.documentElement.removeAttribute('data-theme');
      this.themeToggle.classList.remove('toggle--active');
      localStorage.setItem('encriptor-theme', 'dark');
      Toast.show('Dark mode');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      this.themeToggle.classList.add('toggle--active');
      localStorage.setItem('encriptor-theme', 'light');
      Toast.show('Light mode');
    }
  },

  async load() {
    try {
      const profile = await API.get('api/settings/get');
      this.displayNameInput.value = profile.display_name || '';
      this.userHash.textContent = profile.user_hash || '';
      document.getElementById('settings-unique-id').value = profile.unique_id || '';
      this.createdAt.textContent = profile.created_at
        ? new Date(profile.created_at).toLocaleDateString()
        : '';

      if (profile.settings?.auto_clear) {
        this.autoClearToggle.classList.add('toggle--active');
      } else {
        this.autoClearToggle.classList.remove('toggle--active');
      }
      if (profile.settings?.confirm_delete) {
        this.confirmDeleteToggle.classList.add('toggle--active');
      } else {
        this.confirmDeleteToggle.classList.remove('toggle--active');
      }
      if (profile.settings?.auto_save) {
        this.autoSaveToggle.classList.add('toggle--active');
      } else {
        this.autoSaveToggle.classList.remove('toggle--active');
      }

      // Apply auto-save visibility
      Settings.applyAutoSave(!!profile.settings?.auto_save);

      // PIN state
      this._hasPIN = !!profile.has_pin;
      document.getElementById('pin-status-off').style.display = this._hasPIN ? 'none' : 'block';
      document.getElementById('pin-status-on').style.display = this._hasPIN ? 'block' : 'none';
      this.hidePinSetup();

      // TOTP state
      const hasTotp = !!profile.has_totp;
      document.getElementById('totp-status-off').style.display = hasTotp ? 'none' : 'block';
      document.getElementById('totp-status-on').style.display = hasTotp ? 'block' : 'none';

      // Regen seed - requires TOTP
      this._hasTotp = hasTotp;
      const regenStatus = document.getElementById('regen-seed-status');
      if (hasTotp) {
        regenStatus.textContent = '2FA enabled - regeneration available';
        regenStatus.style.color = 'var(--color-text-muted)';
      } else {
        regenStatus.textContent = 'Requires 2FA to be enabled';
        regenStatus.style.color = 'var(--color-text-muted)';
      }

      // Update nav display name
      const navName = document.getElementById('nav-display-name');
      if (navName) navName.textContent = profile.display_name || 'Anonymous';
    } catch (e) {
      // Silent fail on settings load
    }
  },

  async saveName() {
    const name = this.displayNameInput.value.trim();
    if (!name) return;
    try {
      await API.post('api/settings/update', { display_name: name });
      Toast.show('Display name updated');
      const navName = document.getElementById('nav-display-name');
      if (navName) navName.textContent = name;
    } catch (e) {
      Toast.show('Failed to save: ' + e.message, true);
    }
  },

  isAutoSave() {
    return this.autoSaveToggle && this.autoSaveToggle.classList.contains('toggle--active');
  },

  applyAutoSave(on) {
    // Hide/show all save buttons based on auto-save setting
    const saveBtn = document.getElementById('text-save-btn');
    if (saveBtn) saveBtn.style.display = on ? 'none' : (saveBtn.dataset.visible === '1' ? 'inline-flex' : 'none');
  },

  async toggleSetting(key, el) {
    const isActive = el.classList.contains('toggle--active');
    const settings = {};
    settings[key] = !isActive;
    try {
      await API.post('api/settings/update', { settings });
      el.classList.toggle('toggle--active');
      if (key === 'auto_save') Settings.applyAutoSave(!isActive);
    } catch (e) {
      Toast.show('Failed to update setting', true);
    }
  },

  async deleteAllData() {
    if (!await confirmAction('Delete ALL encrypted data? This cannot be undone.', 'Delete All Data')) return;
    try {
      await API.post('api/settings/delete-all-data', {});
      Toast.show('All data deleted');
      this.load();
      TextTab.loadList();
      ImageTab.loadList();
      SteganoTab.loadList();
    } catch (e) {
      Toast.show('Failed: ' + e.message, true);
    }
  },

  async deleteAccount() {
    if (!await confirmAction('This will permanently delete your account, all data, and seed phrase access. This is irreversible.', 'Delete Account')) return;
    try {
      await API.post('api/settings/delete-account', {});
      Crypto.clear();
      window.location.reload();
    } catch (e) {
      Toast.show('Failed: ' + e.message, true);
    }
  },

  _pinAction: null,

  showPinSetup(action) {
    this._pinAction = action;
    const form = document.getElementById('pin-setup-form');
    const title = document.getElementById('pin-form-title');
    const confirmGroup = document.getElementById('pin-confirm-group');
    const input = document.getElementById('settings-pin-input');
    const confirm = document.getElementById('settings-pin-confirm');

    input.value = '';
    confirm.value = '';
    form.style.display = 'block';

    if (action === 'enable') {
      title.textContent = 'Set your PIN';
      input.placeholder = 'Enter PIN (4-6 characters)...';
      confirmGroup.style.display = 'block';
    } else {
      title.textContent = 'Enter your current PIN to disable';
      input.placeholder = 'Enter current PIN...';
      confirmGroup.style.display = 'none';
    }
    input.focus();
  },

  hidePinSetup() {
    document.getElementById('pin-setup-form').style.display = 'none';
    document.getElementById('settings-pin-input').value = '';
    document.getElementById('settings-pin-confirm').value = '';
    this._pinAction = null;
  },

  async submitPin() {
    const input = document.getElementById('settings-pin-input').value.trim();
    const confirm = document.getElementById('settings-pin-confirm').value.trim();

    if (this._pinAction === 'enable') {
      if (!input || input.length < 4 || input.length > 6) {
        Toast.show('PIN must be 4-6 characters', true);
        return;
      }
      if (input !== confirm) {
        Toast.show('PINs do not match', true);
        return;
      }
      try {
        await API.post('api/settings/set-pin', { pin: input });
        this._hasPIN = true;
        document.getElementById('pin-status-off').style.display = 'none';
        document.getElementById('pin-status-on').style.display = 'block';
        this.hidePinSetup();
        Toast.show('PIN enabled. You will need it to log in.');
      } catch (e) {
        Toast.show('Failed: ' + e.message, true);
      }
    } else if (this._pinAction === 'disable') {
      if (!input) {
        Toast.show('Enter your current PIN', true);
        return;
      }
      try {
        await API.post('api/settings/remove-pin', { pin: input });
        this._hasPIN = false;
        document.getElementById('pin-status-off').style.display = 'block';
        document.getElementById('pin-status-on').style.display = 'none';
        this.hidePinSetup();
        Toast.show('PIN disabled');
      } catch (e) {
        Toast.show('Wrong PIN', true);
      }
    }
  },

  _tzData: [
    { offset: 'GMT-12:00', label: 'Baker Island, Howland Island', tz: 'Etc/GMT+12' },
    { offset: 'GMT-11:00', label: 'American Samoa, Midway Island', tz: 'Pacific/Pago_Pago' },
    { offset: 'GMT-10:00', label: 'Hawaii, Cook Islands', tz: 'Pacific/Honolulu' },
    { offset: 'GMT-9:30', label: 'Marquesas Islands', tz: 'Pacific/Marquesas' },
    { offset: 'GMT-9:00', label: 'Alaska', tz: 'America/Anchorage' },
    { offset: 'GMT-8:00', label: 'Pacific Time - Los Angeles, Vancouver, Tijuana', tz: 'America/Los_Angeles' },
    { offset: 'GMT-7:00', label: 'Mountain Time - Denver, Phoenix, Calgary', tz: 'America/Denver' },
    { offset: 'GMT-6:00', label: 'Central Time - Chicago, Mexico City, Guatemala', tz: 'America/Chicago' },
    { offset: 'GMT-5:00', label: 'Eastern Time - New York, Toronto, Bogota', tz: 'America/New_York' },
    { offset: 'GMT-4:00', label: 'Atlantic Time - Halifax, San Juan, Barbados', tz: 'America/Halifax' },
    { offset: 'GMT-3:30', label: 'Newfoundland', tz: 'America/St_Johns' },
    { offset: 'GMT-3:00', label: 'Buenos Aires, Sao Paulo, Montevideo', tz: 'America/Sao_Paulo' },
    { offset: 'GMT-2:00', label: 'South Georgia, Fernando de Noronha', tz: 'Atlantic/South_Georgia' },
    { offset: 'GMT-1:00', label: 'Azores, Cape Verde', tz: 'Atlantic/Azores' },
    { offset: 'GMT+0:00', label: 'London, Dublin, Lisbon, Reykjavik (GMT/UTC)', tz: 'Europe/London' },
    { offset: 'GMT+1:00', label: 'BST - United Kingdom, Paris, Berlin, Madrid, Rome', tz: 'Europe/London' },
    { offset: 'GMT+1:00', label: 'West Central Africa - Lagos, Algiers', tz: 'Africa/Lagos' },
    { offset: 'GMT+2:00', label: 'Eastern Europe - Helsinki, Bucharest, Athens, Cairo', tz: 'Europe/Helsinki' },
    { offset: 'GMT+2:00', label: 'South Africa - Johannesburg, Harare', tz: 'Africa/Johannesburg' },
    { offset: 'GMT+3:00', label: 'Moscow, Istanbul, Riyadh, Nairobi', tz: 'Europe/Moscow' },
    { offset: 'GMT+3:30', label: 'Tehran', tz: 'Asia/Tehran' },
    { offset: 'GMT+4:00', label: 'Dubai, Baku, Tbilisi, Muscat', tz: 'Asia/Dubai' },
    { offset: 'GMT+4:30', label: 'Kabul', tz: 'Asia/Kabul' },
    { offset: 'GMT+5:00', label: 'Karachi, Tashkent, Yekaterinburg', tz: 'Asia/Karachi' },
    { offset: 'GMT+5:30', label: 'India - Mumbai, Delhi, Colombo', tz: 'Asia/Kolkata' },
    { offset: 'GMT+5:45', label: 'Kathmandu', tz: 'Asia/Kathmandu' },
    { offset: 'GMT+6:00', label: 'Dhaka, Almaty, Omsk', tz: 'Asia/Dhaka' },
    { offset: 'GMT+6:30', label: 'Yangon, Cocos Islands', tz: 'Asia/Yangon' },
    { offset: 'GMT+7:00', label: 'Bangkok, Hanoi, Jakarta', tz: 'Asia/Bangkok' },
    { offset: 'GMT+8:00', label: 'Beijing, Singapore, Hong Kong, Perth', tz: 'Asia/Shanghai' },
    { offset: 'GMT+9:00', label: 'Tokyo, Seoul, Yakutsk', tz: 'Asia/Tokyo' },
    { offset: 'GMT+9:30', label: 'Adelaide, Darwin', tz: 'Australia/Adelaide' },
    { offset: 'GMT+10:00', label: 'Sydney, Melbourne, Brisbane, Vladivostok', tz: 'Australia/Sydney' },
    { offset: 'GMT+11:00', label: 'Solomon Islands, New Caledonia', tz: 'Pacific/Guadalcanal' },
    { offset: 'GMT+12:00', label: 'Auckland, Wellington, Fiji', tz: 'Pacific/Auckland' },
    { offset: 'GMT+13:00', label: 'Samoa, Tonga', tz: 'Pacific/Apia' },
  ],

  _initTimezone() {
    const input = document.getElementById('settings-timezone');
    if (!input) return;

    const saved = localStorage.getItem('encriptor-timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Find matching entry
    const match = this._tzData.find(t => t.tz === saved);
    if (match) {
      input.value = '(' + match.offset + ') ' + match.label;
    } else {
      input.value = saved;
    }

    // Build dropdown
    const drop = document.createElement('div');
    drop.className = 'fp-list';
    document.body.appendChild(drop);

    // Search input inside dropdown
    const searchWrap = document.createElement('div');
    searchWrap.style.cssText = 'padding:8px;border-bottom:var(--border-muted);position:sticky;top:0;background:var(--color-bg);z-index:1;';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'input';
    searchInput.placeholder = 'Search timezone...';
    searchInput.style.cssText = 'width:100%;font-size:0.85rem;padding:6px 10px;';
    searchInput.autocomplete = 'off';
    searchWrap.appendChild(searchInput);

    const listWrap = document.createElement('div');
    listWrap.style.cssText = 'scrollbar-width:thin;scrollbar-color:var(--color-text-muted) var(--color-surface);';

    drop.appendChild(searchWrap);
    drop.appendChild(listWrap);

    // Scrollbar styling
    const style = document.createElement('style');
    style.textContent = `
      .tz-list-wrap::-webkit-scrollbar { width:6px; }
      .tz-list-wrap::-webkit-scrollbar-track { background:var(--color-surface); }
      .tz-list-wrap::-webkit-scrollbar-thumb { background:var(--color-text-muted); }
      .tz-list-wrap::-webkit-scrollbar-thumb:hover { background:var(--color-text); }
    `;
    document.head.appendChild(style);
    listWrap.classList.add('tz-list-wrap');

    let isOpen = false;

    const render = (query) => {
      const q = (query || '').toLowerCase();
      const filtered = q ? this._tzData.filter(t => t.label.toLowerCase().includes(q) || t.offset.toLowerCase().includes(q)) : this._tzData;
      if (!filtered.length) {
        listWrap.innerHTML = '<div class="fp-none">No timezones found</div>';
        return;
      }
      listWrap.innerHTML = filtered.map(t =>
        '<div class="fp-row" data-tz="' + t.tz + '" data-offset="' + t.offset + '" data-label="' + t.label + '" style="font-size:0.85rem;">' +
        '<span style="color:var(--color-text-muted);margin-right:8px;flex-shrink:0;font-size:0.75rem;">' + t.offset + '</span>' +
        '<span style="flex:1;">' + t.label + '</span>' +
        '</div>'
      ).join('');
    };

    const show = () => {
      if (isOpen) return;
      isOpen = true;
      searchInput.value = '';
      render('');
      const r = input.getBoundingClientRect();
      drop.style.left = r.left + 'px';
      drop.style.top = r.bottom + 'px';
      drop.style.width = r.width + 'px';
      drop.style.maxHeight = '300px';
      drop.style.overflowY = 'auto';
      drop.classList.add('open');
      setTimeout(() => searchInput.focus(), 50);
    };

    const hide = () => {
      isOpen = false;
      drop.classList.remove('open');
    };

    input.removeAttribute('readonly');
    input.readOnly = true;
    input.addEventListener('click', () => isOpen ? hide() : show());

    searchInput.addEventListener('input', () => render(searchInput.value));
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });

    listWrap.addEventListener('click', (e) => {
      const row = e.target.closest('.fp-row');
      if (!row) return;
      const tz = row.dataset.tz;
      const offset = row.dataset.offset;
      const label = row.dataset.label;
      input.value = '(' + offset + ') ' + label;
      localStorage.setItem('encriptor-timezone', tz);
      this._updateClock();
      hide();
    });

    // Wheel scroll support
    input.addEventListener('wheel', (e) => {
      if (isOpen) { e.preventDefault(); drop.scrollTop += e.deltaY; }
    }, { passive: false });
    drop.addEventListener('wheel', (e) => {
      e.stopPropagation();
    });

    document.addEventListener('mousedown', (e) => {
      if (isOpen && e.target !== input && !drop.contains(e.target)) hide();
    });

    drop.addEventListener('mousedown', (e) => { e.stopPropagation(); });

    // Live clock
    this._updateClock();
    setInterval(() => this._updateClock(), 1000);
  },

  _updateClock() {
    const el = document.getElementById('settings-current-time');
    if (!el) return;
    const tz = localStorage.getItem('encriptor-timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      el.textContent = new Date().toLocaleString(undefined, { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {
      el.textContent = new Date().toLocaleString();
    }
  },

  getTimezone() {
    return localStorage.getItem('encriptor-timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone;
  },

  formatDate(iso) {
    if (!iso) return '--';
    const tz = this.getTimezone();
    try {
      return new Date(iso).toLocaleString(undefined, { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return new Date(iso).toLocaleString();
    }
  },

  async _initSession() {
    try {
      const data = await API.get('api/settings/session');
      if (data.login_time) {
        document.getElementById('session-login-time').textContent = this.formatDate(data.login_time);
        // Duration
        const diff = Date.now() - new Date(data.login_time).getTime();
        const mins = Math.floor(diff / 60000);
        const hrs = Math.floor(mins / 60);
        document.getElementById('session-duration').textContent =
          hrs > 0 ? hrs + 'h ' + (mins % 60) + 'm' : mins + 'm';
      }
      document.getElementById('session-ip').textContent = data.ip || '--';
      // Parse user agent to friendly name
      const ua = data.user_agent || '';
      let browser = 'Unknown';
      if (ua.includes('Edg/')) browser = 'Microsoft Edge';
      else if (ua.includes('Chrome/')) browser = 'Google Chrome';
      else if (ua.includes('Firefox/')) browser = 'Firefox';
      else if (ua.includes('Safari/')) browser = 'Safari';
      else if (ua.includes('Opera/') || ua.includes('OPR/')) browser = 'Opera';
      document.getElementById('session-browser').textContent = browser;
    } catch (e) {
      // Silent fail
    }
  },

  _regenPhrase: null,
  _regenSalt: null,

  showRegenSeed() {
    if (!this._hasTotp) {
      Toast.show('You must enable Two-Factor Authentication (2FA) before you can regenerate your seed phrase. Go to Security and enable it first.', true);
      return;
    }
    document.getElementById('regen-step1').style.display = 'block';
    document.getElementById('regen-step2').style.display = 'none';
    document.getElementById('regen-verify-btn').style.display = 'inline-flex';
    document.getElementById('regen-copy-btn').style.display = 'none';
    document.getElementById('regen-done-btn').style.display = 'none';
    document.getElementById('regen-totp-input').value = '';
    document.getElementById('regen-seed-modal').classList.remove('modal-overlay--hidden');
    setTimeout(() => document.getElementById('regen-totp-input').focus(), 100);
  },

  hideRegenSeed() {
    document.getElementById('regen-seed-modal').classList.add('modal-overlay--hidden');
  },

  async verifyRegenSeed() {
    const token = document.getElementById('regen-totp-input').value.trim();
    if (!token || token.length !== 6) { Toast.show('Enter the 6-digit code', true); return; }

    try {
      const data = await API.post('api/settings/regen-seed', { totp_token: token });
      this._regenPhrase = data.seed_phrase;
      this._regenSalt = data.salt;

      // Show new seed phrase
      const words = data.seed_phrase.split(' ');
      document.getElementById('regen-seed-display').innerHTML = words
        .map((w, i) => '<div class="seed-word"><span class="seed-word__num">' + (i + 1) + '.</span>' + w + '</div>')
        .join('');

      document.getElementById('regen-step1').style.display = 'none';
      document.getElementById('regen-step2').style.display = 'block';
      document.getElementById('regen-verify-btn').style.display = 'none';
      document.getElementById('regen-copy-btn').style.display = 'inline-flex';
      document.getElementById('regen-done-btn').style.display = 'inline-flex';
    } catch (e) {
      Toast.show(e.message || 'Verification failed', true);
    }
  },

  _copyRegenSeed() {
    if (this._regenPhrase) {
      navigator.clipboard.writeText(this._regenPhrase);
      Toast.show('Seed phrase copied');
    }
  },

  async completeRegenSeed() {
    if (!this._regenPhrase || !this._regenSalt) return;
    try {
      await Crypto.init(this._regenPhrase, this._regenSalt);
      this.hideRegenSeed();
      this._regenPhrase = null;
      this._regenSalt = null;
      Toast.show('Seed phrase regenerated. Use your new phrase to log in.');
      this.load();
    } catch (e) {
      Toast.show('Failed to initialize new keys: ' + e.message, true);
    }
  },

  async saveUniqueId() {
    const uid = document.getElementById('settings-unique-id').value.trim();
    if (!uid || uid.length < 3) { Toast.show('Username must be at least 3 characters', true); return; }
    try {
      await API.post('api/settings/change-uid', { unique_id: uid });
      Toast.show('Username updated to @' + uid);
    } catch (e) {
      Toast.show(e.message || 'Failed to update username', true);
    }
  },

  isAutoClear() {
    return this.autoClearToggle && this.autoClearToggle.classList.contains('toggle--active');
  },

  isConfirmDelete() {
    return this.confirmDeleteToggle && this.confirmDeleteToggle.classList.contains('toggle--active');
  },

  async exportVault() {
    try {
      const data = await API.get('api/settings/export');
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'encriptor-vault-export.json';
      a.click();
      Toast.show('Vault exported');
    } catch (e) {
      Toast.show('Export failed: ' + e.message, true);
    }
  },

  async importVault(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await API.post('api/settings/import', data);
      Toast.show('Vault imported');
      this.load();
      TextTab.loadList();
      ImageTab.loadList();
      SteganoTab.loadList();
    } catch (e) {
      Toast.show('Import failed: ' + e.message, true);
    }
  },

  async showTotpSetup() {
    try {
      const data = await API.post('api/settings/totp-setup', {});
      document.getElementById('totp-secret-display').value = data.secret;
      const qrContainer = document.getElementById('totp-qr-container');
      qrContainer.innerHTML = '';
      new QRCode(qrContainer, { text: data.uri, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
      document.getElementById('totp-confirm-input').value = '';
      document.getElementById('totp-setup-modal').classList.remove('modal-overlay--hidden');
      setTimeout(() => document.getElementById('totp-confirm-input').focus(), 100);
    } catch (e) {
      Toast.show('Setup failed: ' + e.message, true);
    }
  },

  hideTotpSetup() {
    document.getElementById('totp-setup-modal').classList.add('modal-overlay--hidden');
  },

  async confirmTotp() {
    const token = document.getElementById('totp-confirm-input').value.trim();
    if (!token || token.length !== 6) { Toast.show('Enter the 6-digit code', true); return; }
    try {
      await API.post('api/settings/totp-confirm', { token });
      document.getElementById('totp-status-off').style.display = 'none';
      document.getElementById('totp-status-on').style.display = 'block';
      this.hideTotpSetup();
      Toast.show('Two-factor authentication enabled');
    } catch (e) {
      Toast.show('Invalid code. Try again.', true);
    }
  },

  showTotpDisable() {
    document.getElementById('totp-disable-input').value = '';
    document.getElementById('totp-disable-modal').classList.remove('modal-overlay--hidden');
    setTimeout(() => document.getElementById('totp-disable-input').focus(), 100);
  },

  hideTotpDisable() {
    document.getElementById('totp-disable-modal').classList.add('modal-overlay--hidden');
  },

  async disableTotp() {
    const token = document.getElementById('totp-disable-input').value.trim();
    if (!token || token.length !== 6) { Toast.show('Enter the 6-digit code', true); return; }
    try {
      await API.post('api/settings/totp-disable', { token });
      document.getElementById('totp-status-off').style.display = 'block';
      document.getElementById('totp-status-on').style.display = 'none';
      this.hideTotpDisable();
      Toast.show('Two-factor authentication disabled');
    } catch (e) {
      Toast.show('Invalid code', true);
    }
  },
};
