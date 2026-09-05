// Timeline and Animation Playback Controller
// Manages playback loop, frame thumbnails, FPS, frame reordering, and event dispatching.

export class Timeline {
  constructor(containerElement, motionEngine, options = {}) {
    this.container = containerElement;
    this.engine = motionEngine;
    this.onFrameChange = options.onFrameChange || (() => {});
    this.onTimelineUpdate = options.onTimelineUpdate || (() => {});
    this.getBaseImage = options.getBaseImage || (() => null);

    // Playback state
    this.isPlaying = false;
    this.playDirection = 1; // 1 = forward, -1 = reverse (for ping-pong)
    this.playMode = 'loop'; // 'loop' or 'pingpong'
    this.lastFrameTime = 0;
    this.animationFrameId = null;

    this.renderTimelineUI();
    this.startPlaybackLoop();
  }

  setPlaying(playing) {
    this.isPlaying = playing;
    this.updatePlayPauseButton();
    if (this.isPlaying) {
      this.lastFrameTime = performance.now();
    }
  }

  togglePlay() {
    this.setPlaying(!this.isPlaying);
  }

  startPlaybackLoop() {
    const loop = (time) => {
      if (this.isPlaying && this.engine.frames.length > 0) {
        const frameInterval = 1000 / this.engine.fps;
        const currentFrame = this.engine.getCurrentFrame();
        const duration = (currentFrame ? currentFrame.duration : 1.0) * frameInterval;

        if (time - this.lastFrameTime >= duration) {
          this.advanceFrame();
          this.lastFrameTime = time;
        }
      }
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  advanceFrame() {
    const total = this.engine.frames.length;
    if (total <= 1) return;

    if (this.playMode === 'loop') {
      this.engine.currentFrameIndex = (this.engine.currentFrameIndex + 1) % total;
    } else if (this.playMode === 'pingpong') {
      let next = this.engine.currentFrameIndex + this.playDirection;
      if (next >= total) {
        this.playDirection = -1;
        next = Math.max(0, total - 2);
      } else if (next < 0) {
        this.playDirection = 1;
        next = Math.min(total - 1, 1);
      }
      this.engine.currentFrameIndex = next;
    }

    this.updateActiveThumbnail();
    this.onFrameChange(this.engine.currentFrameIndex);
  }

  step(direction) {
    this.setPlaying(false);
    const total = this.engine.frames.length;
    if (total <= 0) return;
    this.engine.currentFrameIndex = (this.engine.currentFrameIndex + direction + total) % total;
    this.updateActiveThumbnail();
    this.onFrameChange(this.engine.currentFrameIndex);
  }

  selectFrame(index) {
    if (index >= 0 && index < this.engine.frames.length) {
      this.engine.currentFrameIndex = index;
      this.updateActiveThumbnail();
      this.onFrameChange(index);
    }
  }

  // Move active frame left or right
  moveActiveFrame(direction) {
    const cur = this.engine.currentFrameIndex;
    const target = cur + direction;
    if (target >= 0 && target < this.engine.frames.length) {
      this.engine.moveFrame(cur, target);
      this.refreshThumbnails();
      this.onFrameChange(this.engine.currentFrameIndex);
      this.onTimelineUpdate();
    }
  }

  // Refreshes the HTML frame strip and controls
  renderTimelineUI() {
    this.container.innerHTML = `
      <div class="flex items-center justify-between gap-4 w-full h-full px-4 select-none">
        <!-- Playback Controls -->
        <div class="flex items-center gap-2">
          <button id="btn-step-prev" title="Previous Frame ([)" class="p-2 rounded hover:bg-slate-700 text-slate-300 hover:text-white transition">
            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          
          <button id="btn-play-pause" title="Play / Pause (Space)" class="p-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition">
            <svg id="icon-play" class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            <svg id="icon-pause" class="w-4 h-4 fill-current hidden" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          </button>

          <button id="btn-step-next" title="Next Frame (])" class="p-2 rounded hover:bg-slate-700 text-slate-300 hover:text-white transition">
            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>

          <!-- FPS Selector -->
          <div class="flex items-center gap-1.5 ml-3 bg-slate-800/80 border border-slate-700/80 rounded-lg px-2.5 py-1 text-xs text-slate-300">
            <span class="text-slate-400 font-medium">FPS:</span>
            <input type="number" id="input-fps" min="1" max="60" value="${this.engine.fps}" class="w-10 bg-transparent text-white font-semibold text-center focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded" />
          </div>

          <!-- Loop Mode -->
          <button id="btn-loop-mode" title="Toggle Loop / Ping-Pong" class="px-2 py-1 bg-slate-800/80 border border-slate-700/80 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:border-slate-600 transition">
            <span id="text-loop-mode">Loop</span>
          </button>
        </div>

        <!-- Frame Thumbnails Strip (Draggable Reordering) -->
        <div id="frames-strip" class="flex-1 flex items-center gap-2 overflow-x-auto py-2 px-2 scrollbar-thin scrollbar-thumb-slate-700" title="Drag and drop cards to reorder frames">
          <!-- Frame items dynamically inserted here -->
        </div>

        <!-- Frame Action & Reorder Buttons -->
        <div class="flex items-center gap-1.5">
          <!-- Reorder buttons -->
          <div class="flex items-center bg-slate-800/80 border border-slate-700/80 rounded-lg p-0.5 mr-1" title="Reorder Active Frame">
            <button id="btn-move-frame-prev" title="Move Frame Left (Alt+[)" class="p-1.5 rounded hover:bg-slate-700 text-slate-300 hover:text-white transition">
              <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
            <span class="text-[10px] text-slate-400 font-semibold px-0.5">Move</span>
            <button id="btn-move-frame-next" title="Move Frame Right (Alt+])" class="p-1.5 rounded hover:bg-slate-700 text-slate-300 hover:text-white transition">
              <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
            </button>
          </div>

          <button id="btn-add-frame" title="Add New Blank Frame" class="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded-lg text-xs font-semibold text-slate-200 transition">
            <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            Add Frame
          </button>
          
          <button id="btn-duplicate-frame" title="Duplicate Active Frame (Copies all displacements & pixels)" class="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded-lg text-xs font-semibold text-slate-200 transition">
            <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
            Duplicate
          </button>

          <button id="btn-delete-frame" title="Delete Active Frame" class="p-2 bg-slate-800 hover:bg-red-950/40 border border-slate-700 hover:border-red-800/60 rounded-lg text-slate-400 hover:text-red-400 transition">
            <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </div>
    `;

    this.bindEvents();
    this.refreshThumbnails();
  }

  bindEvents() {
    const el = (id) => this.container.querySelector(`#${id}`);

    el('btn-play-pause').addEventListener('click', () => this.togglePlay());
    el('btn-step-prev').addEventListener('click', () => this.step(-1));
    el('btn-step-next').addEventListener('click', () => this.step(1));
    el('btn-move-frame-prev').addEventListener('click', () => this.moveActiveFrame(-1));
    el('btn-move-frame-next').addEventListener('click', () => this.moveActiveFrame(1));

    const fpsInput = el('input-fps');
    fpsInput.addEventListener('change', () => {
      const val = parseInt(fpsInput.value, 10);
      if (!isNaN(val) && val >= 1 && val <= 60) {
        this.engine.fps = val;
      } else {
        fpsInput.value = this.engine.fps;
      }
    });

    const loopBtn = el('btn-loop-mode');
    const loopText = el('text-loop-mode');
    loopBtn.addEventListener('click', () => {
      if (this.playMode === 'loop') {
        this.playMode = 'pingpong';
        loopText.textContent = 'Ping-Pong';
      } else {
        this.playMode = 'loop';
        loopText.textContent = 'Loop';
      }
    });

    el('btn-add-frame').addEventListener('click', () => {
      this.engine.addFrame();
      this.refreshThumbnails();
      this.onFrameChange(this.engine.currentFrameIndex);
      this.onTimelineUpdate();
    });

    el('btn-duplicate-frame').addEventListener('click', () => {
      this.engine.duplicateCurrentFrame();
      this.refreshThumbnails();
      this.onFrameChange(this.engine.currentFrameIndex);
      this.onTimelineUpdate();
    });

    el('btn-delete-frame').addEventListener('click', () => {
      this.engine.deleteCurrentFrame();
      this.refreshThumbnails();
      this.onFrameChange(this.engine.currentFrameIndex);
      this.onTimelineUpdate();
    });

    // Spacebar to toggle play & Alt+[ / Alt+] to reorder
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.altKey && e.key === '[') {
        e.preventDefault();
        this.moveActiveFrame(-1);
      } else if (e.altKey && e.key === ']') {
        e.preventDefault();
        this.moveActiveFrame(1);
      } else if (e.key === '[') {
        e.preventDefault();
        this.step(-1);
      } else if (e.key === ']') {
        e.preventDefault();
        this.step(1);
      }
    });
  }

  updatePlayPauseButton() {
    const playIcon = this.container.querySelector('#icon-play');
    const pauseIcon = this.container.querySelector('#icon-pause');
    if (!playIcon || !pauseIcon) return;

    if (this.isPlaying) {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
    } else {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
    }
  }

  refreshThumbnails() {
    const strip = this.container.querySelector('#frames-strip');
    if (!strip) return;

    strip.innerHTML = '';
    const baseImg = this.getBaseImage();

    this.engine.frames.forEach((frame, idx) => {
      const isActive = idx === this.engine.currentFrameIndex;
      const frameCard = document.createElement('div');
      frameCard.draggable = true;
      frameCard.className = `group relative flex-shrink-0 flex flex-col items-center p-1 rounded-lg cursor-pointer border transition-all ${
        isActive
          ? 'bg-indigo-950/60 border-indigo-500 shadow-md shadow-indigo-500/20 ring-1 ring-indigo-400'
          : 'bg-slate-800/70 border-slate-700/80 hover:border-slate-500'
      }`;
      frameCard.dataset.frameIndex = idx;
      frameCard.title = `Frame ${idx + 1} (Drag to reorder)`;

      // Canvas thumbnail
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 40;
      thumbCanvas.height = 40;
      thumbCanvas.className = 'w-10 h-10 rounded bg-slate-900 pixelated pointer-events-none';
      const thumbCtx = thumbCanvas.getContext('2d');
      thumbCtx.imageSmoothingEnabled = false;

      if (baseImg) {
        this.engine.renderSpriteFrame(baseImg, idx, thumbCtx, 40, 40);
      }

      const label = document.createElement('span');
      label.className = `text-[10px] font-mono mt-0.5 ${isActive ? 'text-indigo-300 font-bold' : 'text-slate-400'}`;
      label.textContent = `${idx + 1}`;

      frameCard.appendChild(thumbCanvas);
      frameCard.appendChild(label);

      // Card click
      frameCard.addEventListener('click', (e) => {
        this.selectFrame(idx);
      });

      // Drag and Drop Reordering Handlers
      frameCard.addEventListener('dragstart', (e) => {
        this.draggedFrameIndex = idx;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', idx);
        frameCard.classList.add('opacity-40', 'scale-95');
      });

      frameCard.addEventListener('dragend', () => {
        frameCard.classList.remove('opacity-40', 'scale-95');
        this.draggedFrameIndex = null;
        strip.querySelectorAll('div[data-frame-index]').forEach(c => {
          c.classList.remove('border-indigo-400', 'bg-indigo-900/40', 'scale-105');
        });
      });

      frameCard.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (this.draggedFrameIndex !== null && this.draggedFrameIndex !== idx) {
          frameCard.classList.add('border-indigo-400', 'bg-indigo-900/40', 'scale-105');
        }
      });

      frameCard.addEventListener('dragleave', () => {
        frameCard.classList.remove('border-indigo-400', 'bg-indigo-900/40', 'scale-105');
      });

      frameCard.addEventListener('drop', (e) => {
        e.preventDefault();
        frameCard.classList.remove('border-indigo-400', 'bg-indigo-900/40', 'scale-105');
        if (this.draggedFrameIndex !== null && this.draggedFrameIndex !== idx) {
          this.engine.moveFrame(this.draggedFrameIndex, idx);
          this.refreshThumbnails();
          this.onFrameChange(this.engine.currentFrameIndex);
          this.onTimelineUpdate();
        }
      });

      strip.appendChild(frameCard);
    });
  }

  updateActiveThumbnail() {
    const strip = this.container.querySelector('#frames-strip');
    if (!strip) return;

    const cards = strip.children;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const isCardActive = i === this.engine.currentFrameIndex;
      if (isCardActive) {
        card.className = 'flex-shrink-0 flex flex-col items-center p-1 rounded-lg cursor-pointer border bg-indigo-950/60 border-indigo-500 shadow-md shadow-indigo-500/20 transition-all';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      } else {
        card.className = 'flex-shrink-0 flex flex-col items-center p-1 rounded-lg cursor-pointer border bg-slate-800/70 border-slate-700/80 hover:border-slate-500 transition-all';
      }
      const label = card.querySelector('span');
      if (label) {
        label.className = `text-[10px] font-mono mt-0.5 ${isCardActive ? 'text-indigo-300 font-bold' : 'text-slate-400'}`;
      }
    }
  }
}
