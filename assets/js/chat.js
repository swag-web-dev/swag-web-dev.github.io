// ── CHAT MODULE ──

(function() {
  // Inject chat styles
  const style = document.createElement('style');
  style.textContent = `
    .chat-msg {
      max-width: 70%;
      padding: 10px 14px;
      margin-bottom: 8px;
      font-size: 0.85rem;
      line-height: 1.4;
      word-break: break-word;
    }
    .chat-msg--me {
      margin-left: auto;
      background: #1a1a1a;
      color: var(--color-text, #fff);
      border: var(--border, 1px solid #fff);
    }
    .chat-msg--them {
      margin-right: auto;
      background: var(--color-surface, #0a0a0a);
      color: var(--color-text, #fff);
      border: var(--border-muted, 1px solid #333);
    }
    [data-theme="light"] .chat-msg--me {
      background: #e8e8e8;
      color: #000;
      border-color: #000;
    }
    [data-theme="light"] .chat-msg--them {
      background: #f5f5f5;
      color: #000;
    }
    .chat-msg__time {
      font-size: 0.65rem;
      opacity: 0.6;
      margin-top: 4px;
    }
    .chat-msg--me .chat-msg__time { text-align: right; }
    .chat-msg--them .chat-msg__time { text-align: left; }

    .chat-conv-item {
      padding: 12px 16px;
      cursor: pointer;
      border-bottom: var(--border-muted, 1px solid #333);
      transition: background 0.15s;
    }
    .chat-conv-item:hover {
      background: var(--color-surface-hover, rgba(255,255,255,0.05));
    }
    .chat-conv-item--active {
      background: var(--color-surface-hover, rgba(255,255,255,0.08));
    }
    .chat-conv-item__name {
      font-weight: 500;
      font-size: 0.85rem;
    }
    .chat-conv-item__uid {
      font-size: 0.7rem;
      color: var(--color-text-muted, #888);
    }
    .chat-conv-item__time {
      font-size: 0.65rem;
      color: var(--color-text-muted, #888);
      margin-top: 2px;
    }

    .chat-search-result {
      padding: 10px 16px;
      cursor: pointer;
      border-bottom: var(--border-muted, 1px solid #333);
      font-size: 0.8rem;
    }
    .chat-search-result:hover {
      background: var(--color-surface-hover, rgba(255,255,255,0.05));
    }
    .chat-search-result__name {
      font-weight: 500;
    }
    .chat-search-result__uid {
      font-size: 0.7rem;
      color: var(--color-text-muted, #888);
    }
    .chat-search-result__no-keys {
      font-size: 0.65rem;
      color: var(--color-error, #e74c3c);
    }
    #chat-search-results {
      position: absolute;
      z-index: 10;
      left: 16px;
      right: 16px;
      background: var(--color-bg, #0f0f23);
      border: var(--border, 1px solid #444);
      max-height: 200px;
      overflow-y: auto;
    }
  `;
  document.head.appendChild(style);
})();

const Chat = {
  _conversations: [],
  _messages: {},
  _activeConvId: null,
  _activeConvMeta: null,
  _pollTimer: null,
  _searchTimer: null,
  _myUserId: null,
  _myPublicKey: null,
  _initialized: false,

  async init() {
    if (this._initialized) return;
    this._initialized = true;

    try {
      // Pre-fetch user ID
      const settingsData = await API.get('api/settings/get');
      if (settingsData && settingsData.user_id) this._myUserId = settingsData.user_id;

      // Get current user's chat keys
      const keys = await API.get('api/chat/keys/get');
      if (keys.chat_public_key && keys.chat_private_key_enc && keys.chat_private_key_iv) {
        // Keys exist, load private key
        this._myPublicKey = keys.chat_public_key;
        await Crypto.loadChatPrivateKey(keys.chat_private_key_enc, keys.chat_private_key_iv);
      } else {
        // Generate new keypair
        const kp = await Crypto.generateChatKeyPair();
        await API.post('api/chat/keys/save', {
          public_key: kp.publicKey,
          private_key_enc: kp.privateKeyEnc,
          private_key_iv: kp.privateKeyIv,
        });
        this._myPublicKey = kp.publicKey;
        // Private key is already in memory from generation
        Crypto._chatPrivateKey = kp._privateKey;
      }
    } catch (e) {
      console.error('Chat init error:', e);
    }

    // Set up event listeners
    const searchInput = document.getElementById('chat-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => this.searchUsers(searchInput.value.trim()), 300);
      });
      searchInput.addEventListener('blur', () => {
        setTimeout(() => {
          const results = document.getElementById('chat-search-results');
          if (results) results.style.display = 'none';
        }, 200);
      });
    }

    const sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) sendBtn.addEventListener('click', () => this.sendMessage());

    const msgInput = document.getElementById('chat-message-input');
    if (msgInput) {
      msgInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
    }
  },

  async open() {
    await this.loadConversations();
    this._startPolling();
  },

  async searchUsers(query) {
    const results = document.getElementById('chat-search-results');
    if (!results) return;
    if (!query) {
      results.style.display = 'none';
      return;
    }
    try {
      const users = await API.get('api/chat/search?q=' + encodeURIComponent(query));
      if (!users || users.length === 0) {
        results.innerHTML = '<div style="padding:10px 16px;font-size:0.8rem;color:var(--color-text-muted);">No users found</div>';
      } else {
        results.innerHTML = users.map(u => `
          <div class="chat-search-result" onclick="Chat.startConversation('${this._esc(u.unique_id)}')">
            <div class="chat-search-result__name">${this._esc(u.display_name)}</div>
            <div class="chat-search-result__uid">@${this._esc(u.unique_id)}</div>
            ${!u.has_chat ? '<div class="chat-search-result__no-keys">No chat keys</div>' : ''}
          </div>
        `).join('');
      }
      results.style.display = 'block';
    } catch (e) {
      results.style.display = 'none';
    }
  },

  async startConversation(uniqueId) {
    const results = document.getElementById('chat-search-results');
    if (results) results.style.display = 'none';
    const searchInput = document.getElementById('chat-search');
    if (searchInput) searchInput.value = '';

    try {
      const data = await API.post('api/chat/conversations/start', { unique_id: uniqueId });
      this._activeConvId = data.conversation_id;
      this._activeConvMeta = {
        id: data.conversation_id,
        otherPublicKey: data.other_public_key,
        myPublicKey: data.my_public_key,
        user1_id: data.user1_id,
        user2_id: data.user2_id,
      };

      // Determine my user id from the conversation
      if (!this._myUserId) {
        // If I'm user1, my key matches my_public_key
        this._myUserId = (this._myPublicKey === data.my_public_key)
          ? (data.user1_id === data.user2_id ? data.user1_id : null)
          : null;
        // Actually we need to figure out which one we are
        // user1 and user2 are sorted, so let's just check from conversations list or use the endpoint
      }

      await this.loadConversations();
      await this.loadMessages(data.conversation_id);
      this._showInputArea(true);
    } catch (e) {
      Toast.show(e.message || 'Failed to start conversation', true);
    }
  },

  async loadConversations() {
    try {
      const convs = await API.get('api/chat/conversations');
      this._conversations = convs || [];
      this.renderConversations();
    } catch (e) {
      console.error('Failed to load conversations:', e);
    }
  },

  async loadMessages(convId) {
    if (!convId) return;
    try {
      const after = this._getLastTimestamp(convId);
      let url = 'api/chat/messages?conversation_id=' + encodeURIComponent(convId);
      if (after) url += '&after=' + encodeURIComponent(after);

      const msgs = await API.get(url);
      if (!this._messages[convId]) this._messages[convId] = [];

      if (msgs && msgs.length > 0) {
        // Deduplicate
        const existingIds = new Set(this._messages[convId].map(m => m.id));
        for (const msg of msgs) {
          if (!existingIds.has(msg.id)) {
            // Determine which ciphertext to decrypt
            try {
              // Try to figure out if I'm user1 or user2
              const conv = this._activeConvMeta;
              let myCiphertext;
              if (conv) {
                // I need to decrypt based on whether I'm user1 or user2
                // We can detect this by trying to decrypt user1 ciphertext first
                myCiphertext = await this._decryptMyMessage(msg, convId);
              } else {
                myCiphertext = await this._decryptMyMessage(msg, convId);
              }
              msg._plaintext = myCiphertext;
            } catch (e) {
              msg._plaintext = '[Decryption failed]';
            }
            this._messages[convId].push(msg);
          }
        }
      }

      this.renderMessages(convId);
    } catch (e) {
      console.error('Failed to load messages:', e);
    }
  },

  async _decryptMyMessage(msg, convId) {
    // Always try both columns - try user1 first, if fails try user2
    try {
      return await Crypto.decryptChatMessage(msg.ciphertext_user1);
    } catch (e1) {
      try {
        return await Crypto.decryptChatMessage(msg.ciphertext_user2);
      } catch (e2) {
        return '[Unable to decrypt]';
      }
    }
  },

  async _amIUser1(user1_id, user2_id) {
    // We can figure this out by checking if _myUserId matches
    if (this._myUserId) return this._myUserId === user1_id;

    // Try decrypting a test or use the settings endpoint
    try {
      const settings = await API.get('api/settings/get');
      this._myUserId = settings.user_id;
      return this._myUserId === user1_id;
    } catch (e) {
      return true; // fallback
    }
  },

  async sendMessage() {
    const input = document.getElementById('chat-message-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text || !this._activeConvId || !this._activeConvMeta) return;

    const meta = this._activeConvMeta;
    if (!meta.otherPublicKey) {
      Toast.show('Other user has no chat keys yet', true);
      return;
    }
    if (!this._myPublicKey) {
      Toast.show('Your chat keys are not ready', true);
      return;
    }

    try {
      // Determine which public key belongs to user1 and user2
      const amUser1 = await this._amIUser1(meta.user1_id, meta.user2_id);
      const user1PubKey = amUser1 ? this._myPublicKey : meta.otherPublicKey;
      const user2PubKey = amUser1 ? meta.otherPublicKey : this._myPublicKey;

      const ciphertext_user1 = await Crypto.encryptForChat(text, user1PubKey);
      const ciphertext_user2 = await Crypto.encryptForChat(text, user2PubKey);

      const result = await API.post('api/chat/messages/send', {
        conversation_id: this._activeConvId,
        ciphertext_user1,
        ciphertext_user2,
      });

      // Add to local messages
      if (!this._messages[this._activeConvId]) this._messages[this._activeConvId] = [];
      this._messages[this._activeConvId].push({
        id: result.id,
        conversation_id: this._activeConvId,
        sender_id: this._myUserId || '__me__',
        ciphertext_user1,
        ciphertext_user2,
        created_at: result.created_at,
        _plaintext: text,
        _isMine: true,
      });

      input.value = '';
      this.renderMessages(this._activeConvId);
    } catch (e) {
      Toast.show(e.message || 'Failed to send message', true);
    }
  },

  _startPolling() {
    this._stopPolling();
    this._pollTimer = setInterval(() => {
      if (this._activeConvId) {
        this.loadMessages(this._activeConvId);
      }
      // Also refresh conversation list
      this.loadConversations();
    }, 5000);
  },

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  _getLastTimestamp(convId) {
    const msgs = this._messages[convId];
    if (!msgs || msgs.length === 0) return null;
    return msgs[msgs.length - 1].created_at;
  },

  renderConversations() {
    const list = document.getElementById('chat-conv-list');
    if (!list) return;

    if (this._conversations.length === 0) {
      list.innerHTML = '<div style="padding:24px 16px;text-align:center;font-size:0.8rem;color:var(--color-text-muted);">No conversations yet.<br>Search for a user above.</div>';
      return;
    }

    const requests = this._conversations.filter(c => c.is_request);
    const pending = this._conversations.filter(c => c.is_pending);
    const accepted = this._conversations.filter(c => c.status === 'accepted');

    let html = '';

    if (requests.length > 0) {
      html += '<div style="padding:8px 16px;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-text-muted);border-bottom:var(--border-muted);">Requests (' + requests.length + ')</div>';
      html += requests.map(c => `
        <div class="chat-conv-item" style="background:rgba(255,255,255,0.03);cursor:pointer;" onclick="Chat._openRequest('${this._esc(c.id)}', '${this._esc(c.other_user_uid)}')">
          <div class="chat-conv-item__name">${this._esc(c.other_user_name || 'Unknown')}</div>
          <div class="chat-conv-item__uid">@${this._esc(c.other_user_uid || '???')}</div>
          <div style="display:flex;gap:4px;margin-top:8px;">
            <button class="btn btn--small btn--primary" style="font-size:0.65rem;padding:3px 8px;" onclick="event.stopPropagation();Chat.acceptRequest('${this._esc(c.id)}')">ACCEPT</button>
            <button class="btn btn--small" style="font-size:0.65rem;padding:3px 8px;" onclick="event.stopPropagation();Chat.denyRequest('${this._esc(c.id)}')">DENY</button>
            <button class="btn btn--small btn--danger" style="font-size:0.65rem;padding:3px 8px;" onclick="event.stopPropagation();Chat.blockUser('${this._esc(c.id)}')">BLOCK</button>
          </div>
        </div>
      `).join('');
    }

    if (pending.length > 0) {
      html += '<div style="padding:8px 16px;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-text-muted);border-bottom:var(--border-muted);">Pending</div>';
      html += pending.map(c => `
        <div class="chat-conv-item ${c.id === this._activeConvId ? 'chat-conv-item--active' : ''}" onclick="Chat._openConversation('${this._esc(c.id)}', '${this._esc(c.other_user_uid)}')">
          <div class="chat-conv-item__name">${this._esc(c.other_user_name || 'Unknown')}</div>
          <div class="chat-conv-item__uid">@${this._esc(c.other_user_uid || '???')}</div>
          <div class="chat-conv-item__time" style="color:#ff9f4a;">Waiting for response</div>
        </div>
      `).join('');
    }

    if (accepted.length > 0) {
      if (requests.length > 0 || pending.length > 0) {
        html += '<div style="padding:8px 16px;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-text-muted);border-bottom:var(--border-muted);">Messages</div>';
      }
      html += accepted.map(c => `
        <div class="chat-conv-item ${c.id === this._activeConvId ? 'chat-conv-item--active' : ''}" onclick="Chat._openConversation('${this._esc(c.id)}', '${this._esc(c.other_user_uid)}')">
          <div class="chat-conv-item__name">${this._esc(c.other_user_name || 'Unknown')}</div>
          <div class="chat-conv-item__uid">@${this._esc(c.other_user_uid || '???')}</div>
          <div class="chat-conv-item__time">${this._formatTime(c.last_message_at)}</div>
        </div>
      `).join('');
    }

    list.innerHTML = html || '<div style="padding:24px 16px;text-align:center;font-size:0.8rem;color:var(--color-text-muted);">No conversations yet.</div>';
  },

  async _openRequest(convId, otherUid) {
    // Load conversation meta so we can decrypt messages
    try {
      const data = await API.post('api/chat/conversations/start', { unique_id: otherUid });
      this._activeConvMeta = {
        id: data.conversation_id,
        otherPublicKey: data.other_public_key,
        myPublicKey: data.my_public_key,
        user1_id: data.user1_id,
        user2_id: data.user2_id,
      };
      this._activeConvId = data.conversation_id;
      await this.loadMessages(data.conversation_id);
    } catch (e) {
      // If start fails (e.g. blocked), just show the conv without messages
      this._activeConvId = convId;
    }

    const conv = this._conversations.find(c => c.id === convId);
    this._showInputArea(false);
    if (conv) {
      document.getElementById('chat-header').innerHTML =
        this._esc(conv.other_user_name) + ' <span style="font-size:0.75rem;color:#ff9f4a;margin-left:8px;">Request - accept to reply</span>';
    }
    this.renderConversations();
  },

  async acceptRequest(convId) {
    try {
      await API.post('api/chat/conversations/accept', { conversation_id: convId });
      Toast.show('Request accepted');
      await this.loadConversations();
      this.renderConversations();
    } catch (e) {
      Toast.show('Failed: ' + e.message, true);
    }
  },

  async denyRequest(convId) {
    if (!await confirmAction('Deny this message request?', 'Deny')) return;
    try {
      await API.post('api/chat/conversations/deny', { conversation_id: convId });
      Toast.show('Request denied');
      if (this._activeConvId === convId) {
        this._activeConvId = null;
        document.getElementById('chat-messages').innerHTML = '';
        document.getElementById('chat-header').textContent = 'Select a conversation';
        this._showInputArea(false);
      }
      await this.loadConversations();
      this.renderConversations();
    } catch (e) {
      Toast.show('Failed: ' + e.message, true);
    }
  },

  async blockUser(convId) {
    if (!await confirmAction('Block this user? They will not be able to message you again.', 'Block User')) return;
    try {
      await API.post('api/chat/conversations/block', { conversation_id: convId });
      Toast.show('User blocked');
      if (this._activeConvId === convId) {
        this._activeConvId = null;
        document.getElementById('chat-messages').innerHTML = '';
        document.getElementById('chat-header').textContent = 'Select a conversation';
        this._showInputArea(false);
      }
      await this.loadConversations();
      this.renderConversations();
    } catch (e) {
      Toast.show('Failed: ' + e.message, true);
    }
  },

  async _openConversation(convId, otherUid) {
    if (!this._activeConvMeta || this._activeConvMeta.id !== convId) {
      await this.startConversation(otherUid);
    } else {
      this._activeConvId = convId;
      await this.loadMessages(convId);
    }
    // Show/hide input based on status
    const conv = this._conversations.find(c => c.id === this._activeConvId);
    if (conv && conv.is_request) {
      this._showInputArea(false);
      document.getElementById('chat-header').innerHTML = this._esc(conv.other_user_name) + ' <span style="font-size:0.75rem;color:#ff9f4a;margin-left:8px;">Request - accept to reply</span>';
    } else if (conv && conv.is_pending) {
      this._showInputArea(true);
    } else {
      this._showInputArea(true);
    }
    this.renderConversations();
  },

  renderMessages(convId) {
    const container = document.getElementById('chat-messages');
    const header = document.getElementById('chat-header');
    if (!container) return;

    if (convId !== this._activeConvId) return;

    // Update header
    const conv = this._conversations.find(c => c.id === convId);
    if (header && conv) {
      header.textContent = (conv.other_user_name || 'Unknown') + ' (@' + (conv.other_user_uid || '') + ')';
    }

    const msgs = this._messages[convId] || [];
    if (msgs.length === 0) {
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--color-text-muted);font-size:0.85rem;">No messages yet. Say hello!</div>';
      return;
    }

    container.innerHTML = msgs.map(m => {
      const isMine = m._isMine || (this._myUserId && m.sender_id === this._myUserId);
      const cls = isMine ? 'chat-msg chat-msg--me' : 'chat-msg chat-msg--them';
      const text = m._plaintext || '[Unable to decrypt]';
      return `<div class="${cls}">
        <div>${this._esc(text)}</div>
        <div class="chat-msg__time">${this._formatTime(m.created_at)}</div>
      </div>`;
    }).join('');

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  },

  _showInputArea(show) {
    const area = document.getElementById('chat-input-area');
    if (area) area.style.display = show ? 'block' : 'none';
  },

  _formatTime(iso) {
    if (!iso) return '';
    try {
      if (typeof Settings !== 'undefined' && Settings.formatDate) {
        return Settings.formatDate(iso);
      }
    } catch (e) {}
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  },

  destroy() {
    this._stopPolling();
    this._conversations = [];
    this._messages = {};
    this._activeConvId = null;
    this._activeConvMeta = null;
    this._myUserId = null;
    this._myPublicKey = null;
    this._initialized = false;
  },
};
