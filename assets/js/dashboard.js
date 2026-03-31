const Dashboard = {
  init() {
    this.load();
  },

  async load() {
    try {
      const profile = await API.get('api/settings/get');

      // Greeting
      const name = profile.display_name || 'Anonymous';
      const hour = new Date().getHours();
      let greeting = 'Good evening';
      if (hour < 12) greeting = 'Good morning';
      else if (hour < 18) greeting = 'Good afternoon';
      document.getElementById('dash-greeting').textContent = greeting + ', ' + name;

      // Stats
      const texts = profile.stats?.texts || 0;
      const images = profile.stats?.images || 0;
      const stegano = profile.stats?.stegano || 0;

      document.getElementById('dash-stat-texts').textContent = texts;
      document.getElementById('dash-stat-images').textContent = images;
      document.getElementById('dash-stat-stegano').textContent = stegano;
      document.getElementById('dash-total-items').textContent = texts + images + stegano;

      // Account age
      if (profile.created_at) {
        const created = new Date(profile.created_at);
        const now = new Date();
        const days = Math.floor((now - created) / (1000 * 60 * 60 * 24));
        let ageStr = 'Today';
        if (days === 1) ageStr = '1 day';
        else if (days < 30) ageStr = days + 'd';
        else if (days < 365) ageStr = Math.floor(days / 30) + 'mo';
        else ageStr = Math.floor(days / 365) + 'y';
        document.getElementById('dash-account-age').textContent = ageStr;
      }

      // Recent activity
      await this.loadRecent();
    } catch (e) {
      // Silently fail
    }
  },

  async loadRecent() {
    const recentEl = document.getElementById('dash-recent');
    const emptyEl = document.getElementById('dash-recent-empty');

    try {
      const [texts, images, stegImages] = await Promise.all([
        API.get('api/text/list'),
        API.get('api/image/list'),
        API.get('api/stegano/list'),
      ]);

      const all = [
        ...texts.map((t) => ({ ...t, kind: 'text', icon: '&#9998;' })),
        ...images.map((t) => ({ ...t, kind: 'image', icon: '&#9638;' })),
        ...stegImages.map((t) => ({ ...t, kind: 'stegano', icon: '&#9673;' })),
      ];

      all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const recent = all.slice(0, 8);

      if (recent.length === 0) {
        recentEl.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
      }

      emptyEl.style.display = 'none';
      recentEl.innerHTML = recent
        .map(
          (item) => `
        <div class="item" onclick="Dashboard.viewItem('${item.kind}','${item.id}')">
          <div class="item__info">
            <div class="item__title">${item.icon} ${this._esc(item.label)}</div>
            <div class="item__meta">${this._typeLabel(item.kind)} &middot; ${this._formatDate(item.created_at)}</div>
          </div>
          <div class="item__actions">
            <span style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.08em;">View &rarr;</span>
          </div>
        </div>
      `
        )
        .join('');
    } catch (e) {
      recentEl.innerHTML = '';
      emptyEl.style.display = 'block';
    }
  },

  viewItem(kind, id) {
    if (kind === 'text') {
      TextTab.viewItem(id);
    } else if (kind === 'image') {
      ImageTab.viewEncrypted(id);
    } else if (kind === 'stegano') {
      SteganoTab.downloadSaved(id);
    }
  },

  _typeLabel(type) {
    const labels = { text: 'Text', image: 'Image', stegano: 'Stegano' };
    return labels[type] || type;
  },

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  _formatDate(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString();
  },
};
