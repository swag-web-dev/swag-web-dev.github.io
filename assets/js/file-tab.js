const FileTab = {
  _init: false,
  selectedFile: null,
  _decFile: null,

  init() {
    if (this._init) return;
    this._init = true;

    // Encrypt elements
    this.dropZone = document.getElementById('file-drop-zone');
    this.fileInput = document.getElementById('file-file-input');
    this.preview = document.getElementById('file-preview');
    this.encryptBtn = document.getElementById('file-encrypt-btn');

    this.dropZone.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', (e) => this.handleFile(e.target.files[0]));
    this.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); this.dropZone.classList.add('drop-zone--active'); });
    this.dropZone.addEventListener('dragleave', () => this.dropZone.classList.remove('drop-zone--active'));
    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drop-zone--active');
      if (e.dataTransfer.files.length) this.handleFile(e.dataTransfer.files[0]);
    });
    this.encryptBtn.addEventListener('click', () => this.encryptFile());

    // Custom key toggle
    document.getElementById('file-custom-key-check').addEventListener('change', function() {
      document.getElementById('file-custom-key-wrap').style.display = this.checked ? 'flex' : 'none';
      document.getElementById('file-vault-key-wrap').style.display = this.checked ? 'none' : 'flex';
      if (!this.checked) document.getElementById('file-custom-key-input').value = '';
    });

    // Decrypt elements
    const decDrop = document.getElementById('dec-file-drop');
    const decInput = document.getElementById('dec-file-input');
    const decBtn = document.getElementById('dec-file-btn');

    decDrop.addEventListener('click', () => decInput.click());
    decInput.addEventListener('change', (e) => this._handleDecFile(e.target.files[0]));
    decDrop.addEventListener('dragover', (e) => { e.preventDefault(); decDrop.classList.add('drop-zone--active'); });
    decDrop.addEventListener('dragleave', () => decDrop.classList.remove('drop-zone--active'));
    decDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      decDrop.classList.remove('drop-zone--active');
      if (e.dataTransfer.files.length) this._handleDecFile(e.dataTransfer.files[0]);
    });
    decBtn.addEventListener('click', () => this.decryptFile());

    // Decrypt custom key toggle
    document.getElementById('dec-file-custom-check').addEventListener('change', function() {
      document.getElementById('dec-file-vault-wrap').style.display = this.checked ? 'none' : 'flex';
      document.getElementById('dec-file-custom-wrap').style.display = this.checked ? 'flex' : 'none';
    });
  },

  handleFile(file) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      Toast.show('File must be under 50MB', true);
      return;
    }
    this.selectedFile = file;
    this.dropZone.style.display = 'none';
    this.preview.style.display = 'block';
    document.getElementById('file-file-name').textContent = file.name;
    document.getElementById('file-file-size').textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB';
    this.encryptBtn.disabled = false;
  },

  clearFile() {
    this.selectedFile = null;
    this.dropZone.style.display = 'flex';
    this.preview.style.display = 'none';
    this.fileInput.value = '';
    this.encryptBtn.disabled = true;
  },

  async encryptFile() {
    if (!this.selectedFile) return;

    const useCustom = document.getElementById('file-custom-key-check').checked;
    const customKey = document.getElementById('file-custom-key-input').value.trim();
    if (useCustom && !customKey) { Toast.show('Enter a custom key', true); return; }

    this.encryptBtn.disabled = true;
    this.encryptBtn.textContent = 'ENCRYPTING...';

    try {
      const encType = document.getElementById('file-strength').value;
      const buffer = await this.selectedFile.arrayBuffer();
      const originalName = this.selectedFile.name;
      let encCiphertext, iv = '';

      if (useCustom) {
        const result = Crypto.customEncryptBytes(buffer, customKey);
        encCiphertext = result.ciphertext;
      } else {
        const result = await Crypto.encryptBytes(buffer, encType);
        encCiphertext = result.ciphertext;
        iv = result.iv || '';
        document.getElementById('file-vault-key-display').value = iv || 'No key (asymmetric)';
      }

      // Auto-download .enc file with original filename embedded
      const header = JSON.stringify({ name: originalName, enc_type: encType, custom: useCustom });
      const headerB64 = btoa(header);
      const payload = headerB64 + '\n' + encCiphertext;
      const blob = new Blob([payload], { type: 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = originalName + '.enc';
      a.click();

      // Update output display
      document.getElementById('file-enc-output').innerHTML =
        '<div style="text-align:center;">' +
        '<div style="font-size:0.85rem;margin-bottom:4px;">' + originalName + '.enc</div>' +
        '<div style="font-size:0.75rem;color:var(--color-text-muted);">Downloaded</div>' +
        '</div>';

      this.clearFile();
      if (Settings.isAutoClear()) {
        document.getElementById('file-custom-key-input').value = '';
        document.getElementById('file-vault-key-display').value = '';
      }
      Toast.show('File encrypted and downloaded');
    } catch (e) {
      Toast.show('Encryption failed: ' + e.message, true);
    } finally {
      this.encryptBtn.disabled = false;
      this.encryptBtn.textContent = 'ENCRYPT';
    }
  },

  _handleDecFile(file) {
    if (!file) return;
    this._decFile = file;
    document.getElementById('dec-file-drop').style.display = 'none';
    const info = document.getElementById('dec-file-info');
    info.style.display = 'block';
    info.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:var(--border-muted);">
        <div>
          <div style="font-size:0.85rem;">${file.name}</div>
          <div style="font-size:0.75rem;color:var(--color-text-muted);">${(file.size / 1024).toFixed(0)} KB</div>
        </div>
        <button class="btn btn--small btn--danger" onclick="FileTab._clearDecFile()">REMOVE</button>
      </div>
    `;
    document.getElementById('dec-file-btn').disabled = false;
  },

  _clearDecFile() {
    this._decFile = null;
    document.getElementById('dec-file-drop').style.display = 'flex';
    document.getElementById('dec-file-info').style.display = 'none';
    document.getElementById('dec-file-input').value = '';
    document.getElementById('dec-file-btn').disabled = true;
    document.getElementById('dec-file-output').innerHTML = 'Decrypted file will appear here with download';
  },

  async decryptFile() {
    if (!this._decFile) return;

    const useCustom = document.getElementById('dec-file-custom-check').checked;
    const customPass = document.getElementById('dec-file-custom-input').value.trim();
    const key = document.getElementById('dec-file-key').value.trim();
    if (useCustom && !customPass) { Toast.show('Enter the custom passphrase', true); return; }
    if (!useCustom && !key) { Toast.show('Enter the key (IV)', true); return; }

    const encType = document.getElementById('dec-file-strength').value;
    const btn = document.getElementById('dec-file-btn');
    btn.disabled = true;
    btn.textContent = 'DECRYPTING...';

    try {
      const text = await this._decFile.text();
      let ciphertext, originalName = 'decrypted_file';

      // Check if file has a header line
      const firstNewline = text.indexOf('\n');
      if (firstNewline > 0 && firstNewline < 500) {
        try {
          const header = JSON.parse(atob(text.substring(0, firstNewline)));
          originalName = header.name || originalName;
          ciphertext = text.substring(firstNewline + 1).trim();
        } catch (e) {
          ciphertext = text.trim();
        }
      } else {
        ciphertext = text.trim();
      }

      let plainBuffer;
      if (useCustom) {
        plainBuffer = Crypto.customDecryptBytes(ciphertext, customPass);
        if (!plainBuffer || !plainBuffer.byteLength) { Toast.show('Wrong custom key', true); return; }
      } else {
        plainBuffer = await Crypto.decryptBytes(key, ciphertext, encType);
      }

      // If header parsing failed (originalName is still default), try magic bytes
      if (originalName === 'decrypted_file') {
        const bytes = new Uint8Array(plainBuffer);
        let ext = '.bin';
        if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
          ext = '.pdf'; // %PDF
        } else if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
          ext = '.png'; // PNG header
        } else if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
          ext = '.jpg'; // JPEG
        } else if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B) {
          ext = '.zip'; // ZIP / PK
        }
        originalName = 'decrypted_file' + ext;
      }

      const blob = new Blob([plainBuffer]);

      // Show download in output area
      const output = document.getElementById('dec-file-output');
      output.innerHTML = `
        <div style="text-align:center;">
          <div style="font-size:0.85rem;margin-bottom:8px;">${this._esc(originalName)}</div>
          <div style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:12px;">${(plainBuffer.byteLength / 1024).toFixed(0)} KB</div>
          <button class="btn btn--small btn--primary" id="dec-file-download-btn">DOWNLOAD</button>
        </div>
      `;
      document.getElementById('dec-file-download-btn').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = originalName;
        a.click();
        Toast.show('Downloaded');
      });

      Toast.show('Decrypted');
    } catch (e) {
      Toast.show('Decryption failed - wrong key, type, or corrupted file', true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'DECRYPT';
    }
  },

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },
};
