// Target Sprites Deck & Live Replay Deck
// Manages sprites, active canvas sprite selection, real-time synchronized playback, and individual/batch exports.

export class TargetSpritesDeck {
  constructor(containerElement, motionEngine, options = {}) {
    this.container = containerElement;
    this.engine = motionEngine;
    this.onSelectSprite = options.onSelectSprite || (() => {});
    this.onExportSingle = options.onExportSingle || (() => {});
    this.onBatchExport = options.onBatchExport || (() => {});

    // Target sprites array: [{ id, name, img, width, height, canvas, ctx }]
    this.targetSprites = [];
    this.activeSpriteId = null;
    this.setupUI();
  }

  setupUI() {
    this.container.innerHTML = `
      <div class="flex flex-col h-full bg-[#282828] border-l border-[#3c3c3c] text-[#d4d4d4]">
        <!-- Header -->
        <div class="dcc-dock-header">
          <div class="dcc-dock-tab">
            <svg class="w-3.5 h-3.5 text-[#00a8e8] fill-current" viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>
            <span>Sprites Deck</span>
            <span id="target-count-badge" class="px-1 py-0.2 text-[9px] font-bold bg-[#1c1c1c] text-[#00a8e8] rounded-[1px] border border-[#383838]">0</span>
          </div>

          <!-- Add Button -->
          <label class="cursor-pointer dcc-btn !h-5 !px-1.5 !text-[10px]">
            <svg class="w-3 h-3 fill-current text-[#00a8e8]" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            Add Sprites
            <input type="file" id="input-target-sprites" multiple accept="image/png,image/jpeg,image/webp" class="hidden" />
          </label>
        </div>

        <!-- Description Banner -->
        <div class="px-3 py-1.5 bg-[#202020] text-[10px] text-[#8c8c8c] border-b border-[#333333] leading-relaxed">
          Click any sprite below to <strong class="text-[#00a8e8]">use & edit in the canvas</strong>. All sprites preview the same animation in real-time.
        </div>

        <!-- Sprites List -->
        <div id="target-sprites-list" class="flex-1 overflow-y-auto p-1.5 space-y-1.5">
          <!-- Sprite cards inserted dynamically -->
        </div>

        <!-- Batch Action Footer -->
        <div class="p-3 border-t border-slate-800 bg-slate-900 space-y-2">
          <div class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Batch Export All</div>
          <div class="grid grid-cols-2 gap-2">
            <button id="btn-batch-spritesheets" class="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded-lg text-xs font-semibold text-slate-200 shadow transition flex items-center justify-center gap-1.5">
              <svg class="w-3.5 h-3.5 text-amber-400 fill-current" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z"/></svg>
              Spritesheets (.zip)
            </button>
            <button id="btn-batch-gifs" class="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded-lg text-xs font-semibold text-slate-200 shadow transition flex items-center justify-center gap-1.5">
              <svg class="w-3.5 h-3.5 text-emerald-400 fill-current" viewBox="0 0 24 24"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H5V6h14v12z"/></svg>
              GIFs (.zip)
            </button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    const fileInput = this.container.querySelector('#input-target-sprites');
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      files.forEach((file, idx) => {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const img = new Image();
          img.onload = () => {
            const name = file.name.replace(/\.[^/.]+$/, '');
            // Activate the first newly uploaded sprite
            this.addSprite(name, img, null, idx === 0);
          };
          img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
      });
      fileInput.value = '';
    });

    // Drag and drop support on container
    this.container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this.container.classList.add('ring-2', 'ring-indigo-500');
    });

    this.container.addEventListener('dragleave', () => {
      this.container.classList.remove('ring-2', 'ring-indigo-500');
    });

    this.container.addEventListener('drop', (e) => {
      e.preventDefault();
      this.container.classList.remove('ring-2', 'ring-indigo-500');
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      files.forEach((file, idx) => {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const img = new Image();
          img.onload = () => {
            const name = file.name.replace(/\.[^/.]+$/, '');
            this.addSprite(name, img, null, idx === 0);
          };
          img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
      });
    });

    this.container.querySelector('#btn-batch-spritesheets').addEventListener('click', () => {
      this.onBatchExport('spritesheet');
    });

    this.container.querySelector('#btn-batch-gifs').addEventListener('click', () => {
      this.onBatchExport('gif');
    });
  }

  addSprite(name, imgElement, id = null, setAsActive = false) {
    const spriteId = id || 'sprite_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const w = imgElement.naturalWidth || imgElement.width || 32;
    const h = imgElement.naturalHeight || imgElement.height || 32;

    const spriteObj = {
      id: spriteId,
      name: name,
      img: imgElement,
      width: w,
      height: h,
      canvas: null,
      ctx: null
    };

    this.targetSprites.push(spriteObj);

    if (setAsActive || !this.activeSpriteId || this.targetSprites.length === 1) {
      this.setActiveSprite(spriteId);
    } else {
      this.renderSpriteCards();
      this.renderCurrentFrame(this.engine.currentFrameIndex);
    }
  }

  // Backwards compatibility alias
  addTargetSprite(name, imgElement, id = null) {
    this.addSprite(name, imgElement, id, false);
  }

  setActiveSprite(id) {
    const sprite = this.targetSprites.find(s => s.id === id);
    if (!sprite) return;

    this.activeSpriteId = id;
    this.renderSpriteCards();
    this.renderCurrentFrame(this.engine.currentFrameIndex);
    this.onSelectSprite(sprite);
  }

  getActiveSprite() {
    return this.targetSprites.find(s => s.id === this.activeSpriteId) || null;
  }

  removeTargetSprite(id) {
    const wasActive = this.activeSpriteId === id;
    this.targetSprites = this.targetSprites.filter(s => s.id !== id);

    if (wasActive) {
      if (this.targetSprites.length > 0) {
        this.setActiveSprite(this.targetSprites[0].id);
      } else {
        this.activeSpriteId = null;
        this.renderSpriteCards();
        this.onSelectSprite(null);
      }
    } else {
      this.renderSpriteCards();
    }
  }

  renderSpriteCards() {
    const list = this.container.querySelector('#target-sprites-list');
    const badge = this.container.querySelector('#target-count-badge');
    if (!list) return;

    badge.textContent = this.targetSprites.length;

    if (this.targetSprites.length === 0) {
      list.innerHTML = `
        <div class="h-48 flex flex-col items-center justify-center text-center p-4 border-2 border-dashed border-slate-800 rounded-xl text-slate-500">
          <svg class="w-8 h-8 mb-2 opacity-50 fill-current" viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
          <span class="text-xs font-medium text-slate-400">No Sprites Loaded</span>
          <span class="text-[11px] text-slate-500 mt-1">Upload sprites above or drag & drop files here</span>
        </div>
      `;
      return;
    }

    list.innerHTML = '';

    this.targetSprites.forEach(sprite => {
      const isActive = sprite.id === this.activeSpriteId;
      const card = document.createElement('div');
      
      card.className = `group rounded-[2px] p-2 border flex items-center gap-2 transition cursor-pointer select-none ${
        isActive
          ? 'bg-[#1c1c1c] border-[#00a8e8] shadow-sm'
          : 'bg-[#242424] border-[#383838] hover:border-[#4c4c4c]'
      }`;
      card.dataset.spriteId = sprite.id;
      card.title = isActive ? `${sprite.name} (Active in canvas editor)` : `Click to switch to ${sprite.name} in canvas editor`;

      // Preview canvas
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      canvas.className = `w-12 h-12 rounded-[1px] bg-[#141414] border border-[#333333] pixelated flex-shrink-0 transition-transform ${
        isActive ? 'border-[#00a8e8]' : 'group-hover:scale-105'
      }`;
      sprite.canvas = canvas;
      sprite.ctx = canvas.getContext('2d');
      sprite.ctx.imageSmoothingEnabled = false;

      // Card Content
      const infoCol = document.createElement('div');
      infoCol.className = 'flex-1 min-w-0';

      infoCol.innerHTML = `
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-1 min-w-0">
            <h4 class="text-[11px] font-semibold ${isActive ? 'text-[#00a8e8]' : 'text-[#d4d4d4]'} truncate" title="${sprite.name}">${sprite.name}</h4>
          </div>
          <button class="btn-delete-target text-[#8c8c8c] hover:text-[#e53e3e] p-0.5 rounded transition" title="Remove Sprite">
            <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[9px] text-[#8c8c8c] font-mono">${sprite.width} × ${sprite.height} px</span>
          ${
            isActive
              ? `<span class="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[#00a8e8] bg-[#181818] px-1 py-0.5 rounded-[1px] border border-[#00a8e8]/40"><span class="w-1.5 h-1.5 rounded-full bg-[#00a8e8]"></span> Active</span>`
              : `<span class="text-[9px] text-[#8c8c8c] group-hover:text-[#00a8e8] font-medium transition flex items-center gap-0.5">Use sprite &rarr;</span>`
          }
        </div>
        
        <!-- Individual Export Buttons -->
        <div class="flex items-center gap-1">
          <button class="btn-export-sheet dcc-btn !h-4 !px-1 !text-[9px]" title="Export Spritesheet PNG">
            Sheet
          </button>
          <button class="btn-export-gif px-2 py-1 bg-slate-700/80 hover:bg-emerald-600 text-slate-300 hover:text-white rounded text-[10px] font-semibold transition" title="Export Animated GIF">
            GIF
          </button>
          <button class="btn-export-frames px-2 py-1 bg-slate-700/80 hover:bg-amber-600 text-slate-300 hover:text-white rounded text-[10px] font-semibold transition" title="Export PNG Frames Sequence">
            PNGs
          </button>
        </div>
      `;

      // Clicking card switches active sprite
      card.addEventListener('click', (e) => {
        // Prevent click if clicking child action buttons
        if (e.target.closest('.btn-delete-target') || e.target.closest('.btn-export-sheet') || e.target.closest('.btn-export-gif') || e.target.closest('.btn-export-frames')) {
          return;
        }
        if (sprite.id !== this.activeSpriteId) {
          this.setActiveSprite(sprite.id);
        }
      });

      // Event handlers with stopPropagation to avoid triggering card click
      infoCol.querySelector('.btn-delete-target').addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeTargetSprite(sprite.id);
      });
      infoCol.querySelector('.btn-export-sheet').addEventListener('click', (e) => {
        e.stopPropagation();
        this.onExportSingle(sprite, 'spritesheet');
      });
      infoCol.querySelector('.btn-export-gif').addEventListener('click', (e) => {
        e.stopPropagation();
        this.onExportSingle(sprite, 'gif');
      });
      infoCol.querySelector('.btn-export-frames').addEventListener('click', (e) => {
        e.stopPropagation();
        this.onExportSingle(sprite, 'frames');
      });

      card.appendChild(canvas);
      card.appendChild(infoCol);
      list.appendChild(card);
    });

    this.renderCurrentFrame(this.engine.currentFrameIndex);
  }

  // Renders the animation frame for all active target sprites
  renderCurrentFrame(frameIndex) {
    if (this.targetSprites.length === 0) return;

    this.targetSprites.forEach(sprite => {
      if (!sprite.ctx || !sprite.canvas) return;

      const ctx = sprite.ctx;
      const w = sprite.canvas.width;
      const h = sprite.canvas.height;

      ctx.clearRect(0, 0, w, h);

      // Draw subtle mini checkerboard
      const sz = 8;
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#131c2e';
      for (let y = 0; y < h; y += sz) {
        for (let x = 0; x < w; x += sz) {
          if (((x / sz) + (y / sz)) % 2 === 0) {
            ctx.fillRect(x, y, sz, sz);
          }
        }
      }

      // Draw deformed target sprite
      this.engine.renderSpriteFrame(
        sprite.img,
        frameIndex,
        ctx,
        w,
        h,
        { samplingMode: this.engine.samplingMode }
      );
    });
  }
}
