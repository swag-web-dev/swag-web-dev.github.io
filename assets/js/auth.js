const Auth = {
  _initialized: false,
  init() {
    if (this._initialized) return;
    this._initialized = true;
    const registerBtn = document.getElementById('register-btn');
    const loginBtn = document.getElementById('login-btn');
    const seedInput = document.getElementById('seed-input');
    const seedModal = document.getElementById('seed-modal');
    const seedDisplay = document.getElementById('seed-display');
    const seedCopyBtn = document.getElementById('seed-copy-btn');
    const seedContinueBtn = document.getElementById('seed-continue-btn');
    const loginError = document.getElementById('login-error');

    registerBtn.addEventListener('click', async () => {
      registerBtn.disabled = true;
      registerBtn.textContent = 'GENERATING...';
      try {
        const data = await API.post('api/auth/register', {});
        API.setToken(data.csrf_token);

        // Display seed phrase
        const words = data.seed_phrase.split(' ');
        seedDisplay.innerHTML = words
          .map(
            (w, i) =>
              `<div class="seed-word"><span class="seed-word__num">${i + 1}.</span>${w}</div>`
          )
          .join('');

        seedModal.classList.remove('modal-overlay--hidden');

        // Store seed phrase temporarily for crypto init
        seedModal._seedPhrase = data.seed_phrase;
        seedModal._salt = data.salt;

        seedCopyBtn.onclick = () => {
          navigator.clipboard.writeText(data.seed_phrase);
          seedCopyBtn.textContent = 'COPIED';
          setTimeout(() => (seedCopyBtn.textContent = 'COPY PHRASE'), 2000);
        };

        seedContinueBtn.onclick = async () => {
          try {
            seedContinueBtn.disabled = true;
            seedContinueBtn.textContent = 'LOADING...';
            await Crypto.init(seedModal._seedPhrase, seedModal._salt);
            seedModal.classList.add('modal-overlay--hidden');
            App.showApp();
          } catch (e) {
            console.error('Init failed:', e);
            seedContinueBtn.disabled = false;
            seedContinueBtn.textContent = 'I HAVE SAVED MY PHRASE';
            Toast.show('Failed to initialize: ' + e.message, true);
          }
        };
      } catch (e) {
        loginError.textContent = e.message;
        loginError.style.display = 'block';
      } finally {
        registerBtn.disabled = false;
        registerBtn.textContent = 'CREATE ACCOUNT';
      }
    });

    // Step 1: Check seed phrase
    loginBtn.addEventListener('click', async () => {
      const phrase = seedInput.value.trim();
      if (!phrase) {
        loginError.textContent = 'Enter your seed phrase';
        loginError.style.display = 'block';
        return;
      }

      loginBtn.disabled = true;
      loginBtn.textContent = 'VERIFYING...';
      loginError.style.display = 'none';

      try {
        const data = await API.post('api/auth/login', {
          seed_phrase: phrase,
        });

        if (data.requires_verification) {
          // Show verification step
          document.getElementById('login-step1').style.display = 'none';
          document.getElementById('login-step2').style.display = 'block';
          if (data.needs_pin) {
            document.getElementById('login-pin-group').style.display = 'block';
            document.getElementById('seed-pin').focus();
          }
          if (data.needs_totp) {
            document.getElementById('totp-login-group').style.display = 'block';
            if (!data.needs_pin) document.getElementById('totp-login-input').focus();
          }
          return;
        }

        // No verification needed - log straight in
        API.setToken(data.csrf_token);
        await Crypto.init(phrase, data.salt);
        App.showApp();
      } catch (e) {
        loginError.textContent = e.message;
        loginError.style.display = 'block';
      } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'LOGIN';
      }
    });

    // Step 2: Verify PIN / TOTP
    document.getElementById('login-verify-btn').addEventListener('click', async () => {
      const phrase = seedInput.value.trim();
      const pin = document.getElementById('seed-pin').value.trim();
      const totpToken = document.getElementById('totp-login-input').value.trim();
      const verifyBtn = document.getElementById('login-verify-btn');

      verifyBtn.disabled = true;
      verifyBtn.textContent = 'VERIFYING...';
      loginError.style.display = 'none';

      try {
        const data = await API.post('api/auth/login', {
          seed_phrase: phrase,
          pin: pin || '',
          totp_token: totpToken || '',
        });

        API.setToken(data.csrf_token);
        await Crypto.init(phrase, data.salt);
        App.showApp();
      } catch (e) {
        loginError.textContent = e.message;
        loginError.style.display = 'block';
      } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'VERIFY';
      }
    });

    // Back button - return to step 1
    document.getElementById('login-back-btn').addEventListener('click', () => {
      document.getElementById('login-step1').style.display = 'flex';
      document.getElementById('login-step2').style.display = 'none';
      document.getElementById('login-pin-group').style.display = 'none';
      document.getElementById('totp-login-group').style.display = 'none';
      document.getElementById('seed-pin').value = '';
      document.getElementById('totp-login-input').value = '';
      loginError.style.display = 'none';
    });

    // Allow Enter key in textarea
    seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        loginBtn.click();
      }
    });
  },
};
