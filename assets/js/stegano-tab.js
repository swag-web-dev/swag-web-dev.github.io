const SteganoTab = {
  _init: false,
  init() {
    if (this._init) return;
    this._init = true;
    // Encode elements
    this.encodeDropZone = document.getElementById('steg-encode-drop');
    this.encodeFileInput = document.getElementById('steg-encode-file');
    this.encodeMessage = document.getElementById('steg-encode-message');
    this.encodeBtn = document.getElementById('steg-encode-btn');
    this.encodePreview = document.getElementById('steg-encode-preview');
    this.encodePreviewImg = document.getElementById('steg-encode-preview-img');
    this.encodeCapacity = document.getElementById('steg-encode-capacity');
    this.encodeLabel = document.getElementById('steg-encode-label');

    // Decode elements
    this.decodeDropZone = document.getElementById('steg-decode-drop');
    this.decodeFileInput = document.getElementById('steg-decode-file');
    this.decodeBtn = document.getElementById('steg-decode-btn');
    this.decodePreview = document.getElementById('steg-decode-preview');
    this.decodePreviewImg = document.getElementById('steg-decode-preview-img');
    this.decodeResult = document.getElementById('steg-decode-result');
    this.decodeResultText = document.getElementById('steg-decode-result-text');

    // Saved list
    this.list = document.getElementById('steg-list');
    this.emptyState = document.getElementById('steg-empty');
    this.currentPage = 0;
    this._allItems = [];
    this._pageSize = 10;

    this.subTabs = [];
    this.subPanels = [];

    this.carrierFile = null;
    this.decodeFile = null;
    this._encodedBlob = null;

    this._bindEvents();
    this.loadList();
  },

  _bindEvents() {
    // Encode drop zone
    this.encodeDropZone.addEventListener('click', () => this.encodeFileInput.click());
    this.encodeFileInput.addEventListener('change', (e) => this._handleCarrier(e.target.files[0]));
    this.encodeDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.encodeDropZone.classList.add('drop-zone--active');
    });
    this.encodeDropZone.addEventListener('dragleave', () => this.encodeDropZone.classList.remove('drop-zone--active'));
    this.encodeDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.encodeDropZone.classList.remove('drop-zone--active');
      if (e.dataTransfer.files.length) this._handleCarrier(e.dataTransfer.files[0]);
    });

    // Decode drop zone
    this.decodeDropZone.addEventListener('click', () => this.decodeFileInput.click());
    this.decodeFileInput.addEventListener('change', (e) => this._handleDecode(e.target.files[0]));
    this.decodeDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.decodeDropZone.classList.add('drop-zone--active');
    });
    this.decodeDropZone.addEventListener('dragleave', () => this.decodeDropZone.classList.remove('drop-zone--active'));
    this.decodeDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.decodeDropZone.classList.remove('drop-zone--active');
      if (e.dataTransfer.files.length) this._handleDecode(e.dataTransfer.files[0]);
    });

    this.encodeBtn.addEventListener('click', () => this.encode());
    this.decodeBtn.addEventListener('click', () => this.decode());

    // Update capacity on message input
    this.encodeMessage.addEventListener('input', () => this._updateCapacity());

    // Update capacity when encryption type changes
    document.getElementById('steg-encode-strength').addEventListener('change', () => this._updateCapacity());
    document.getElementById('steg-custom-key-check').addEventListener('change', () => this._updateCapacity());

  },

  _handleCarrier(file) {
    if (!file || !file.type.startsWith('image/')) {
      Toast.show('Select an image file', true);
      return;
    }
    this.carrierFile = file;
    this.encodeDropZone.style.display = 'none';
    this.encodePreview.style.display = 'block';
    this.encodePreviewImg.src = URL.createObjectURL(file);
    this.encodePreviewImg.onload = () => this._updateCapacity();
    document.getElementById('steg-encode-file-name').innerHTML =
      file.name + ' (' + Math.round(file.size / 1024) + ' KB) ' +
      '<button class="btn btn--small btn--danger" style="margin-left:8px;" onclick="SteganoTab.clearCarrier()">REMOVE</button>';
  },

  clearCarrier() {
    this.carrierFile = null;
    this.encodeDropZone.style.display = 'flex';
    this.encodePreview.style.display = 'none';
    this.encodeFileInput.value = '';
    this.encodeCapacity.innerHTML = '';
    this.encodeBtn.disabled = true;
    URL.revokeObjectURL(this.encodePreviewImg.src);
    this.encodePreviewImg.src = '';
  },

  _handleDecode(file) {
    if (!file || !file.type.startsWith('image/')) {
      Toast.show('Select a PNG image', true);
      return;
    }
    this.decodeFile = file;
    this.decodeDropZone.style.display = 'none';
    this.decodePreview.style.display = 'block';
    this.decodePreviewImg.src = URL.createObjectURL(file);
    document.getElementById('steg-decode-file-name').innerHTML =
      file.name + ' (' + Math.round(file.size / 1024) + ' KB) ' +
      '<button class="btn btn--small btn--danger" style="margin-left:8px;" onclick="SteganoTab.clearDecode()">REMOVE</button>';
    this.decodeBtn.disabled = false;
  },

  clearDecode() {
    this.decodeFile = null;
    this.decodeDropZone.style.display = 'flex';
    this.decodePreview.style.display = 'none';
    this.decodeFileInput.value = '';
    this.decodeBtn.disabled = true;
    this.decodeResult.style.display = 'none';
    URL.revokeObjectURL(this.decodePreviewImg.src);
    this.decodePreviewImg.src = '';
  },

  _updateCapacity() {
    if (!this.encodePreviewImg.naturalWidth) return;
    const w = this.encodePreviewImg.naturalWidth;
    const h = this.encodePreviewImg.naturalHeight;
    const maxBits = w * h * 3 - 32;

    // Determine overhead multiplier based on selected encryption type
    const useCustom = document.getElementById('steg-custom-key-check').checked;
    const encType = document.getElementById('steg-encode-strength').value;
    let multiplier = 1.8; // default
    if (useCustom) {
      multiplier = 1.8; // base64 + AES overhead (CryptoJS)
    } else if (encType === 'aes-128-gcm' || encType === 'aes-256-gcm') {
      multiplier = 1.6; // base64 + GCM tag
    } else if (encType === 'aes-128-cbc' || encType === 'aes-192-cbc' || encType === 'aes-256-cbc') {
      multiplier = 1.8; // base64 + CBC padding
    } else if (encType === 'chacha20') {
      multiplier = 1.7;
    } else if (encType === 'rsa' || encType === 'ecdh') {
      multiplier = 3.0; // hybrid encryption has more overhead
    }

    const maxChars = Math.floor(maxBits / 8 / multiplier);
    const msgLen = this.encodeMessage.value.length;
    const pct = Math.min((msgLen / maxChars) * 100, 100);

    this.encodeCapacity.innerHTML = `
      <div style="font-size:11px;color:var(--color-text-muted);">Capacity: ~${msgLen} / ${maxChars} characters (encrypted)</div>
      <div class="capacity-bar"><div class="capacity-bar__fill" style="width:${pct}%"></div></div>
    `;

    this.encodeBtn.disabled = msgLen === 0 || msgLen > maxChars;
  },

  async encode() {
    if (!this.carrierFile || !this.encodeMessage.value.trim()) return;

    this.encodeBtn.disabled = true;
    this.encodeBtn.textContent = 'ENCODING...';

    try {
      const encType = document.getElementById('steg-encode-strength').value;
      const message = this.encodeMessage.value;

      const useCustom = document.getElementById('steg-custom-key-check').checked;
      const customKey = document.getElementById('steg-custom-key-input').value.trim();
      if (useCustom && !customKey) { Toast.show('Enter a custom key', true); return; }

      let embedText;
      this._lastStegCustom = useCustom;

      if (useCustom) {
        const { ciphertext } = Crypto.customEncrypt(message, customKey);
        embedText = 'CENC:' + ciphertext;
        this._lastStegIv = '';
        this._lastStegEncType = 0;
      } else {
        const result = await Crypto.encrypt(message, encType);
        embedText = 'ENC:' + encType + ':' + (result.iv || '') + ':' + result.ciphertext;
        this._lastStegIv = result.iv || '';
        this._lastStegEncType = encType;
      }

      const img = await this._loadImage(this.carrierFile);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;

      const msgBytes = new TextEncoder().encode(embedText);
      const msgBits = [];

      // 32-bit length header (bit count)
      const bitLength = msgBytes.length * 8;
      for (let i = 31; i >= 0; i--) {
        msgBits.push((bitLength >> i) & 1);
      }

      // Message bits
      for (const byte of msgBytes) {
        for (let i = 7; i >= 0; i--) {
          msgBits.push((byte >> i) & 1);
        }
      }

      // Check capacity
      let channelIndex = 0;
      let bitIndex = 0;

      for (let i = 0; i < pixels.length && bitIndex < msgBits.length; i++) {
        if (i % 4 === 3) continue; // skip alpha
        pixels[i] = (pixels[i] & 0xfe) | msgBits[bitIndex];
        bitIndex++;
      }

      if (bitIndex < msgBits.length) {
        Toast.show('Message too long for this image', true);
        return;
      }

      ctx.putImageData(imageData, 0, 0);

      this._encodedBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

      // Auto-save to vault
      const buffer = await this._encodedBlob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      const label = this.encodeLabel.value.trim() || 'Stego image';

      await API.post('api/stegano/save', {
        label,
        image_data: base64,
        has_message: true,
        iv: this._lastStegIv,
        enc_type: this._lastStegEncType,
        custom_key: this._lastStegCustom || false,
      });

      // Clear form
      this.clearCarrier();
      this.encodeMessage.value = '';
      this.encodeLabel.value = '';
      this.encodeCapacity.innerHTML = '';

      Toast.show('Encrypted, encoded, and saved');
      this.loadList();
      App.refreshStats();
    } catch (e) {
      Toast.show('Encoding failed: ' + e.message, true);
    } finally {
      this.encodeBtn.disabled = false;
      this.encodeBtn.textContent = 'ENCODE & ENCRYPT';
    }
  },

  async decode() {
    if (!this.decodeFile) return;

    const decKey = document.getElementById('steg-decode-key').value.trim();

    this.decodeBtn.disabled = true;
    this.decodeBtn.textContent = 'DECODING...';

    try {
      const img = await this._loadImage(this.decodeFile);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;

      // Extract bits from LSBs
      const allBits = [];
      for (let i = 0; i < pixels.length; i++) {
        if (i % 4 === 3) continue; // skip alpha
        allBits.push(pixels[i] & 1);
      }

      // Read 32-bit length header
      let bitLength = 0;
      for (let i = 0; i < 32; i++) {
        bitLength = (bitLength << 1) | allBits[i];
      }

      if (bitLength <= 0 || bitLength > allBits.length - 32) {
        Toast.show('No valid message found in this image', true);
        this.decodeResult.style.display = 'none';
        return;
      }

      // Extract message bits
      const msgBits = allBits.slice(32, 32 + bitLength);
      const bytes = [];
      for (let i = 0; i < msgBits.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8 && i + j < msgBits.length; j++) {
          byte = (byte << 1) | msgBits[i + j];
        }
        bytes.push(byte);
      }

      const rawText = new TextDecoder().decode(new Uint8Array(bytes));
      let message;

      if (rawText.startsWith('CENC:')) {
        // Custom key encrypted
        const ct = rawText.slice(5);
        const pass = decKey || await promptInput('This message was encrypted with a custom key.', 'Enter Custom Key', 'Enter the passphrase...');
        if (!pass) return;
        message = Crypto.customDecrypt(ct, pass);
        if (!message) {
          Toast.show('Wrong custom key', true);
          this.decodeResult.style.display = 'none';
          return;
        }
      } else if (rawText.startsWith('ENC:')) {
        // Vault key encrypted: ENC:bits:iv:ciphertext
        const parts = rawText.split(':');
        if (parts.length < 4) {
          Toast.show('Corrupted encrypted data', true);
          this.decodeResult.style.display = 'none';
          return;
        }
        const encType = parts[1];
        const iv = parts[2];
        const ct = parts.slice(3).join(':');
        const decType = document.getElementById('steg-decode-strength').value;
        const useIv = decKey || iv;

        try {
          message = await Crypto.decrypt(useIv, ct, decType || encType);
        } catch (e) {
          Toast.show('Decryption failed - wrong key or strength', true);
          this.decodeResult.style.display = 'none';
          return;
        }
      } else {
        // Plain text (no encryption)
        message = rawText;
      }

      this.decodeResult.style.display = 'block';
      this.decodeResultText.textContent = message;
      Toast.show('Message decoded');
    } catch (e) {
      Toast.show('Decoding failed: ' + e.message, true);
    } finally {
      this.decodeBtn.disabled = false;
      this.decodeBtn.textContent = 'DECODE MESSAGE';
    }
  },


  async loadList() {
    try {
      const items = await API.get('api/stegano/list');
      this._allItems = items;
      this.currentPage = 0;
      this._renderPage();
    } catch (e) {
      Toast.show('Failed to load stego images', true);
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
          <button class="btn btn--small" onclick="SteganoTab.viewSaved('${item.id}')">VIEW</button>
          <button class="btn btn--small" onclick="SteganoTab.downloadSaved('${item.id}')">DOWNLOAD</button>
          <button class="btn btn--small" onclick="SteganoTab.renameSaved('${item.id}')">RENAME</button>
          <button class="btn btn--small btn--danger" onclick="SteganoTab.deleteSaved('${item.id}')">DELETE</button>
        </div>
      </div>
    `
      )
      .join('');

    if (items.length > this._pageSize) {
      const totalPages = Math.ceil(items.length / this._pageSize);
      html += '<div style="display:flex;justify-content:center;gap:12px;padding:16px 0;align-items:center;">';
      html += '<button class="btn btn--small" onclick="SteganoTab.prevPage()"' + (this.currentPage === 0 ? ' disabled' : '') + '>PREV</button>';
      html += '<span style="font-size:0.8rem;color:var(--color-text-muted);">Page ' + (this.currentPage + 1) + ' of ' + totalPages + '</span>';
      html += '<button class="btn btn--small" onclick="SteganoTab.nextPage()"' + (this.currentPage >= totalPages - 1 ? ' disabled' : '') + '>NEXT</button>';
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

  async viewSaved(id) {
    try {
      const data = await API.get('api/stegano/get?id=' + id);
      const modal = document.getElementById('text-modal');
      document.getElementById('text-modal-title').textContent = data.label;
      document.getElementById('text-modal-strength').textContent = data.custom_key ? 'Custom Key' : (data.enc_type || 'aes-256-gcm').toUpperCase();
      const body = document.getElementById('text-modal-body');
      body.innerHTML = '';

      // Image preview
      const imgLabel = document.createElement('label');
      imgLabel.textContent = 'Stego Image';
      imgLabel.style.cssText = 'font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-text-muted);display:block;margin-bottom:4px;';
      body.appendChild(imgLabel);
      const img = document.createElement('img');
      img.src = 'data:image/png;base64,' + data.image_data;
      img.style.cssText = 'width:100%;max-height:250px;object-fit:contain;border:var(--border-muted);margin-bottom:16px;';
      body.appendChild(img);

      // Key if available (not for custom key entries)
      if (data.iv && !data.custom_key) {
        const keyGroup = document.createElement('div');
        keyGroup.className = 'input-group';
        keyGroup.style.marginBottom = '16px';
        keyGroup.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <label>Key (IV)</label>
            <div style="display:flex;gap:4px;">
              <button class="btn btn--small btn--icon key-eye" data-target="steg-view-key">&#9675;</button>
              <button class="btn btn--small" onclick="navigator.clipboard.writeText(document.getElementById('steg-view-key').dataset.value);Toast.show('Key copied')">COPY</button>
            </div>
          </div>
          <pre id="steg-view-key" class="key-hidden" data-value="${this._esc(data.iv)}" style="white-space:pre-wrap;word-break:break-all;font-family:'Courier New',monospace;font-size:0.8rem;line-height:1.5;padding:12px;border:var(--border-muted);background:var(--color-input-bg);">${this._esc(data.iv)}</pre>
        `;
        body.appendChild(keyGroup);
      }

      // Download button
      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn btn--small btn--primary';
      dlBtn.textContent = 'DOWNLOAD PNG';
      dlBtn.addEventListener('click', () => {
        const binary = atob(data.image_data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'image/png' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (data.label || 'stego') + '.png';
        a.click();
      });
      body.appendChild(dlBtn);

      modal.classList.remove('modal-overlay--hidden');
    } catch (e) {
      Toast.show('Failed: ' + e.message, true);
    }
  },

  async downloadSaved(id) {
    try {
      const data = await API.get('api/stegano/get?id=' + id);
      const binary = atob(data.image_data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/png' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (data.label || 'stego') + '.png';
      a.click();
    } catch (e) {
      Toast.show('Download failed: ' + e.message, true);
    }
  },

  async decodeSaved(id) {
    try {
      const data = await API.get('api/stegano/get?id=' + id);
      const binary = atob(data.image_data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/png' });
      this.decodeFile = new File([blob], 'stego.png', { type: 'image/png' });
      this.decodePreview.style.display = 'block';
      this.decodePreviewImg.src = URL.createObjectURL(blob);

      // Switch to decrypt tab > stegano
      App.goToTab('#decrypt');
      // Activate steg decode sub-panel
      document.querySelectorAll('#decrypt-sub-tabs .sub-tab').forEach(t => t.classList.remove('sub-tab--active'));
      document.querySelectorAll('#decrypt-section .sub-panel').forEach(p => p.style.display = 'none');
      document.querySelector('#decrypt-sub-tabs .sub-tab[data-panel="dec-steg-panel"]').classList.add('sub-tab--active');
      document.getElementById('dec-steg-panel').style.display = 'block';

      this.decode();
    } catch (e) {
      Toast.show('Failed: ' + e.message, true);
    }
  },

  async renameSaved(id) {
    const newLabel = await promptInput('Enter a new name for this stego image.', 'Rename', 'New label...');
    if (!newLabel) return;
    try {
      await API.post('api/stegano/rename', { id, label: newLabel });
      Toast.show('Renamed');
      this.loadList();
      App.refreshStats();
    } catch (e) {
      Toast.show('Rename failed: ' + e.message, true);
    }
  },

  async deleteAll() {
    if (!await confirmAction('Delete ALL stego entries? This cannot be undone.', 'Delete All')) return;
    try {
      const items = await API.get('api/stegano/list');
      for (const item of items) {
        await API.del('api/stegano/delete', { id: item.id });
      }
      Toast.show('All stego images deleted');
      this.loadList();
      App.refreshStats();
    } catch (e) {
      Toast.show('Delete all failed: ' + e.message, true);
    }
  },

  async deleteSaved(id) {
    if (Settings.isConfirmDelete() && !await confirmAction('Delete this stego image?', 'Delete')) return;
    try {
      await API.del('api/stegano/delete', { id });
      Toast.show('Deleted');
      this.loadList();
      App.refreshStats();
    } catch (e) {
      Toast.show('Delete failed: ' + e.message, true);
    }
  },

  _loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
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
