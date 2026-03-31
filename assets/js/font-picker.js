const FONT_PICKER_FONTS = [
  'Abel','Abril Fatface','Alegreya','Alegreya Sans','Alfa Slab One','Amatic SC','Anton',
  'Archivo','Archivo Black','Archivo Narrow','Arimo','Arvo','Asap','Asap Condensed',
  'Assistant','Bangers','Bebas Neue','Bitter','Cabin','Calibri','Cardo','Catamaran',
  'Caveat','Cinzel','Comfortaa','Cormorant','Cormorant Garamond','Courier New',
  'Cousine','Crimson Text','DM Sans','DM Serif Display','DM Serif Text',
  'Dancing Script','Domine','EB Garamond','Encode Sans','Exo','Exo 2',
  'Fira Code','Fira Sans','Fredoka One','Garamond','Georgia','Great Vibes',
  'Heebo','Hind','IBM Plex Mono','IBM Plex Sans','IBM Plex Serif',
  'Inconsolata','Indie Flower','Josefin Sans','Josefin Slab','Karla','Lato',
  'Libre Baskerville','Lobster','Manrope','Merriweather','Montserrat','Mukta',
  'Noto Sans','Noto Serif','Nunito','Open Sans','Oswald','Oxygen','PT Sans',
  'PT Serif','Pacifico','Playfair Display','Poppins','Public Sans','Quicksand',
  'Raleway','Roboto','Roboto Mono','Rubik','Sacramento','Satisfy',
  'Shadows Into Light','Source Code Pro','Source Sans Pro','Source Serif Pro',
  'Space Grotesk','Space Mono','Spectral','Tahoma','Times New Roman','Tinos',
  'Titillium Web','Trebuchet MS','Ubuntu','Ubuntu Mono','Varela Round','Verdana',
  'Vollkorn','Work Sans','Yellowtail','Zilla Slab'
];

const _fpLoaded = new Set();

function _fpLoad(name) {
  if (!name) return;
  const sys = ['Arial','Courier New','Georgia','Times New Roman','Verdana','Helvetica','Tahoma','Trebuchet MS','Calibri','Garamond'];
  if (sys.includes(name) || _fpLoaded.has(name)) return;
  _fpLoaded.add(name);
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+') + ':wght@400;700&display=swap';
  document.head.appendChild(l);
}

// Styles
(function() {
  if (document.getElementById('fp-css')) return;
  const s = document.createElement('style');
  s.id = 'fp-css';
  s.textContent = `
.fp-list {
  position:fixed; display:none;
  max-height:280px;
  overflow-y:scroll;
  background:var(--color-bg,#000);
  border:var(--border,1px solid #fff);
  border-top:var(--border-muted,1px solid #333);
  z-index:9999;
}
.fp-list.open { display:block; }
.fp-list::-webkit-scrollbar { width:6px; }
.fp-list::-webkit-scrollbar-track { background:var(--color-surface,#0a0a0a); }
.fp-list::-webkit-scrollbar-thumb { background:var(--color-text-muted,#666); border-radius:0; }
.fp-list::-webkit-scrollbar-thumb:hover { background:var(--color-text,#fff); }
.fp-row {
  padding:9px 20px 9px 14px; cursor:pointer;
  color:var(--color-text,#fff); display:flex;
  justify-content:space-between; align-items:center;
  font-size:0.95rem;
}
.fp-row:hover { background:#1a1a1a; }
[data-theme="light"] .fp-row:hover { background:#e0e0e0; }
[data-theme="light"] .fp-list { background:var(--color-bg); }
[data-theme="light"] .fp-list::-webkit-scrollbar-track { background:var(--color-surface); }
[data-theme="light"] .fp-list::-webkit-scrollbar-thumb { background:var(--color-text-muted); }
.fp-row .tag {
  font-size:0.6rem; text-transform:uppercase; letter-spacing:0.08em;
  color:var(--color-text-muted,#666); font-family:var(--font-body);
  margin-left:12px; flex-shrink:0;
}
.fp-none { padding:14px; color:var(--color-text-muted,#666); font-size:0.85rem; text-align:center; }
`;
  document.head.appendChild(s);
})();

class FontPicker {
  constructor(inputId, onChange, defaultFont) {
    this.el = document.getElementById(inputId);
    if (!this.el) { console.warn('FontPicker: input not found:', inputId); return; }
    this.cb = onChange || function(){};
    this.def = defaultFont || '';
    this.all = FONT_PICKER_FONTS;
    this.shown = [];
    this.isOpen = false;
    this._hi = -1;
    this._built = false;

    // Add dropdown arrow indicator
    this.el.style.cursor = 'pointer';
    this.el.style.backgroundImage = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%23666' d='M5 7L1 3h8z'/%3E%3C/svg%3E\")";
    this.el.style.backgroundRepeat = 'no-repeat';
    this.el.style.backgroundPosition = 'right 10px center';
    this.el.style.paddingRight = '28px';

    this.el.addEventListener('click', () => this._toggle());
    this.el.addEventListener('input', () => {
      if (!this._built) this._buildList();
      this._showingAll = false;
      this._filter();
      if (!this.isOpen) this._show();
    });
    this.el.addEventListener('keydown', (e) => this._key(e));

    if (this.el.value.trim()) _fpLoad(this.el.value.trim());
  }

  _buildList() {
    if (this._built) return;
    this._built = true;
    this.list = document.createElement('div');
    this.list.className = 'fp-list';
    document.body.appendChild(this.list);

    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('.fp-row');
      if (row) this._pick(row.dataset.font);
    });

    // Prevent mousedown on list from closing dropdown (needed for scrollbar)
    this.list.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    // Capture wheel events on the input when dropdown is open and scroll the list
    this.el.addEventListener('wheel', (e) => {
      if (this.isOpen && this.list) {
        e.preventDefault();
        this.list.scrollTop += e.deltaY;
        this._lazy();
      }
    }, { passive: false });

    // Also ensure wheel on list itself works
    this.list.addEventListener('wheel', (e) => {
      e.stopPropagation();
      this._lazy();
    });

    this.list.addEventListener('scroll', () => this._lazy());

    document.addEventListener('mousedown', (e) => {
      if (this.isOpen && e.target !== this.el && !this.list.contains(e.target)) this._hide();
    });
  }

  _toggle() {
    if (!this._built) this._buildList();
    this.isOpen ? this._hide() : this._show();
  }

  _show() {
    this.isOpen = true;
    this._showingAll = true;
    // Always show full list when opening - user can type to filter
    this.shown = this.def ? [this.def, ...this.all.filter(f => f !== this.def)] : this.all.slice();
    this._hi = -1;
    this._draw();
    const r = this.el.getBoundingClientRect();
    this.list.style.left = r.left + 'px';
    this.list.style.top = r.bottom + 'px';
    this.list.style.width = r.width + 'px';
    this.list.classList.add('open');
    this.list.scrollTop = 0;
    this._lazy();
  }

  _hide() {
    this.isOpen = false;
    this._hi = -1;
    if (this.list) this.list.classList.remove('open');
    this.cb(this.el.value.trim());
  }

  _filter() {
    const q = this.el.value.trim().toLowerCase();
    if (!q) {
      this.shown = this.def ? [this.def, ...this.all.filter(f => f !== this.def)] : this.all.slice();
    } else {
      this.shown = this.all.filter(f => f.toLowerCase().startsWith(q));
    }
    this._hi = -1;
    this._draw();
  }

  _draw() {
    if (!this.list) return;
    if (!this.shown.length) {
      this.list.innerHTML = '<div class="fp-none">No fonts found</div>';
      return;
    }
    let h = '';
    for (let i = 0; i < this.shown.length; i++) {
      const f = this.shown[i];
      const tag = f === this.def ? '<span class="tag">(default)</span>' : '';
      h += '<div class="fp-row" data-font="' + f + '"><span>' + f + '</span>' + tag + '</div>';
    }
    this.list.innerHTML = h;
    requestAnimationFrame(() => this._lazy());
  }

  _key(e) {
    if (!this.isOpen) { if (e.key === 'ArrowDown') { e.preventDefault(); this._toggle(); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); this._mv(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this._mv(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (this._hi >= 0) this._pick(this.shown[this._hi]); }
    else if (e.key === 'Escape') this._hide();
  }

  _mv(d) {
    if (!this.shown.length) return;
    this._hi = Math.max(0, Math.min(this.shown.length - 1, this._hi + d));
    const rows = this.list.querySelectorAll('.fp-row');
    rows.forEach((r, i) => r.classList.toggle('hi', i === this._hi));
    const a = this.list.querySelector('.hi');
    if (a) a.scrollIntoView({ block: 'nearest' });
  }

  _pick(font) {
    this.el.value = font;
    _fpLoad(font);
    this.isOpen = false;
    this._hi = -1;
    if (this.list) this.list.classList.remove('open');
    this.cb(font);
    this.el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  _lazy() {
    if (!this.isOpen || !this.list) return;
    const rect = this.list.getBoundingClientRect();
    this.list.querySelectorAll('.fp-row').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.top < rect.bottom + 80 && r.bottom > rect.top - 80) {
        const f = el.dataset.font;
        if (f) {
          _fpLoad(f);
          el.querySelector('span').style.fontFamily = "'" + f + "', sans-serif";
        }
      }
    });
  }
}
