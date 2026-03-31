/**
 * CustomSelect - Replaces a native <select> with a styled dropdown matching the app theme.
 * Always opens downward, searchable, themed scrollbar.
 */
class CustomSelect {
  constructor(selectId) {
    this.sel = document.getElementById(selectId);
    if (!this.sel) return;

    // Read options from the native select
    this.options = [];
    this.sel.querySelectorAll('option').forEach(opt => {
      this.options.push({ value: opt.value, label: opt.textContent, group: opt.closest('optgroup')?.label || '' });
    });

    this.isOpen = false;
    this._value = this.sel.value;

    // Hide native select, create custom UI
    this.sel.style.display = 'none';

    // Create display button
    this.btn = document.createElement('div');
    this.btn.className = 'cs-btn input';
    this.btn.style.cssText = 'cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none;';
    this.btn.innerHTML = '<span class="cs-label"></span><span style="color:var(--color-text-muted);font-size:0.7rem;">&#9660;</span>';
    this.sel.parentNode.insertBefore(this.btn, this.sel.nextSibling);

    // Create dropdown
    this.drop = document.createElement('div');
    this.drop.className = 'cs-drop';
    document.body.appendChild(this.drop);

    this._updateLabel();
    this._bind();
  }

  _bind() {
    this.btn.addEventListener('click', () => this.isOpen ? this._close() : this._open());

    document.addEventListener('mousedown', (e) => {
      if (this.isOpen && !this.btn.contains(e.target) && !this.drop.contains(e.target)) this._close();
    });

    this.drop.addEventListener('mousedown', (e) => e.stopPropagation());

    this.drop.addEventListener('click', (e) => {
      const item = e.target.closest('.cs-item');
      if (item) {
        this._select(item.dataset.value);
      }
    });

    // Wheel on button scrolls dropdown
    this.btn.addEventListener('wheel', (e) => {
      if (this.isOpen) { e.preventDefault(); e.stopPropagation(); this.drop.scrollBy({ top: e.deltaY, behavior: 'smooth' }); }
    }, { passive: false });

    // Wheel on dropdown scrolls it and prevents page scroll
    this.drop.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.drop.scrollBy({ top: e.deltaY, behavior: 'smooth' });
    }, { passive: false });

    // Sync if native select changes programmatically
    const observer = new MutationObserver(() => {
      if (this.sel.value !== this._value) {
        this._value = this.sel.value;
        this._updateLabel();
      }
    });
    observer.observe(this.sel, { attributes: true });

    // Also poll for programmatic changes (MutationObserver doesn't catch .value changes)
    setInterval(() => {
      if (this.sel.value !== this._value) {
        this._value = this.sel.value;
        this._updateLabel();
      }
    }, 500);
  }

  _reposition() {
    if (!this.isOpen) return;
    const r = this.btn.getBoundingClientRect();
    const top = r.bottom + 1;
    this.drop.style.cssText = 'position:fixed;display:block;left:' + r.left + 'px;top:' + top + 'px;width:' + r.width + 'px;max-height:280px;overflow-y:auto;scroll-behavior:smooth;background:var(--color-bg,#000);border:var(--border,1px solid #fff);border-top:var(--border-muted,1px solid #333);z-index:9999;scrollbar-width:thin;scrollbar-color:var(--color-text-muted) var(--color-surface);';
  },

  _open() {
    this.isOpen = true;
    this._render();

    // Position offscreen first, show it, then move into place
    this.drop.style.top = '0px';
    this.drop.style.left = '-9999px';
    this.drop.classList.add('cs-open');

    // Now position correctly
    requestAnimationFrame(() => {
      this._reposition();

      // Scroll to selected item
      const active = this.drop.querySelector('.cs-item.cs-active');
      if (active) active.scrollIntoView({ block: 'center' });
    });

    // Reposition on page scroll
    this._scrollHandler = () => this._reposition();
    window.addEventListener('scroll', this._scrollHandler, true);
  }

  _close() {
    this.isOpen = false;
    if (this._scrollHandler) {
      window.removeEventListener('scroll', this._scrollHandler, true);
      this._scrollHandler = null;
    }
    this.drop.classList.remove('cs-open');
  }

  _render() {
    let html = '';
    let lastGroup = '';
    this.options.forEach(opt => {
      if (opt.group && opt.group !== lastGroup) {
        lastGroup = opt.group;
        html += '<div class="cs-group">' + opt.group + '</div>';
      }
      const active = opt.value === this._value ? ' cs-active' : '';
      html += '<div class="cs-item' + active + '" data-value="' + opt.value + '">' + opt.label + '</div>';
    });
    this.drop.innerHTML = html;
  }

  _select(value) {
    this._value = value;
    this.sel.value = value;
    this.sel.dispatchEvent(new Event('change', { bubbles: true }));
    this._updateLabel();
    this._close();
  }

  _updateLabel() {
    const opt = this.options.find(o => o.value === this.sel.value);
    this.btn.querySelector('.cs-label').textContent = opt ? opt.label : this.sel.value;
  }
}

// Styles
(function() {
  if (document.getElementById('cs-css')) return;
  const s = document.createElement('style');
  s.id = 'cs-css';
  s.textContent = `
.cs-btn {
  min-height: 38px;
}
.cs-drop {
  position: fixed; display: none;
  max-height: 280px; overflow-y: auto;
  scroll-behavior: smooth;
  background: var(--color-bg, #000);
  border: var(--border, 1px solid #fff);
  border-top: var(--border-muted, 1px solid #333);
  z-index: 9999;
  scrollbar-width: thin;
  scrollbar-color: var(--color-text-muted) var(--color-surface);
}
.cs-drop.cs-open { display: block; }
.cs-drop::-webkit-scrollbar { width: 6px; }
.cs-drop::-webkit-scrollbar-track { background: var(--color-surface, #0a0a0a); }
.cs-drop::-webkit-scrollbar-thumb { background: var(--color-text-muted, #666); }
.cs-drop::-webkit-scrollbar-thumb:hover { background: var(--color-text, #fff); }
.cs-group {
  padding: 8px 14px 4px;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted, #666);
  font-weight: 500;
}
.cs-item {
  padding: 8px 14px;
  cursor: pointer;
  font-size: 0.9rem;
  color: var(--color-text, #fff);
}
.cs-item:hover { background: #1a1a1a; }
.cs-item.cs-active { background: var(--color-accent, #fff); color: var(--color-bg, #000); }
[data-theme="light"] .cs-item:hover { background: #e0e0e0; }
[data-theme="light"] .cs-drop { background: var(--color-bg); }
`;
  document.head.appendChild(s);
})();
