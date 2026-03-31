const Crypto = {
  _keys: {},
  _salt: null,
  _keyMaterial: null,
  _saltBytes: null,
  _rsaKeyPair: null,
  _ecdhKeyPair: null,

  async init(seedPhrase, salt) {
    this._salt = salt;
    await this._deriveAllKeys(seedPhrase, salt);
    // Store derived key (not seed phrase) in sessionStorage
    const rawKey = await window.crypto.subtle.exportKey('raw', this._keys['aes-256-gcm']);
    sessionStorage.setItem('_dk', this._bytesToBase64(new Uint8Array(rawKey)));
    sessionStorage.setItem('_salt', salt);
  },

  async restore() {
    const dk = sessionStorage.getItem('_dk');
    const salt = sessionStorage.getItem('_salt');
    if (dk && salt) {
      const rawKey = this._base64ToBytes(dk);
      this._keys['aes-256-gcm'] = await window.crypto.subtle.importKey(
        'raw', rawKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
      );
      this._keys[256] = this._keys['aes-256-gcm'];
      this._salt = salt;
      this._saltBytes = this._hexToBytes(salt);
      return true;
    }
    return false;
  },

  clear() {
    this._keys = {};
    this._salt = null;
    this._keyMaterial = null;
    this._rsaKeyPair = null;
    this._ecdhKeyPair = null;
    this._chatPrivateKey = null;
    sessionStorage.removeItem('_dk');
    sessionStorage.removeItem('_salt');
  },

  async _deriveAllKeys(seedPhrase, salt) {
    const enc = new TextEncoder();
    this._keyMaterial = await window.crypto.subtle.importKey(
      'raw', enc.encode(seedPhrase), 'PBKDF2', false, ['deriveKey', 'deriveBits']
    );
    this._saltBytes = this._hexToBytes(salt);

    // AES-256-GCM (exportable, also used for 192 derivation)
    this._keys['aes-256-gcm'] = await window.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: this._saltBytes, iterations: 600000, hash: 'SHA-256' },
      this._keyMaterial,
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );

    // Aliases for backward compat
    this._keys[256] = this._keys['aes-256-gcm'];
  },

  // Lazy key derivation
  async _getKey(encType) {
    if (this._keys[encType]) return this._keys[encType];

    const p = { name: 'PBKDF2', salt: this._saltBytes, iterations: 600000, hash: 'SHA-256' };

    switch (encType) {
      case 'aes-128-gcm':
        this._keys[encType] = await window.crypto.subtle.deriveKey(
          p, this._keyMaterial, { name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt']);
        break;
      case 'aes-128-cbc':
        this._keys[encType] = await window.crypto.subtle.deriveKey(
          p, this._keyMaterial, { name: 'AES-CBC', length: 128 }, false, ['encrypt', 'decrypt']);
        break;
      case 'aes-256-cbc':
        this._keys[encType] = await window.crypto.subtle.deriveKey(
          p, this._keyMaterial, { name: 'AES-CBC', length: 256 }, false, ['encrypt', 'decrypt']);
        break;
      case 'aes-192-cbc': {
        // Web Crypto doesn't support 192-bit. Export 256-bit key, truncate.
        const raw = new Uint8Array(await window.crypto.subtle.exportKey('raw', this._keys['aes-256-gcm']));
        this._keys[encType] = raw.slice(0, 24); // Used with CryptoJS
        break;
      }
      case 128: return this._getKey('aes-128-gcm');
      case 192: return this._getKey('aes-192-cbc');
      case 'chacha20': {
        // Derive 32 bytes for NaCl secretbox
        const raw = new Uint8Array(await window.crypto.subtle.exportKey('raw', this._keys['aes-256-gcm']));
        this._keys[encType] = raw;
        break;
      }
      default:
        throw new Error('Unsupported encryption type: ' + encType);
    }
    return this._keys[encType];
  },

  // ═══════════════════════════════════
  //  MAIN DISPATCHER
  // ═══════════════════════════════════

  async encrypt(plaintext, encType) {
    encType = this._normalizeType(encType);
    const enc = new TextEncoder();
    const data = enc.encode(plaintext);

    switch (encType) {
      case 'aes-128-gcm':
      case 'aes-256-gcm':
        return this._gcmEncrypt(data, encType);
      case 'aes-128-cbc':
      case 'aes-256-cbc':
        return this._cbcEncrypt(data, encType);
      case 'aes-192-cbc':
        return this._192encrypt(plaintext);
      case 'chacha20':
        return this._chachaEncrypt(data);
      case 'rsa': case 'rsa-512': case 'rsa-1024': case 'rsa-2048': case 'rsa-3072': case 'rsa-4096':
        return this._rsaEncrypt(data, encType);
      case 'ecdh':
        return this._ecdhEncrypt(data);
      case 'sha-256':
      case 'sha-384':
        return this._hash(data, encType);
      default:
        throw new Error('Unknown encryption type: ' + encType);
    }
  },

  async decrypt(iv, ciphertext, encType) {
    encType = this._normalizeType(encType);

    switch (encType) {
      case 'aes-128-gcm':
      case 'aes-256-gcm':
        return this._gcmDecrypt(iv, ciphertext, encType);
      case 'aes-128-cbc':
      case 'aes-256-cbc':
        return this._cbcDecrypt(iv, ciphertext, encType);
      case 'aes-192-cbc':
        return this._192decryptText(iv, ciphertext);
      case 'chacha20':
        return this._chachaDecrypt(iv, ciphertext);
      case 'rsa': case 'rsa-512': case 'rsa-1024': case 'rsa-2048': case 'rsa-3072': case 'rsa-4096':
        return this._rsaDecrypt(ciphertext);
      case 'ecdh':
        return this._ecdhDecrypt(iv, ciphertext);
      case 'sha-256':
      case 'sha-384':
        throw new Error('SHA hashes cannot be decrypted (one-way)');
      default:
        throw new Error('Unknown encryption type: ' + encType);
    }
  },

  async encryptBytes(data, encType) {
    encType = this._normalizeType(encType);
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    switch (encType) {
      case 'aes-128-gcm':
      case 'aes-256-gcm':
        return this._gcmEncrypt(u8, encType);
      case 'aes-128-cbc':
      case 'aes-256-cbc':
        return this._cbcEncrypt(u8, encType);
      case 'aes-192-cbc':
        return this._192encrypt(u8);
      case 'chacha20':
        return this._chachaEncrypt(u8);
      case 'rsa':
        return this._rsaEncrypt(u8);
      case 'ecdh':
        return this._ecdhEncrypt(u8);
      default:
        throw new Error('Unsupported for binary: ' + encType);
    }
  },

  async decryptBytes(iv, ciphertext, encType) {
    encType = this._normalizeType(encType);
    switch (encType) {
      case 'aes-128-gcm':
      case 'aes-256-gcm': {
        const bits = encType === 'aes-128-gcm' ? 128 : 256;
        const keyLen = bits / 8;
        const combined = this._base64ToBytes(iv);
        const rawKey = combined.slice(0, keyLen);
        const ivBytes = combined.slice(keyLen);
        const key = await window.crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
        const ct = this._base64ToBytes(ciphertext);
        return window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, ct);
      }
      case 'aes-128-cbc':
      case 'aes-256-cbc': {
        const bits2 = encType === 'aes-128-cbc' ? 128 : 256;
        const keyLen2 = bits2 / 8;
        const combined2 = this._base64ToBytes(iv);
        const rawKey2 = combined2.slice(0, keyLen2);
        const ivBytes2 = combined2.slice(keyLen2);
        const key2 = await window.crypto.subtle.importKey('raw', rawKey2, { name: 'AES-CBC' }, false, ['decrypt']);
        const ct2 = this._base64ToBytes(ciphertext);
        return window.crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes2 }, key2, ct2);
      }
      case 'aes-192-cbc': {
        const combined3 = this._base64ToBytes(iv);
        const rawKey3 = combined3.slice(0, 24);
        const ivBytes3 = combined3.slice(24);
        const key3 = CryptoJS.lib.WordArray.create(rawKey3);
        const iv3 = CryptoJS.lib.WordArray.create(ivBytes3);
        const cp = CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(ciphertext) });
        const dec = CryptoJS.AES.decrypt(cp, key3, { iv: iv3, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
        const w = dec.words, len = dec.sigBytes;
        const u8 = new Uint8Array(len);
        for (let i = 0; i < len; i++) u8[i] = (w[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
        return u8.buffer;
      }
      case 'chacha20': {
        const text = await this._chachaDecrypt(iv, ciphertext);
        return new TextEncoder().encode(text).buffer;
      }
      case 'rsa': case 'rsa-512': case 'rsa-1024': case 'rsa-2048': case 'rsa-3072': case 'rsa-4096': {
        const text = await this._rsaDecrypt(ciphertext);
        return new TextEncoder().encode(text).buffer;
      }
      case 'ecdh': {
        const text = await this._ecdhDecrypt(iv, ciphertext);
        return new TextEncoder().encode(text).buffer;
      }
      default:
        throw new Error('Unsupported for binary decrypt: ' + encType);
    }
  },

  // ═══════════════════════════════════
  //  AES-GCM
  // ═══════════════════════════════════

  async _gcmEncrypt(data, encType) {
    const bits = encType === 'aes-128-gcm' ? 128 : 256;
    const rawKey = window.crypto.getRandomValues(new Uint8Array(bits / 8));
    const key = await window.crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ct = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    // Pack rawKey + iv together as the shareable key
    const combined = new Uint8Array(rawKey.length + iv.length);
    combined.set(rawKey);
    combined.set(iv, rawKey.length);
    return {
      iv: this._bytesToBase64(combined),
      ciphertext: this._bytesToBase64(new Uint8Array(ct)),
      enc_type: encType,
    };
  },

  async _gcmDecrypt(ivB64, ctB64, encType) {
    const bits = encType === 'aes-128-gcm' ? 128 : 256;
    const keyLen = bits / 8;
    const combined = this._base64ToBytes(ivB64);
    const rawKey = combined.slice(0, keyLen);
    const iv = combined.slice(keyLen);
    const key = await window.crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const ct = this._base64ToBytes(ctB64);
    const pt = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  },

  // ═══════════════════════════════════
  //  AES-CBC (128/256 via Web Crypto)
  // ═══════════════════════════════════

  async _cbcEncrypt(data, encType) {
    const bits = encType === 'aes-128-cbc' ? 128 : 256;
    const rawKey = window.crypto.getRandomValues(new Uint8Array(bits / 8));
    const key = await window.crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, false, ['encrypt']);
    const iv = window.crypto.getRandomValues(new Uint8Array(16));
    const ct = await window.crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, data);
    const combined = new Uint8Array(rawKey.length + iv.length);
    combined.set(rawKey);
    combined.set(iv, rawKey.length);
    return {
      iv: this._bytesToBase64(combined),
      ciphertext: this._bytesToBase64(new Uint8Array(ct)),
      enc_type: encType,
    };
  },

  async _cbcDecrypt(ivB64, ctB64, encType) {
    const bits = encType === 'aes-128-cbc' ? 128 : 256;
    const keyLen = bits / 8;
    const combined = this._base64ToBytes(ivB64);
    const rawKey = combined.slice(0, keyLen);
    const iv = combined.slice(keyLen);
    const key = await window.crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, false, ['decrypt']);
    const ct = this._base64ToBytes(ctB64);
    const pt = await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ct);
    return new TextDecoder().decode(pt);
  },

  // ═══════════════════════════════════
  //  AES-192-CBC (CryptoJS)
  // ═══════════════════════════════════

  _192encrypt(data) {
    // Generate random 24-byte key
    const rawKey = new Uint8Array(24);
    window.crypto.getRandomValues(rawKey);
    const key = CryptoJS.lib.WordArray.create(rawKey);
    const iv = CryptoJS.lib.WordArray.random(16);
    const encrypted = CryptoJS.AES.encrypt(
      typeof data === 'string' ? data : CryptoJS.lib.WordArray.create(data),
      key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
    );
    // Pack rawKey + iv as combined key
    const ivBytes = new Uint8Array(16);
    for (let i = 0; i < 4; i++) {
      const w = iv.words[i];
      ivBytes[i*4] = (w >>> 24) & 0xff;
      ivBytes[i*4+1] = (w >>> 16) & 0xff;
      ivBytes[i*4+2] = (w >>> 8) & 0xff;
      ivBytes[i*4+3] = w & 0xff;
    }
    const combined = new Uint8Array(24 + 16);
    combined.set(rawKey);
    combined.set(ivBytes, 24);
    return {
      iv: this._bytesToBase64(combined),
      ciphertext: encrypted.ciphertext.toString(CryptoJS.enc.Base64),
      enc_type: 'aes-192-cbc',
    };
  },

  _192decryptText(ivB64, ctB64) {
    const combined = this._base64ToBytes(ivB64);
    const rawKey = combined.slice(0, 24);
    const ivBytes = combined.slice(24);
    const key = CryptoJS.lib.WordArray.create(rawKey);
    const iv = CryptoJS.lib.WordArray.create(ivBytes);
    const cp = CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(ctB64) });
    const dec = CryptoJS.AES.decrypt(cp, key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
    return dec.toString(CryptoJS.enc.Utf8);
  },

  // ═══════════════════════════════════
  //  ChaCha20-Poly1305 (via tweetnacl)
  // ═══════════════════════════════════

  async _chachaEncrypt(data) {
    const rawKey = nacl.randomBytes(32);
    const nonce = nacl.randomBytes(24);
    const ct = nacl.secretbox(data, nonce, rawKey);
    // Pack key + nonce as combined key
    const combined = new Uint8Array(32 + 24);
    combined.set(rawKey);
    combined.set(nonce, 32);
    return {
      iv: this._bytesToBase64(combined),
      ciphertext: this._bytesToBase64(ct),
      enc_type: 'chacha20',
    };
  },

  async _chachaDecrypt(ivB64, ctB64) {
    const combined = this._base64ToBytes(ivB64);
    const key = combined.slice(0, 32);
    const nonce = combined.slice(32);
    const ct = this._base64ToBytes(ctB64);
    const pt = nacl.secretbox.open(ct, nonce, key);
    if (!pt) throw new Error('Decryption failed');
    return new TextDecoder().decode(pt);
  },

  // ═══════════════════════════════════
  //  RSA-OAEP (hybrid: RSA + AES-GCM)
  // ═══════════════════════════════════

  _rsaKeySizes: { 'rsa-512': 512, 'rsa-1024': 1024, 'rsa-2048': 2048, 'rsa-3072': 3072, 'rsa-4096': 4096, 'rsa': 2048 },

  async _rsaEncrypt(data, encType) {
    const bits = this._rsaKeySizes[encType] || 2048;
    const keyPair = await window.crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt']
    );
    // Hybrid: random AES key + RSA-wrapped
    const aesKey = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ct = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, data);
    const rawAes = await window.crypto.subtle.exportKey('raw', aesKey);
    const wrappedKey = await window.crypto.subtle.encrypt({ name: 'RSA-OAEP' }, keyPair.publicKey, rawAes);
    const privKey = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);

    const payload = JSON.stringify({
      wrapped_key: this._bytesToBase64(new Uint8Array(wrappedKey)),
      iv: this._bytesToBase64(iv),
      ct: this._bytesToBase64(new Uint8Array(ct)),
      priv: privKey,
      rsa_bits: bits,
    });
    return { iv: '', ciphertext: btoa(payload), enc_type: encType };
  },

  async _rsaDecrypt(ctB64) {
    const payload = JSON.parse(atob(ctB64));
    const privKey = await window.crypto.subtle.importKey('jwk', payload.priv,
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    const wrappedKey = this._base64ToBytes(payload.wrapped_key);
    const rawAes = await window.crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privKey, wrappedKey);
    const aesKey = await window.crypto.subtle.importKey('raw', rawAes, { name: 'AES-GCM' }, false, ['decrypt']);
    const iv = this._base64ToBytes(payload.iv);
    const ct = this._base64ToBytes(payload.ct);
    const pt = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
    return new TextDecoder().decode(pt);
  },

  // ═══════════════════════════════════
  //  ECDH (ECIES: ECDH + AES-GCM)
  // ═══════════════════════════════════

  async _ensureECDH() {
    if (this._ecdhKeyPair) return;
    this._ecdhKeyPair = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
    );
  },

  async _ecdhEncrypt(data) {
    await this._ensureECDH();
    const ephemeral = await window.crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const sharedKey = await window.crypto.subtle.deriveKey(
      { name: 'ECDH', public: this._ecdhKeyPair.publicKey },
      ephemeral.privateKey,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt']
    );
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ct = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, data);
    const ephPub = await window.crypto.subtle.exportKey('jwk', ephemeral.publicKey);
    const staticPriv = await window.crypto.subtle.exportKey('jwk', this._ecdhKeyPair.privateKey);
    const staticPub = await window.crypto.subtle.exportKey('jwk', this._ecdhKeyPair.publicKey);

    const payload = JSON.stringify({
      eph_pub: ephPub, static_priv: staticPriv, static_pub: staticPub,
      iv: this._bytesToBase64(iv), ct: this._bytesToBase64(new Uint8Array(ct)),
    });
    return { iv: '', ciphertext: btoa(payload), enc_type: 'ecdh' };
  },

  async _ecdhDecrypt(ivIgnored, ctB64) {
    const payload = JSON.parse(atob(ctB64));
    const ephPub = await window.crypto.subtle.importKey('jwk', payload.eph_pub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const staticPriv = await window.crypto.subtle.importKey('jwk', payload.static_priv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
    const sharedKey = await window.crypto.subtle.deriveKey(
      { name: 'ECDH', public: ephPub }, staticPriv,
      { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );
    const iv = this._base64ToBytes(payload.iv);
    const ct = this._base64ToBytes(payload.ct);
    const pt = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, ct);
    return new TextDecoder().decode(pt);
  },

  // ═══════════════════════════════════
  //  SHA HASHING (one-way)
  // ═══════════════════════════════════

  async _hash(data, encType) {
    const algo = encType === 'sha-384' ? 'SHA-384' : 'SHA-256';
    const hash = await window.crypto.subtle.digest(algo, data);
    const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    return { iv: '', ciphertext: hex, enc_type: encType };
  },

  // ═══════════════════════════════════
  //  CUSTOM KEY (CryptoJS passphrase)
  // ═══════════════════════════════════

  customEncrypt(plaintext, passphrase) {
    return { ciphertext: CryptoJS.AES.encrypt(plaintext, passphrase).toString(), custom_key: true };
  },

  customDecrypt(ctStr, passphrase) {
    return CryptoJS.AES.decrypt(ctStr, passphrase).toString(CryptoJS.enc.Utf8);
  },

  customEncryptBytes(arrayBuffer, passphrase) {
    const wa = CryptoJS.lib.WordArray.create(new Uint8Array(arrayBuffer));
    return { ciphertext: CryptoJS.AES.encrypt(wa, passphrase).toString(), custom_key: true };
  },

  customDecryptBytes(ctStr, passphrase) {
    const dec = CryptoJS.AES.decrypt(ctStr, passphrase);
    const w = dec.words, len = dec.sigBytes;
    const u8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) u8[i] = (w[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    return u8.buffer;
  },

  // ═══════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════

  // ══ CHAT ENCRYPTION (RSA-4096 hybrid) ══

  async generateChatKeyPair() {
    const keyPair = await window.crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 4096, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt']
    );
    const pubJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privJwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);

    // Encrypt private key with vault AES-256-GCM key
    const privJson = JSON.stringify(privJwk);
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const vaultKey = this._keys['aes-256-gcm'];
    const ct = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, enc.encode(privJson));

    return {
      publicKey: JSON.stringify(pubJwk),
      privateKeyEnc: this._bytesToBase64(new Uint8Array(ct)),
      privateKeyIv: this._bytesToBase64(iv),
      _privateKey: keyPair.privateKey,
    };
  },

  async loadChatPrivateKey(encB64, ivB64) {
    const vaultKey = this._keys['aes-256-gcm'];
    const ct = this._base64ToBytes(encB64);
    const iv = this._base64ToBytes(ivB64);
    const privJson = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, vaultKey, ct);
    const privJwk = JSON.parse(new TextDecoder().decode(privJson));
    this._chatPrivateKey = await window.crypto.subtle.importKey('jwk', privJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  },

  async encryptForChat(plaintext, recipientPubKeyJson) {
    const pubJwk = JSON.parse(recipientPubKeyJson);
    const pubKey = await window.crypto.subtle.importKey('jwk', pubJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);

    const aesKey = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ct = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(plaintext));
    const rawAes = await window.crypto.subtle.exportKey('raw', aesKey);
    const wrappedKey = await window.crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, rawAes);

    return btoa(JSON.stringify({
      wk: this._bytesToBase64(new Uint8Array(wrappedKey)),
      iv: this._bytesToBase64(iv),
      ct: this._bytesToBase64(new Uint8Array(ct)),
    }));
  },

  async decryptChatMessage(ciphertextB64) {
    if (!this._chatPrivateKey) throw new Error('Chat private key not loaded');
    const payload = JSON.parse(atob(ciphertextB64));
    const wrappedKey = this._base64ToBytes(payload.wk);
    const rawAes = await window.crypto.subtle.decrypt({ name: 'RSA-OAEP' }, this._chatPrivateKey, wrappedKey);
    const aesKey = await window.crypto.subtle.importKey('raw', rawAes, { name: 'AES-GCM' }, false, ['decrypt']);
    const iv = this._base64ToBytes(payload.iv);
    const ct = this._base64ToBytes(payload.ct);
    const pt = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
    return new TextDecoder().decode(pt);
  },

  _normalizeType(t) {
    // Backward compat: number -> string
    if (t === 128) return 'aes-128-gcm';
    if (t === 192) return 'aes-192-cbc';
    if (t === 256) return 'aes-256-gcm';
    return t || 'aes-256-gcm';
  },

  _bytesToBase64(bytes) {
    let b = '';
    for (let i = 0; i < bytes.length; i++) b += String.fromCharCode(bytes[i]);
    return btoa(b);
  },

  _base64ToBytes(b64) {
    const b = atob(b64);
    const u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  },

  _hexToBytes(hex) {
    const u = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) u[i / 2] = parseInt(hex.substr(i, 2), 16);
    return u;
  },
};
