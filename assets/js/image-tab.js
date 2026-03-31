const ImageTab = {
  _init: false,
  currentPage: 0,
  _allItems: [],
  _pageSize: 10,
  init() {
    if (this._init) return;
    this._init = true;

    this.dropZone = document.getElementById('image-drop-zone');
    this.fileInput = document.getElementById('image-file-input');
    this.label = document.getElementById('image-label');
    this.encryptBtn = document.getElementById('image-encrypt-btn');
    this.preview = document.getElementById('image-preview');
    this.previewImg = document.getElementById('image-preview-img');
    this.grid = document.getElementById('image-grid');
    this.emptyState = document.getElementById('image-empty');
    this.viewer = document.getElementById('image-viewer');
    this.viewerImg = document.getElementById('image-viewer-img');
    this.viewerClose = document.getElementById('image-viewer-close');
    this.selectedFile = null;

    this.dropZone.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', (e) => this.handleFile(e.target.files[0]));

    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('drop-zone--active');
    });
    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('drop-zone--active');
    });
    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drop-zone--active');
      if (e.dataTransfer.files.length) this.handleFile(e.dataTransfer.files[0]);
    });

    this.encryptBtn.addEventListener('click', () => this.encryptImage());
    this.viewerClose.addEventListener('click', () => {
      this.viewer.classList.add('modal-overlay--hidden');
      URL.revokeObjectURL(this.viewerImg.src);
      this.viewerImg.src = '';
    });

    this.loadList();

    // Decrypt tab - upload encrypted file
    this._decFileData = null;
    const decDrop = document.getElementById('dec-image-drop');
    const decFile = document.getElementById('dec-image-file');
    const decBtn = document.getElementById('dec-image-btn');

    decDrop.addEventListener('click', () => decFile.click());
    decFile.addEventListener('change', (e) => this._handleDecFile(e.target.files[0]));
    decDrop.addEventListener('dragover', (e) => { e.preventDefault(); decDrop.classList.add('drop-zone--active'); });
    decDrop.addEventListener('dragleave', () => decDrop.classList.remove('drop-zone--active'));
    decDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      decDrop.classList.remove('drop-zone--active');
      if (e.dataTransfer.files.length) this._handleDecFile(e.dataTransfer.files[0]);
    });
    decBtn.addEventListener('click', () => this._decryptUploadedFile());
  },

  _handleDecFile(file) {
    if (!file) return;
    this._decFile = file;

    // Hide drop zone, show file preview with remove button
    const drop = document.getElementById('dec-image-drop');
    const info = document.getElementById('dec-image-file-info');
    drop.style.display = 'none';
    info.style.display = 'block';
    info.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:var(--border-muted);">
        <div>
          <div style="font-size:0.85rem;">${file.name}</div>
          <div style="font-size:0.75rem;color:var(--color-text-muted);">${Math.round(file.size / 1024)} KB</div>
        </div>
        <button class="btn btn--small btn--danger" onclick="ImageTab._clearDecFile()">REMOVE</button>
      </div>
    `;
    document.getElementById('dec-image-btn').disabled = false;
  },

  _clearDecFile() {
    this._decFile = null;
    document.getElementById('dec-image-drop').style.display = 'flex';
    document.getElementById('dec-image-file-info').style.display = 'none';
    document.getElementById('dec-image-file').value = '';
    document.getElementById('dec-image-btn').disabled = true;
  },

  async _decryptUploadedFile() {
    if (!this._decFile) return;

    const useCustom = document.getElementById('dec-image-custom-check').checked;
    const customPass = document.getElementById('dec-image-custom-input').value.trim();
    const key = document.getElementById('dec-image-key').value.trim();

    if (useCustom && !customPass) { Toast.show('Enter the custom passphrase', true); return; }
    if (!useCustom && !key) { Toast.show('Enter the key (IV)', true); return; }

    const encType = document.getElementById('dec-image-strength').value;
    const mime = document.getElementById('dec-image-mime-val').value;
    const btn = document.getElementById('dec-image-btn');

    btn.disabled = true;
    btn.textContent = 'DECRYPTING...';

    try {
      const text = await this._decFile.text();
      const ciphertext = text.trim();

      let plainBuffer;
      if (useCustom) {
        plainBuffer = Crypto.customDecryptBytes(ciphertext, customPass);
        if (!plainBuffer || !plainBuffer.byteLength) { Toast.show('Wrong custom key', true); return; }
      } else {
        plainBuffer = await Crypto.decryptBytes(key, ciphertext, encType);
      }
      const blob = new Blob([plainBuffer], { type: mime });
      const ext = mime.split('/')[1] || 'png';
      const fileName = this._decFile.name.replace(/\.enc$/, '') + '_decrypted.' + ext;

      // Show decrypted image with download button
      const preview = document.getElementById('dec-image-preview');
      preview.src = URL.createObjectURL(blob);
      document.getElementById('dec-image-output').style.display = 'block';

      const dlBtn = document.getElementById('dec-image-download');
      dlBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        Toast.show('Downloaded');
      };

      Toast.show('Decrypted');
    } catch (e) {
      Toast.show('Decryption failed - wrong key, strength, or corrupted file', true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'DECRYPT';
    }
  },

  handleFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      Toast.show('Please select an image file', true);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      Toast.show('Image must be under 10MB', true);
      return;
    }
    this.selectedFile = file;
    this.dropZone.style.display = 'none';
    this.preview.style.display = 'block';
    this.previewImg.src = URL.createObjectURL(file);
    this.encryptBtn.disabled = false;
    document.getElementById('image-file-name').innerHTML =
      file.name + ' (' + Math.round(file.size / 1024) + ' KB) ' +
      '<button class="btn btn--small btn--danger" style="margin-left:8px;" onclick="ImageTab.clearFile()">REMOVE</button>';
  },

  clearFile() {
    this.selectedFile = null;
    this.dropZone.style.display = 'flex';
    this.preview.style.display = 'none';
    this.fileInput.value = '';
    this.encryptBtn.disabled = true;
    URL.revokeObjectURL(this.previewImg.src);
    this.previewImg.src = '';
  },

  async encryptImage() {
    if (!this.selectedFile) return;

    const useCustom = document.getElementById('image-custom-key-check').checked;
    const customKey = document.getElementById('image-custom-key-input').value.trim();
    if (useCustom && !customKey) { Toast.show('Enter a custom key', true); return; }

    this.encryptBtn.disabled = true;
    this.encryptBtn.textContent = 'ENCRYPTING...';

    try {
      const encType = document.getElementById('image-strength').value;
      const buffer = await this.selectedFile.arrayBuffer();
      const label = this.label.value.trim() || this.selectedFile.name;

      let encCiphertext;
      if (useCustom) {
        const { ciphertext } = Crypto.customEncryptBytes(buffer, customKey);
        encCiphertext = ciphertext;
        await API.post('api/image/save', {
          label, iv: '', ciphertext,
          mime_type: this.selectedFile.type,
          enc_type: encType, custom_key: true,
        });
      } else {
        const result = await Crypto.encryptBytes(buffer, encType);
        encCiphertext = result.ciphertext;
        await API.post('api/image/save', {
          label, iv: result.iv || '', ciphertext: result.ciphertext,
          mime_type: this.selectedFile.type,
          enc_type: encType,
        });
        // Show vault key
        const vaultDisplay = document.getElementById('image-vault-key-display');
        if (vaultDisplay) vaultDisplay.value = result.iv || 'No key (asymmetric)';
      }

      // Auto-download .enc file
      const blob = new Blob([encCiphertext], { type: 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (label || 'encrypted') + '.enc';
      a.click();

      this.clearFile();
      if (Settings.isAutoClear()) {
        this.label.value = '';
        document.getElementById('image-custom-key-input').value = '';
        const vaultDisplay = document.getElementById('image-vault-key-display');
        if (vaultDisplay) vaultDisplay.value = '';
      }
      this.label.value = '';
      Toast.show('Image encrypted, saved, and downloaded');
      this.loadList();
      App.refreshStats();

    } catch (e) {
      Toast.show('Encryption failed: ' + e.message, true);
    } finally {
      this.encryptBtn.disabled = false;
      this.encryptBtn.textContent = 'ENCRYPT & SAVE';
    }
  },

  async loadList() {
    try {
      const items = await API.get('api/image/list');
      this._allItems = items;
      this.currentPage = 0;
      this._renderPage();
    } catch (e) {
      Toast.show('Failed to load images', true);
    }
  },

  _renderPage() {
    const items = this._allItems;
    if (items.length === 0) {
      this.grid.innerHTML = '';
      this.emptyState.style.display = 'block';
      return;
    }
    this.emptyState.style.display = 'none';
    const start = this.currentPage * this._pageSize;
    const pageItems = items.slice(start, start + this._pageSize);
    let html = pageItems
      .map(
        (item) => `
      <div class="image-card">
        <div style="text-align:center;padding:8px;">
          <div class="image-card__placeholder">&#9919;</div>
          <div style="font-size:11px;color:var(--color-text-muted);margin-top:8px;">${this._esc(item.label)}</div>
          <div style="font-size:10px;color:var(--color-text-muted);margin-top:4px;">${item.custom_key ? 'Custom Key' : (item.enc_type || 'aes-256-gcm').toUpperCase()} &middot; ${this._formatDate(item.created_at)}</div>
          <div style="display:flex;gap:4px;margin-top:8px;justify-content:center;flex-wrap:wrap;">
            <button class="btn btn--small" onclick="ImageTab.viewEncrypted('${item.id}')">VIEW</button>
            <button class="btn btn--small" onclick="ImageTab.downloadEnc('${item.id}')">DOWNLOAD</button>
            <button class="btn btn--small" onclick="ImageTab.renameImage('${item.id}')">RENAME</button>
            <button class="btn btn--small btn--danger" onclick="ImageTab.deleteImage('${item.id}')">DEL</button>
          </div>
        </div>
      </div>
    `
      )
      .join('');

    if (items.length > this._pageSize) {
      const totalPages = Math.ceil(items.length / this._pageSize);
      html += '<div style="display:flex;justify-content:center;gap:12px;padding:16px 0;align-items:center;grid-column:1/-1;">';
      html += '<button class="btn btn--small" onclick="ImageTab.prevPage()"' + (this.currentPage === 0 ? ' disabled' : '') + '>PREV</button>';
      html += '<span style="font-size:0.8rem;color:var(--color-text-muted);">Page ' + (this.currentPage + 1) + ' of ' + totalPages + '</span>';
      html += '<button class="btn btn--small" onclick="ImageTab.nextPage()"' + (this.currentPage >= totalPages - 1 ? ' disabled' : '') + '>NEXT</button>';
      html += '</div>';
    }

    this.grid.innerHTML = html;
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
    const items = this.grid.querySelectorAll('.image-card');
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? '' : 'none';
    });
  },


  async viewEncrypted(id) {
    Toast.show('Loading...');
    try {
      const data = await API.get('api/image/get?id=' + id);
      const modal = document.getElementById('text-modal');
      document.getElementById('text-modal-title').textContent = data.label;
      const isCustom = !!data.custom_key;
      document.getElementById('text-modal-strength').textContent = isCustom ? 'Custom Key' : (data.enc_type || 'aes-256-gcm').toUpperCase();
      const body = document.getElementById('text-modal-body');
      body.innerHTML = '';

      // Encrypted image preview (noise)
      const raw = atob(data.ciphertext);
      const size = Math.ceil(Math.sqrt(raw.length / 3));
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.style.cssText = 'width:100%;max-height:200px;object-fit:contain;border:var(--border-muted);margin-bottom:16px;';
      const ctx = canvas.getContext('2d');
      const imgData = ctx.createImageData(size, size);
      for (let i = 0; i < imgData.data.length; i += 4) {
        const j = (i / 4) * 3;
        imgData.data[i] = j < raw.length ? raw.charCodeAt(j) : 0;
        imgData.data[i + 1] = j + 1 < raw.length ? raw.charCodeAt(j + 1) : 0;
        imgData.data[i + 2] = j + 2 < raw.length ? raw.charCodeAt(j + 2) : 0;
        imgData.data[i + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);

      const imgLabel = document.createElement('label');
      imgLabel.textContent = 'Encrypted Image';
      imgLabel.style.cssText = 'font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-text-muted);display:block;margin-bottom:4px;';
      body.appendChild(imgLabel);
      body.appendChild(canvas);

      // Key section (only for vault-encrypted)
      if (!isCustom && data.iv) {
        const keyGroup = document.createElement('div');
        keyGroup.className = 'input-group';
        keyGroup.style.marginBottom = '16px';
        keyGroup.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <label>Key (IV)</label>
            <div style="display:flex;gap:4px;">
              <button class="btn btn--small btn--icon key-eye" data-target="img-view-key">&#9675;</button>
              <button class="btn btn--small" onclick="navigator.clipboard.writeText(document.getElementById('img-view-key').dataset.value);Toast.show('Key copied')">COPY</button>
            </div>
          </div>
          <pre id="img-view-key" class="key-hidden" data-value="${this._esc(data.iv)}" style="white-space:pre-wrap;word-break:break-all;font-family:'Courier New',monospace;font-size:0.8rem;line-height:1.5;padding:12px;border:var(--border-muted);background:var(--color-input-bg);">${this._esc(data.iv)}</pre>
        `;
        body.appendChild(keyGroup);
      }

      // Size + download
      const sizeKB = Math.round((data.ciphertext.length * 3) / 4 / 1024);
      const footer = document.createElement('div');
      footer.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
      footer.innerHTML = `
        <span style="font-size:0.8rem;color:var(--color-text-muted);">${sizeKB} KB encrypted</span>
        <button class="btn btn--small btn--primary" id="img-view-dl">DOWNLOAD .ENC</button>
      `;
      body.appendChild(footer);

      // Download handler
      setTimeout(() => {
        document.getElementById('img-view-dl').addEventListener('click', () => {
          const blob = new Blob([data.ciphertext], { type: 'application/octet-stream' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = (data.label || 'encrypted') + '.enc';
          a.click();
          Toast.show('Downloaded');
        });
      }, 0);

      modal.classList.remove('modal-overlay--hidden');
    } catch (e) {
      Toast.show('Failed: ' + e.message, true);
    }
  },

  async decryptImage(id) {
    Toast.show('Decrypting...');
    try {
      const data = await API.get('api/image/get?id=' + id);
      let plainBuffer;
      if (data.custom_key) {
        const pass = await promptInput('This image was encrypted with a custom key.', 'Enter Custom Key', 'Enter the passphrase...');
        if (!pass) return;
        plainBuffer = Crypto.customDecryptBytes(data.ciphertext, pass);
        if (!plainBuffer || !plainBuffer.byteLength) { Toast.show('Wrong key', true); return; }
      } else {
        plainBuffer = await Crypto.decryptBytes(data.iv, data.ciphertext, data.enc_type || data.strength || 'aes-256-gcm');
      }
      const mime = data.mime_type || 'image/png';
      const blob = new Blob([plainBuffer], { type: mime });
      this._decryptedBlob = blob;
      this._decryptedLabel = data.label;
      this._decryptedExt = mime.split('/')[1] || 'png';
      this._rawCipherB64 = data.ciphertext;
      this._showingRaw = false;

      this.viewerImg.src = URL.createObjectURL(blob);
      this.viewerImg.style.display = 'block';
      document.getElementById('image-viewer-raw-canvas').style.display = 'none';
      this.viewer.classList.remove('modal-overlay--hidden');
      document.getElementById('image-viewer-label').textContent = data.label;
      document.getElementById('image-viewer-strength').textContent = 'AES-' + (data.strength || 256);
      document.getElementById('image-viewer-download').style.display = 'inline-flex';
      document.getElementById('image-viewer-raw').style.display = 'inline-flex';
      document.getElementById('image-viewer-raw').textContent = 'SHOW ENCRYPTED';
      document.getElementById('image-viewer-badge').textContent = 'Decrypted';
    } catch (e) {
      Toast.show('Decryption failed: ' + e.message, true);
    }
  },

  toggleRawView() {
    this._showingRaw = !this._showingRaw;
    const img = this.viewerImg;
    const canvas = document.getElementById('image-viewer-raw-canvas');
    const btn = document.getElementById('image-viewer-raw');
    const badge = document.getElementById('image-viewer-badge');

    if (this._showingRaw) {
      // Render encrypted bytes as garbled pixel noise
      const raw = atob(this._rawCipherB64);
      const size = Math.ceil(Math.sqrt(raw.length / 3));
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const imgData = ctx.createImageData(size, size);
      for (let i = 0; i < imgData.data.length; i += 4) {
        const j = (i / 4) * 3;
        imgData.data[i] = j < raw.length ? raw.charCodeAt(j) : 0;
        imgData.data[i + 1] = j + 1 < raw.length ? raw.charCodeAt(j + 1) : 0;
        imgData.data[i + 2] = j + 2 < raw.length ? raw.charCodeAt(j + 2) : 0;
        imgData.data[i + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
      img.style.display = 'none';
      canvas.style.display = 'block';
      btn.textContent = 'SHOW DECRYPTED';
      badge.textContent = 'Encrypted (raw)';
    } else {
      img.style.display = 'block';
      canvas.style.display = 'none';
      btn.textContent = 'SHOW ENCRYPTED';
      badge.textContent = 'Decrypted';
    }
  },

  downloadDecrypted() {
    if (!this._decryptedBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(this._decryptedBlob);
    a.download = (this._decryptedLabel || 'decrypted') + '.' + this._decryptedExt;
    a.click();
    Toast.show('Image downloaded');
  },

  async downloadEnc(id) {
    try {
      const data = await API.get('api/image/get?id=' + id);
      const blob = new Blob([data.ciphertext], { type: 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (data.label || 'encrypted') + '.enc';
      a.click();
      Toast.show('Encrypted file downloaded');
    } catch (e) {
      Toast.show('Failed: ' + e.message, true);
    }
  },

  async renameImage(id) {
    const newLabel = await promptInput('Enter a new name for this image.', 'Rename', 'New label...');
    if (!newLabel) return;
    try {
      await API.post('api/image/rename', { id, label: newLabel });
      Toast.show('Renamed');
      this.loadList();
      App.refreshStats();
    } catch (e) {
      Toast.show('Rename failed: ' + e.message, true);
    }
  },

  async deleteAll() {
    if (!await confirmAction('Delete ALL image entries? This cannot be undone.', 'Delete All')) return;
    try {
      const items = await API.get('api/image/list');
      for (const item of items) {
        await API.del('api/image/delete', { id: item.id });
      }
      Toast.show('All images deleted');
      this.loadList();
      App.refreshStats();
    } catch (e) {
      Toast.show('Delete all failed: ' + e.message, true);
    }
  },

  async deleteImage(id) {
    if (Settings.isConfirmDelete() && !await confirmAction('Delete this encrypted image?', 'Delete')) return;
    try {
      await API.del('api/image/delete', { id });
      Toast.show('Image deleted');
      this.loadList();
      App.refreshStats();

    } catch (e) {
      Toast.show('Delete failed: ' + e.message, true);
    }
  },

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  _formatDate(iso) {
    return new Date(iso).toLocaleDateString();
  },
};
