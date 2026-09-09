// Floating Custom Swatches Panel UI Component
// Allows artists to create, pick, manage, and persist custom palette swatches.
// Features: draggable floating window, collapsible body, preset palettes,
// sampling colors from active sprite layers, and localStorage persistence.

const PRESETS = {
  'studio': {
    name: 'DCC Studio (15)',
    colors: [
      '#0f172a', '#334155', '#64748b', '#94a3b8', '#ffffff',
      '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6',
      '#6366f1', '#8b5cf6', '#ec4899', '#78350f', '#d97706'
    ]
  },
  'pico8': {
    name: 'PICO-8 (16)',
    colors: [
      '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f',
      '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436',
      '#29adff', '#83769c', '#ff77a8', '#ffccaa'
    ]
  },
  'gameboy': {
    name: 'Game Boy (4)',
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f']
  },
  'nes': {
    name: 'NES Classic (16)',
    colors: [
      '#000000', '#7c7c7c', '#bcbcbc', '#ffffff', '#002688', '#0070ec',
      '#3cbcfc', '#88fcfc', '#680070', '#b00088', '#e40058', '#f87858',
      '#983800', '#d88000', '#f8b800', '#f8f878'
    ]
  },
  'endesga32': {
    name: 'Endesga 32 (32)',
    colors: [
      '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39',
      '#3e2731', '#a22633', '#e43b44', '#f77622', '#feae34', '#fee761',
      '#63c74d', '#3e8948', '#265c42', '#193c3e', '#124e89', '#0099db',
      '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
      '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a',
      '#e8b796', '#c28569'
    ]
  },
  'cyberpunk': {
    name: 'Cyberpunk Neon (12)',
    colors: [
      '#050505', '#1a1921', '#ff0055', '#ff5400', '#ffbd00', '#00f0ff',
      '#7000ff', '#ff00aa', '#00ff66', '#ffffff', '#2c2d3f', '#e0e6ed'
    ]
  }
};

export class SwatchesPanel {
  constructor(options = {}) {
    this.viewport = options.viewport;
    this.project = options.project;
    this.engine = options.engine;
    this.onColorSelect = options.onColorSelect || (() => {});
    this.onToggleVisibility = options.onToggleVisibility || (() => {});

    // Load saved swatches or fallback to default studio palette
    this.swatches = this.loadSwatches();
    this.userPresets = this.loadUserPresets();
    this.selectedPresetKey = Object.keys(this.userPresets)[0] || 'studio';
    this.isSavingPreset = false;
    this.activeColorHex = '#00a8e8';
    this.isCollapsed = false;
    this.isVisible = true;

    this.initDOM();
    this.restorePosition();
    this.render();
  }

  setProject(project, engine) {
    this.project = project;
    if (engine) this.engine = engine;
  }

  loadUserPresets() {
    try {
      const saved = localStorage.getItem('sms_user_presets');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to parse user presets:', e);
    }
    return {};
  }

  saveUserPresets() {
    try {
      localStorage.setItem('sms_user_presets', JSON.stringify(this.userPresets));
    } catch (e) {
      console.warn('Failed to save user presets:', e);
    }
  }

  saveCurrentAsPreset(name) {
    if (!name || !name.trim()) return;
    if (this.swatches.length === 0) {
      alert('Cannot save an empty palette. Add some colors first.');
      return;
    }
    const id = `user_${Date.now()}`;
    this.userPresets[id] = {
      name: name.trim(),
      colors: [...this.swatches]
    };
    this.saveUserPresets();
    this.selectedPresetKey = id;
    this.isSavingPreset = false;
    this.render();
  }

  deleteUserPreset(id) {
    const preset = this.userPresets[id];
    if (!preset) return;
    if (confirm(`Delete custom preset "${preset.name}"?`)) {
      delete this.userPresets[id];
      this.saveUserPresets();
      this.selectedPresetKey = Object.keys(this.userPresets)[0] || 'studio';
      this.render();
    }
  }

  loadSwatches() {
    try {
      const saved = localStorage.getItem('sms_custom_swatches');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(c => this.normalizeHex(c));
        }
      }
    } catch (e) {
      console.warn('Failed to parse saved swatches:', e);
    }
    return [...PRESETS.studio.colors];
  }

  saveSwatches() {
    try {
      localStorage.setItem('sms_custom_swatches', JSON.stringify(this.swatches));
    } catch (e) {
      console.warn('Failed to save custom swatches:', e);
    }
  }

  normalizeHex(hex) {
    if (!hex) return '#000000';
    let clean = hex.trim().toLowerCase();
    if (!clean.startsWith('#')) clean = '#' + clean;
    if (clean.length === 4) {
      // expand #rgb to #rrggbb
      clean = '#' + clean[1] + clean[1] + clean[2] + clean[2] + clean[3] + clean[3];
    }
    return clean;
  }

  initDOM() {
    // Floating Window Container
    this.panelEl = document.createElement('div');
    this.panelEl.id = 'floating-swatches-panel';
    this.panelEl.className = 'dcc-floating-panel';

    document.body.appendChild(this.panelEl);
    this.setupDragging();
  }

  setupDragging() {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const onPointerDown = (e) => {
      // Don't drag if clicking buttons or inputs inside header
      if (e.target.closest('button') || e.target.closest('input')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.panelEl.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      this.panelEl.classList.add('is-dragging');
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      e.preventDefault();
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      // Screen boundary clamp
      const pad = 8;
      const maxLeft = window.innerWidth - this.panelEl.offsetWidth - pad;
      const maxTop = window.innerHeight - this.panelEl.offsetHeight - pad;

      newLeft = Math.max(pad, Math.min(newLeft, maxLeft));
      newTop = Math.max(pad, Math.min(newTop, maxTop));

      this.panelEl.style.left = `${newLeft}px`;
      this.panelEl.style.top = `${newTop}px`;
      this.panelEl.style.right = 'auto';
      this.panelEl.style.bottom = 'auto';
    };

    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      this.panelEl.classList.remove('is-dragging');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      // Save position
      try {
        const rect = this.panelEl.getBoundingClientRect();
        localStorage.setItem('sms_swatches_pos', JSON.stringify({
          left: rect.left,
          top: rect.top
        }));
      } catch (e) {}
    };

    this.headerEl = document.createElement('div');
    this.headerEl.className = 'dcc-floating-header';
    this.headerEl.addEventListener('pointerdown', onPointerDown);
    this.panelEl.appendChild(this.headerEl);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'dcc-floating-body';
    this.panelEl.appendChild(this.bodyEl);
  }

  restorePosition() {
    try {
      const savedPos = localStorage.getItem('sms_swatches_pos');
      if (savedPos) {
        const { left, top } = JSON.parse(savedPos);
        const pad = 10;
        const validLeft = Math.max(pad, Math.min(left, window.innerWidth - 240));
        const validTop = Math.max(pad, Math.min(top, window.innerHeight - 150));
        this.panelEl.style.left = `${validLeft}px`;
        this.panelEl.style.top = `${validTop}px`;
        return;
      }
    } catch (e) {}

    // Default position: top right above canvas
    this.panelEl.style.left = 'calc(100vw - 320px)';
    this.panelEl.style.top = '72px';
  }

  render() {
    this.renderHeader();
    this.renderBody();
  }

  renderHeader() {
    this.headerEl.innerHTML = `
      <div class="flex items-center gap-1.5 flex-1 min-w-0 pointer-events-none">
        <svg class="w-3.5 h-3.5 text-[#00a8e8] fill-current flex-shrink-0" viewBox="0 0 24 24">
          <path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 18.2c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0l.59-.59C7.93 20.26 9.88 21 12 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-5 9c-.83 0-1.5-.67-1.5-1.5S6.17 9 7 9s1.5.67 1.5 1.5S7.83 12 7 12zm3-4c-.83 0-1.5-.67-1.5-1.5S9.17 5 10 5s1.5.67 1.5 1.5S10.83 8 10 8zm4 0c-.83 0-1.5-.67-1.5-1.5S13.17 5 14 5s1.5.67 1.5 1.5S14.83 8 14 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.17 9 17 9s1.5.67 1.5 1.5S17.83 12 17 12z"/>
        </svg>
        <span class="font-semibold text-[11px] text-[#d4d4d4] tracking-wide">Custom Swatches</span>
        <span class="text-[9px] px-1 py-0.2 rounded-[1px] bg-[#1a1a1a] text-[#00a8e8] font-mono border border-[#333333]">${this.swatches.length}</span>
      </div>
      <div class="flex items-center gap-0.5 pointer-events-auto">
        <button id="btn-swatch-collapse" class="dcc-tool-btn !w-4 !h-4" title="${this.isCollapsed ? 'Expand' : 'Collapse'}">
          <svg class="w-2.5 h-2.5 fill-current text-[#8c8c8c]" viewBox="0 0 24 24">
            ${this.isCollapsed 
              ? '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>' 
              : '<path d="M19 13H5v-2h14v2z"/>'}
          </svg>
        </button>
        <button id="btn-swatch-close" class="dcc-tool-btn !w-4 !h-4 text-[#8c8c8c] hover:text-white" title="Close Panel (P)">
          <svg class="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
    `;

    this.headerEl.querySelector('#btn-swatch-collapse').onclick = () => this.toggleCollapse();
    this.headerEl.querySelector('#btn-swatch-close').onclick = () => this.hide();
  }

  renderBody() {
    if (this.isCollapsed) {
      this.bodyEl.style.display = 'none';
      return;
    }
    this.bodyEl.style.display = 'block';
    this.bodyEl.innerHTML = '';

    // 1. Quick Add Bar (Current Color + Color Picker + Hex Input)
    const addBar = document.createElement('div');
    addBar.className = 'flex items-center justify-between gap-1.5 p-2 bg-[#202020] border-b border-[#333333]';
    addBar.innerHTML = `
      <!-- Left: Add Current Color -->
      <button id="btn-add-current-color" class="dcc-btn dcc-btn-primary !h-5 !px-2 text-[10px] font-semibold flex items-center gap-1" title="Add currently active color to swatches">
        <span class="w-2.5 h-2.5 rounded-full border border-white/40 shadow-sm" style="background-color: ${this.activeColorHex};"></span>
        <span>+ Add Current</span>
      </button>

      <!-- Right: Custom Hex & Picker -->
      <div class="flex items-center gap-1">
        <label class="relative cursor-pointer w-5 h-5 flex items-center justify-center rounded-[2px] bg-[#181818] border border-[#3c3c3c] hover:border-[#00a8e8] transition" title="Pick color to add">
          <span id="custom-picker-preview" class="w-3.5 h-3.5 rounded-[1px] border border-white/20" style="background-color: ${this.activeColorHex};"></span>
          <input type="color" id="input-swatch-picker" value="${this.activeColorHex}" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
        </label>
        <input type="text" id="input-swatch-hex" value="${this.activeColorHex.toUpperCase()}" maxlength="7" class="w-16 !h-5 !py-0 !px-1 font-mono text-[10px] uppercase bg-[#181818] text-[#d4d4d4] border border-[#383838] rounded-[2px] text-center" title="Hex code (#RRGGBB)" />
        <button id="btn-add-custom-hex" class="dcc-btn !h-5 !px-1.5 text-[10px]" title="Add this hex color">
          Add
        </button>
      </div>
    `;

    const btnAddCurrent = addBar.querySelector('#btn-add-current-color');
    const inputPicker = addBar.querySelector('#input-swatch-picker');
    const pickerPreview = addBar.querySelector('#custom-picker-preview');
    const inputHex = addBar.querySelector('#input-swatch-hex');
    const btnAddCustom = addBar.querySelector('#btn-add-custom-hex');

    btnAddCurrent.onclick = () => {
      this.addSwatch(this.activeColorHex);
    };

    inputPicker.oninput = (e) => {
      const val = e.target.value.toLowerCase();
      pickerPreview.style.backgroundColor = val;
      inputHex.value = val.toUpperCase();
    };

    inputHex.onchange = (e) => {
      let val = this.normalizeHex(e.target.value);
      if (/^#[0-9a-f]{6}$/i.test(val)) {
        inputPicker.value = val;
        pickerPreview.style.backgroundColor = val;
        inputHex.value = val.toUpperCase();
      }
    };

    inputHex.onkeydown = (e) => {
      if (e.key === 'Enter') {
        btnAddCustom.click();
      }
    };

    btnAddCustom.onclick = () => {
      const hex = this.normalizeHex(inputHex.value);
      if (/^#[0-9a-f]{6}$/i.test(hex)) {
        this.addSwatch(hex);
      }
    };

    this.bodyEl.appendChild(addBar);

    // 2. Presets & Actions Toolbar
    const toolBar = document.createElement('div');
    toolBar.className = 'flex flex-col gap-1.5 px-2 py-1.5 bg-[#1a1a1a] border-b border-[#2e2e2e] text-[10px]';
    
    const userKeys = Object.keys(this.userPresets);
    let optionsHtml = '';

    if (userKeys.length > 0) {
      optionsHtml += `<optgroup label="My Presets">`;
      userKeys.forEach(k => {
        const p = this.userPresets[k];
        const isSel = (k === this.selectedPresetKey) ? 'selected' : '';
        optionsHtml += `<option value="${k}" ${isSel}>★ ${p.name} (${p.colors.length})</option>`;
      });
      optionsHtml += `</optgroup>`;
    }

    optionsHtml += `<optgroup label="Built-in Presets">`;
    Object.entries(PRESETS).forEach(([k, p]) => {
      const isSel = (k === this.selectedPresetKey) ? 'selected' : '';
      optionsHtml += `<option value="${k}" ${isSel}>${p.name}</option>`;
    });
    optionsHtml += `</optgroup>`;

    const isUserPresetSelected = this.selectedPresetKey && this.selectedPresetKey.startsWith('user_');

    toolBar.innerHTML = `
      <!-- Row 1: Preset selector, Load, + Preset, Del -->
      <div class="flex items-center gap-1">
        <select id="select-swatch-preset" class="!h-5 !py-0 !px-1 !text-[10px] bg-[#242424] text-[#d4d4d4] border border-[#383838] rounded-[2px] flex-1 min-w-0" title="Select built-in or custom preset">
          ${optionsHtml}
        </select>
        <button id="btn-load-preset" class="dcc-btn !h-5 !px-1.5 !text-[9px]" title="Replace active palette with selected preset">Load</button>
        <button id="btn-open-save-preset" class="dcc-btn !h-5 !px-1.5 !text-[9px] text-[#00a8e8] border-[#00a8e8]/40 hover:border-[#00a8e8]" title="Save current swatches as a new custom preset">+ Preset</button>
        ${isUserPresetSelected ? `
          <button id="btn-delete-preset" class="dcc-btn !h-5 !px-1.5 !text-[9px] text-[#e53e3e] hover:bg-[#e53e3e]/20" title="Delete this custom preset">Del</button>
        ` : ''}
      </div>

      <!-- Inline Save Preset Form -->
      ${this.isSavingPreset ? `
        <div class="flex items-center gap-1 p-1 bg-[#242424] rounded-[2px] border border-[#00a8e8]/50">
          <input type="text" id="input-new-preset-name" placeholder="Preset name..." class="flex-1 !h-5 !py-0 !px-1.5 bg-[#181818] text-[#d4d4d4] border border-[#383838] rounded-[1px] text-[10px] focus:outline-none focus:border-[#00a8e8]" value="My Palette ${userKeys.length + 1}" />
          <button id="btn-confirm-save-preset" class="dcc-btn dcc-btn-primary !h-5 !px-2 !text-[9px]">Save</button>
          <button id="btn-cancel-save-preset" class="dcc-btn !h-5 !px-1.5 !text-[9px]">✕</button>
        </div>
      ` : ''}

      <!-- Row 2: Utilities -->
      <div class="flex items-center justify-between gap-1 text-[9px] text-[#8c8c8c]">
        <button id="btn-sample-sprite" class="dcc-btn !h-4.5 !px-1.5 !text-[9px] text-[#00a8e8] border-[#00a8e8]/30 hover:border-[#00a8e8] flex-1 flex items-center justify-center gap-1" title="Extract all colors used in current sprite">
          <svg class="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
          <span>Sample Sprite</span>
        </button>
        <button id="btn-clear-swatches" class="dcc-btn !h-4.5 !px-1.5 !text-[9px] text-[#e53e3e] hover:bg-[#e53e3e]/20" title="Clear all swatches from grid">
          Clear
        </button>
      </div>
    `;

    const selectPreset = toolBar.querySelector('#select-swatch-preset');
    const btnLoadPreset = toolBar.querySelector('#btn-load-preset');
    const btnOpenSave = toolBar.querySelector('#btn-open-save-preset');
    const btnDeletePreset = toolBar.querySelector('#btn-delete-preset');
    const btnSample = toolBar.querySelector('#btn-sample-sprite');
    const btnClear = toolBar.querySelector('#btn-clear-swatches');

    selectPreset.onchange = (e) => {
      this.selectedPresetKey = e.target.value;
      this.render();
    };

    btnLoadPreset.onclick = () => {
      const presetKey = selectPreset.value;
      const targetPreset = this.userPresets[presetKey] || PRESETS[presetKey];
      if (targetPreset && Array.isArray(targetPreset.colors)) {
        this.swatches = [...targetPreset.colors];
        this.saveSwatches();
        this.render();
      }
    };

    btnOpenSave.onclick = () => {
      if (this.swatches.length === 0) {
        alert('Cannot save an empty palette. Add some colors first.');
        return;
      }
      this.isSavingPreset = !this.isSavingPreset;
      this.render();
      if (this.isSavingPreset) {
        setTimeout(() => {
          const inputName = this.bodyEl.querySelector('#input-new-preset-name');
          if (inputName) {
            inputName.focus();
            inputName.select();
          }
        }, 50);
      }
    };

    if (btnDeletePreset) {
      btnDeletePreset.onclick = () => {
        this.deleteUserPreset(this.selectedPresetKey);
      };
    }

    if (this.isSavingPreset) {
      const inputName = toolBar.querySelector('#input-new-preset-name');
      const btnConfirm = toolBar.querySelector('#btn-confirm-save-preset');
      const btnCancel = toolBar.querySelector('#btn-cancel-save-preset');

      btnConfirm.onclick = () => {
        const name = inputName.value.trim();
        if (name) {
          this.saveCurrentAsPreset(name);
        }
      };

      btnCancel.onclick = () => {
        this.isSavingPreset = false;
        this.render();
      };

      inputName.onkeydown = (e) => {
        if (e.key === 'Enter') {
          btnConfirm.click();
        } else if (e.key === 'Escape') {
          btnCancel.click();
        }
      };
    }

    btnSample.onclick = () => this.sampleSpriteColors();
    btnClear.onclick = () => {
      if (confirm('Clear all custom swatches?')) {
        this.swatches = [];
        this.saveSwatches();
        this.render();
      }
    };

    this.bodyEl.appendChild(toolBar);

    // 3. Swatches Grid
    const gridContainer = document.createElement('div');
    gridContainer.className = 'p-2 max-h-56 overflow-y-auto';

    if (this.swatches.length === 0) {
      gridContainer.innerHTML = `
        <div class="py-6 text-center text-[#666666] text-[10px] italic">
          No swatches yet.<br>Click <b class="text-[#00a8e8]">+ Add Current</b> or load a preset.
        </div>
      `;
    } else {
      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-7 gap-1.5';

      this.swatches.forEach((hex, index) => {
        const chip = document.createElement('button');
        const isActive = (this.activeColorHex.toLowerCase() === hex.toLowerCase());
        chip.className = `w-6 h-6 rounded-[2px] transition-transform flex items-center justify-center relative group cursor-pointer ${
          isActive 
            ? 'ring-2 ring-[#00a8e8] scale-110 z-10 shadow-md' 
            : 'border border-white/20 hover:scale-115 hover:border-white/60'
        }`;
        chip.style.backgroundColor = hex;
        chip.title = `${hex.toUpperCase()}\nLeft-click to select\nRight-click to delete`;

        // Inner dot indicator if active
        if (isActive) {
          const dot = document.createElement('span');
          dot.className = 'w-1.5 h-1.5 rounded-full bg-white shadow-sm pointer-events-none';
          chip.appendChild(dot);
        }

        // Left-click: select color
        chip.onclick = () => {
          this.selectColor(hex);
        };

        // Right-click: delete swatch
        chip.oncontextmenu = (e) => {
          e.preventDefault();
          this.removeSwatch(index);
        };

        grid.appendChild(chip);
      });

      gridContainer.appendChild(grid);
    }

    this.bodyEl.appendChild(gridContainer);

    // 4. Panel Footer / Hints
    const footer = document.createElement('div');
    footer.className = 'px-2 py-1 bg-[#181818] border-t border-[#2e2e2e] flex items-center justify-between text-[9px] text-[#666666]';
    footer.innerHTML = `
      <span>Tip: Right-click swatch to remove</span>
      <span class="font-mono text-[#8c8c8c]">${this.activeColorHex.toUpperCase()}</span>
    `;
    this.bodyEl.appendChild(footer);
  }

  addSwatch(hex) {
    const clean = this.normalizeHex(hex);
    if (!/^#[0-9a-f]{6}$/i.test(clean)) return;

    // Avoid duplicate if already exists
    if (!this.swatches.includes(clean)) {
      this.swatches.push(clean);
      this.saveSwatches();
      this.render();
    }
  }

  removeSwatch(index) {
    if (index >= 0 && index < this.swatches.length) {
      this.swatches.splice(index, 1);
      this.saveSwatches();
      this.render();
    }
  }

  selectColor(hex) {
    const clean = this.normalizeHex(hex);
    this.activeColorHex = clean;
    this.onColorSelect(clean);
    this.render();
  }

  highlightColor(hex) {
    const clean = this.normalizeHex(hex);
    if (this.activeColorHex !== clean) {
      this.activeColorHex = clean;
      this.render();
    }
  }

  sampleSpriteColors() {
    if (!this.project) return;
    const uniqueColors = new Set();

    // Check all layers of master sprite and active variant
    const activeLayers = (this.project.getActiveVariant && this.project.getActiveVariant())
      ? this.project.getActiveVariant().resolveLayers(this.project)
      : (this.project.masterSprite ? this.project.masterSprite.layers : []);

    activeLayers.forEach(layer => {
      if (layer && layer.ctx && layer.width && layer.height) {
        try {
          const imgData = layer.ctx.getImageData(0, 0, layer.width, layer.height).data;
          for (let i = 0; i < imgData.length; i += 4) {
            const a = imgData[i + 3];
            if (a > 20) { // non-transparent
              const r = imgData[i].toString(16).padStart(2, '0');
              const g = imgData[i + 1].toString(16).padStart(2, '0');
              const b = imgData[i + 2].toString(16).padStart(2, '0');
              uniqueColors.add(`#${r}${g}${b}`.toLowerCase());
            }
          }
        } catch (e) {
          console.warn('Could not read layer pixel data:', e);
        }
      }
    });

    if (uniqueColors.size === 0) {
      alert('No non-transparent pixels found in sprite layers to sample.');
      return;
    }

    let addedCount = 0;
    uniqueColors.forEach(color => {
      if (!this.swatches.includes(color)) {
        this.swatches.push(color);
        addedCount++;
      }
    });

    this.saveSwatches();
    this.render();
  }

  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    this.render();
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  show() {
    this.isVisible = true;
    this.panelEl.style.display = 'block';
    this.onToggleVisibility(true);
  }

  hide() {
    this.isVisible = false;
    this.panelEl.style.display = 'none';
    this.onToggleVisibility(false);
  }
}
