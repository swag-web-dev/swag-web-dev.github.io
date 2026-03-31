const TextTab = {
  _init: false,
  init() {
    if (this._init) return;
    this._init = true;

    this.input = document.getElementById('text-input');
    this.label = document.getElementById('text-label');
    this.encryptBtn = document.getElementById('text-encrypt-btn');
    this.list = document.getElementById('text-list');
    this.emptyState = document.getElementById('text-empty');
    this.modal = document.getElementById('text-modal');

    this.encryptBtn.addEventListener('click', () => this.encryptText());
    this.saveBtn = document.getElementById('text-save-btn');
    this.saveBtn.addEventListener('click', () => this.saveEncrypted());
    this.outputDisplay = document.getElementById('text-output-display');
    this.encryptHint = document.getElementById('text-encrypt-hint');

    // Character/byte counter
    this.charCounter = document.getElementById('text-char-counter');
    this.input.addEventListener('input', () => this._updateCounter());
    // Update counter when encryption type changes
    document.getElementById('text-strength').addEventListener('change', () => this._updateCounter());

    // Custom key toggle
    document.getElementById('text-custom-key-check').addEventListener('change', function() {
      document.getElementById('text-custom-key-wrap').style.display = this.checked ? 'flex' : 'none';
      document.getElementById('text-vault-key-wrap').style.display = this.checked ? 'none' : 'flex';
      const hint = document.getElementById('text-custom-key-hint');
      if (hint) hint.style.display = this.checked ? 'block' : 'none';
      if (!this.checked) document.getElementById('text-custom-key-input').value = '';
    });

    document.getElementById('text-modal-close').addEventListener('click', () => {
      this.modal.classList.add('modal-overlay--hidden');
    });

    document.getElementById('text-manual-decrypt-btn').addEventListener('click', () => this.manualDecrypt());

    // Toggle vault/custom fields in decrypt
    document.getElementById('text-dec-custom-check').addEventListener('change', function() {
      document.getElementById('text-dec-vault-wrap').style.display = this.checked ? 'none' : 'flex';
      document.getElementById('text-dec-custom-wrap').style.display = this.checked ? 'flex' : 'none';
    });

    // Hide key field for RSA/ECDH (key is embedded in ciphertext)
    document.getElementById('text-manual-strength').addEventListener('change', () => {
      const encType = document.getElementById('text-manual-strength').value;
      const isAsymmetric = encType.startsWith('rsa') || encType === 'ecdh';
      document.getElementById('text-dec-key-section').style.display = isAsymmetric ? 'none' : 'block';
    });

    this.loadList();
  },

  _hasUnsaved: false,
  _lastEncrypted: null,
  currentPage: 0,
  _allItems: [],
  _pageSize: 10,

  async encryptText() {
    const text = this.input.value.trim();
    if (!text) { Toast.show('Enter text to encrypt', true); return; }

    // Check byte limit
    const encType = document.getElementById('text-strength').value;
    const limit = this._encLimits[encType] || 0;
    const bytes = new TextEncoder().encode(text).length;
    if (limit > 0 && bytes > limit) {
      Toast.show('Text exceeds ' + this._formatBytes(limit) + ' limit for ' + encType.toUpperCase(), true);
      return;
    }

    const useCustom = document.getElementById('text-custom-key-check').checked;
    const customKey = document.getElementById('text-custom-key-input').value.trim();
    if (useCustom && !customKey) { Toast.show('Enter a custom key', true); return; }

    this.encryptBtn.disabled = true;
    this.encryptBtn.textContent = 'ENCRYPTING...';

    try {
      const encType = document.getElementById('text-strength').value;
      const isHash = encType.startsWith('sha-');

      if (useCustom) {
        const { ciphertext } = Crypto.customEncrypt(text, customKey);
        this._lastEncrypted = { iv: '', ciphertext, enc_type: encType, custom_key: true };
      } else {
        const result = await Crypto.encrypt(text, encType);
        this._lastEncrypted = { iv: result.iv || '', ciphertext: result.ciphertext, enc_type: encType, custom_key: false };
      }

      this.outputDisplay.value = this._lastEncrypted.ciphertext;

      // Show the generated key in the vault key display
      const vaultDisplay = document.getElementById('text-vault-key-display');
      if (!useCustom && this._lastEncrypted.iv) {
        vaultDisplay.value = this._lastEncrypted.iv;
      } else if (!useCustom) {
        vaultDisplay.value = 'No key (asymmetric/hash)';
      }

      // Auto-save or show save button
      if (Settings.isAutoSave()) {
        await this.saveEncrypted();
        Toast.show(isHash ? 'Hashed and saved' : 'Encrypted and saved');
      } else {
        this.saveBtn.style.display = 'inline-flex';
        this.saveBtn.dataset.visible = '1';
        this._hasUnsaved = true;
        this.encryptHint.textContent = isHash ? 'Hashed. Click save to store.' : 'Encrypted. Click save to store in vault.';
        Toast.show(isHash ? 'Hashed' : 'Encrypted');
      }

      // Auto-clear inputs if setting is enabled
      if (Settings.isAutoClear()) {
        this.input.value = '';
        this.label.value = '';
        this._updateCounter();
      }
    } catch (e) {
      Toast.show('Encryption failed: ' + e.message, true);
    } finally {
      this.encryptBtn.disabled = false;
      this.encryptBtn.textContent = 'ENCRYPT';
    }
  },

  async saveEncrypted() {
    if (!this._lastEncrypted) return;
    const label = this.label.value.trim() || 'Untitled';
    try {
      await API.post('api/text/save', { label, ...this._lastEncrypted, strength: 256 });
      this.input.value = '';
      this.label.value = '';
      this.outputDisplay.value = '';
      document.getElementById('text-vault-key-display').value = '';
      document.getElementById('text-vault-key-display').placeholder = 'Key will appear after encryption';
      this.saveBtn.style.display = 'none';
      this.saveBtn.dataset.visible = '0';
      this._hasUnsaved = false;
      this.encryptHint.textContent = 'Enter input text and select encryption type to enable encryption.';
      this._lastEncrypted = null;
      this._updateCounter();
      if (!Settings.isAutoSave()) Toast.show('Saved to vault');
      this.loadList();
      App.refreshStats();
    } catch (e) {
      Toast.show('Save failed: ' + e.message, true);
    }
  },

  async manualDecrypt() {
    const cipher = document.getElementById('text-manual-cipher').value.trim();
    const useCustom = document.getElementById('text-dec-custom-check').checked;

    if (!cipher) { Toast.show('Enter the ciphertext', true); return; }

    try {
      let plaintext;
      if (useCustom) {
        const pass = document.getElementById('text-dec-custom-input').value.trim();
        if (!pass) { Toast.show('Enter the custom key', true); return; }
        try {
          plaintext = Crypto.customDecrypt(cipher, pass);
        } catch (e) { plaintext = ''; }
        if (!plaintext) { Toast.show('Wrong custom key or invalid ciphertext', true); return; }
      } else {
        const key = document.getElementById('text-manual-key').value.trim();
        const encType = document.getElementById('text-manual-strength').value;
        const isAsymmetric = encType.startsWith('rsa') || encType === 'ecdh';
        if (!key && !isAsymmetric) { Toast.show('Enter the key (IV)', true); return; }
        try {
          plaintext = await Crypto.decrypt(key || '', cipher, encType);
        } catch (e) {
          // Vault decrypt failed - try treating the key as a custom passphrase
          try {
            plaintext = Crypto.customDecrypt(cipher, key);
          } catch (e2) { plaintext = ''; }
          if (!plaintext) throw e;
          Toast.show('Decrypted with passphrase (not vault key)');
        }
      }
      document.getElementById('text-manual-result').value = plaintext;
      document.getElementById('text-dec-copy-btn').style.display = 'inline-flex';
      if (plaintext) Toast.show('Decrypted');
    } catch (e) {
      console.error('Decrypt error:', e);
      Toast.show('Decryption failed - wrong key, type, or corrupted data', true);
    }
  },

  async loadList() {
    try {
      const items = await API.get('api/text/list');
      this._allItems = items;
      this.currentPage = 0;
      this._renderPage();
    } catch (e) {
      Toast.show('Failed to load texts', true);
    }
  },

  _renderPage() {
    const items = this._allItems;
    if (items.length === 0) {
      this.list.innerHTML = '';
      this.emptyState.style.display = 'block';
      return;
    }
    this.emptyState.style.display = 'none';
    const start = this.currentPage * this._pageSize;
    const pageItems = items.slice(start, start + this._pageSize);
    let html = pageItems
      .map(
        (item) => `
      <div class="item" data-id="${item.id}">
        <div class="item__info">
          <div class="item__title">${this._esc(item.label)}</div>
          <div class="item__meta">${item.custom_key ? 'Custom Key' : (item.enc_type || 'aes-256-gcm').toUpperCase()} &middot; ${this._formatDate(item.created_at)}</div>
        </div>
        <div class="item__actions">
          <button class="btn btn--small" onclick="TextTab.viewItem('${item.id}')">VIEW</button>
          <button class="btn btn--small" onclick="TextTab.decryptItem('${item.id}')">DECRYPT</button>
          <button class="btn btn--small" onclick="TextTab.renameItem('${item.id}')">RENAME</button>
          <button class="btn btn--small btn--danger" onclick="TextTab.deleteItem('${item.id}')">DELETE</button>
        </div>
      </div>
    `
      )
      .join('');

    if (items.length > this._pageSize) {
      const totalPages = Math.ceil(items.length / this._pageSize);
      html += '<div style="display:flex;justify-content:center;gap:12px;padding:16px 0;align-items:center;">';
      html += '<button class="btn btn--small" onclick="TextTab.prevPage()"' + (this.currentPage === 0 ? ' disabled' : '') + '>PREV</button>';
      html += '<span style="font-size:0.8rem;color:var(--color-text-muted);">Page ' + (this.currentPage + 1) + ' of ' + totalPages + '</span>';
      html += '<button class="btn btn--small" onclick="TextTab.nextPage()"' + (this.currentPage >= totalPages - 1 ? ' disabled' : '') + '>NEXT</button>';
      html += '</div>';
    }

    this.list.innerHTML = html;
  },

  prevPage() {
    if (this.currentPage > 0) { this.currentPage--; this._renderPage(); }
  },

  nextPage() {
    const totalPages = Math.ceil(this._allItems.length / this._pageSize);
    if (this.currentPage < totalPages - 1) { this.currentPage++; this._renderPage(); }
  },

  filterList(query) {
    const q = (query || '').toLowerCase();
    const items = this.list.querySelectorAll('.item');
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? '' : 'none';
    });
  },

  _showModal(title, strength, sections) {
    document.getElementById('text-modal-title').textContent = title;
    document.getElementById('text-modal-strength').textContent = strength;
    const body = document.getElementById('text-modal-body');
    body.innerHTML = '';

    sections.forEach(({ label, value, hidden, id }) => {
      const section = document.createElement('div');
      section.className = 'input-group';
      section.style.marginBottom = '16px';

      const header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';

      const lbl = document.createElement('label');
      lbl.textContent = label;
      header.appendChild(lbl);

      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:4px;';

      if (hidden) {
        const eyeBtn = document.createElement('button');
        eyeBtn.className = 'btn btn--small btn--icon key-eye';
        eyeBtn.dataset.target = id;
        eyeBtn.textContent = '\u25CB';
        btns.appendChild(eyeBtn);
      }

      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn btn--small';
      copyBtn.textContent = 'COPY';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(value);
        Toast.show('Copied');
      });
      btns.appendChild(copyBtn);

      header.appendChild(btns);
      section.appendChild(header);

      const pre = document.createElement('pre');
      pre.id = id;
      pre.style.cssText = 'white-space:pre-wrap;word-break:break-all;font-family:"Courier New",monospace;font-size:0.8rem;line-height:1.5;padding:12px;border:var(--border-muted);background:var(--color-input-bg);max-height:200px;overflow-y:auto;';
      pre.textContent = value;
      if (hidden) {
        pre.classList.add('key-hidden');
        pre.dataset.value = value;
      }
      section.appendChild(pre);

      body.appendChild(section);
    });

    this.modal.classList.remove('modal-overlay--hidden');
  },

  async viewItem(id) {
    try {
      const data = await API.get('api/text/get?id=' + id);
      const isCustom = !!data.custom_key;
      const et = data.enc_type || 'aes-256-gcm';
      const badge = isCustom ? 'Custom Key' : et.toUpperCase();
      const isAsymmetric = et.startsWith('rsa') || et === 'ecdh';
      const sections = [
        { label: 'Ciphertext', value: data.ciphertext, hidden: false, id: 'tm-cipher' },
      ];
      if (!isCustom) {
        if (data.iv) {
          sections.push({ label: 'Key (IV)', value: data.iv, hidden: true, id: 'tm-key' });
        } else if (isAsymmetric) {
          sections.push({ label: 'Key', value: data.ciphertext, hidden: true, id: 'tm-key' });
        }
      }
      this._showModal(data.label, badge, sections);
    } catch (e) {
      Toast.show('Failed to load: ' + e.message, true);
    }
  },

  async decryptItem(id) {
    try {
      const data = await API.get('api/text/get?id=' + id);
      const isCustom = !!data.custom_key;
      const et = data.enc_type || 'aes-256-gcm';
      const badge = isCustom ? 'Custom Key' : et.toUpperCase();
      const isAsymmetric = et.startsWith('rsa') || et === 'ecdh';

      if (et.startsWith('sha-')) {
        Toast.show('SHA hashes cannot be decrypted (one-way)', true);
        return;
      }

      let plaintext;
      if (isCustom) {
        const pass = await promptInput('This entry was encrypted with a custom key.', 'Enter Custom Key', 'Enter the passphrase...');
        if (!pass) return;
        plaintext = Crypto.customDecrypt(data.ciphertext, pass);
        if (!plaintext) { Toast.show('Wrong key', true); return; }
      } else {
        plaintext = await Crypto.decrypt(data.iv, data.ciphertext, et);
      }

      const sections = [
        { label: 'Decrypted Message', value: plaintext, hidden: false, id: 'tm-plain' },
        { label: 'Ciphertext', value: data.ciphertext, hidden: false, id: 'tm-cipher' },
      ];
      if (!isCustom) {
        if (data.iv) {
          sections.push({ label: 'Key (IV)', value: data.iv, hidden: true, id: 'tm-key' });
        } else if (isAsymmetric) {
          sections.push({ label: 'Key', value: data.ciphertext, hidden: true, id: 'tm-key' });
        }
      }
      this._showModal(data.label, badge, sections);
    } catch (e) {
      Toast.show('Decryption failed: ' + e.message, true);
    }
  },

  async renameItem(id) {
    const newLabel = await promptInput('Enter a new name for this entry.', 'Rename', 'New label...');
    if (!newLabel) return;
    try {
      await API.post('api/text/rename', { id, label: newLabel });
      Toast.show('Renamed');
      this.loadList();
      App.refreshStats();
    } catch (e) {
      Toast.show('Rename failed: ' + e.message, true);
    }
  },

  async deleteAll() {
    if (!await confirmAction('Delete ALL text entries? This cannot be undone.', 'Delete All')) return;
    try {
      const items = await API.get('api/text/list');
      for (const item of items) {
        await API.del('api/text/delete', { id: item.id });
      }
      Toast.show('All texts deleted');
      this.loadList();
      App.refreshStats();
    } catch (e) {
      Toast.show('Delete all failed: ' + e.message, true);
    }
  },

  async deleteItem(id) {
    if (Settings.isConfirmDelete() && !await confirmAction('Delete this encrypted text?', 'Delete')) return;
    try {
      await API.del('api/text/delete', { id });
      Toast.show('Text deleted');
      this.loadList();
      App.refreshStats();
    } catch (e) {
      Toast.show('Delete failed: ' + e.message, true);
    }
  },

  // Max bytes per encryption type (0 = unlimited)
  _encLimits: {
    'aes-128-gcm': 0, 'aes-256-gcm': 0,
    'aes-128-cbc': 0, 'aes-192-cbc': 0, 'aes-256-cbc': 0,
    'chacha20': 0,
    'rsa-1024': 86, 'rsa-2048': 214, 'rsa-3072': 342, 'rsa-4096': 470, 'rsa': 214,
    'ecdh': 0,
    'sha-256': 0, 'sha-384': 0,
  },

  _updateCounter() {
    if (!this.charCounter) return;
    const text = this.input.value;
    const chars = text.length;
    const bytes = new TextEncoder().encode(text).length;
    const encType = document.getElementById('text-strength').value;
    const limit = this._encLimits[encType] || 0;

    let info;

    if (limit > 0) {
      info = chars + ' chars / ' + bytes + ' / ' + limit + ' bytes';
      if (bytes > limit) {
        this.charCounter.style.color = '#ff4a4a';
        this.encryptBtn.disabled = true;
      } else if (bytes > limit * 0.8) {
        this.charCounter.style.color = '#ff9f4a';
        this.encryptBtn.disabled = false;
      } else {
        this.charCounter.style.color = 'var(--color-text-muted)';
        this.encryptBtn.disabled = false;
      }
    } else {
      info = chars + ' chars / ' + this._formatBytes(bytes);
      this.charCounter.style.color = 'var(--color-text-muted)';
      this.encryptBtn.disabled = false;
    }

    this.charCounter.textContent = info;
  },

  _formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' bytes';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  },

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  _formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },
};
