const API = {
  csrfToken: null,

  setToken(token) {
    this.csrfToken = token;
  },

  async request(url, options = {}) {
    const headers = options.headers || {};
    if (this.csrfToken && options.method && options.method !== 'GET') {
      headers['X-CSRF-Token'] = this.csrfToken;
    }
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    const res = await fetch('/' + url.replace(/^\//, ''), { ...options, headers });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('Server returned invalid response');
    }
    if (!data.success) {
      throw new Error(data.error || 'Request failed');
    }
    return data.data;
  },

  get(url) {
    return this.request(url);
  },

  post(url, body) {
    return this.request(url, { method: 'POST', body });
  },

  del(url, body) {
    return this.request(url, { method: 'POST', body });
  },
};
