// Timeline and Animation Playback Controller (Version 2 - DCC Theme)
// Manages playback loop, frame thumbnails, FPS, frame reordering, and clip keyframes.

export class Timeline {
  constructor(containerElement, motionEngine, options = {}) {
    this.container = containerElement;
    this.engine = motionEngine;
    this.onFrameChange = options.onFrameChange || (() => {});
    this.onTimelineUpdate = options.onTimelineUpdate || (() => {});

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
        const frameInterval = 1000 / Math.max(1, this.engine.fps);
        const currentFrame = this.engine.getCurrentFrame();
        const duration = (currentFrame?.duration || 1.0) * frameInterval;

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
      <div class="flex items-center justify-between gap-3 w-full h-full px-3 select-none">
        <!-- Playback Controls -->
        <div class="flex items-center gap-1">
          <button id="btn-step-prev" title="Previous Frame ([)" class="dcc-tool-btn !w-6 !h-6">
            <svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          
          <button id="btn-play-pause" title="Play / Pause (Space)" class="dcc-tool-btn !w-6 !h-6 active !bg-[#00a8e8] !text-white !border-[#008ec4]">
            <svg id="icon-play" class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            <svg id="icon-pause" class="w-3.5 h-3.5 fill-current hidden" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          </button>

          <button id="btn-step-next" title="Next Frame (])" class="dcc-tool-btn !w-6 !h-6">
            <svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>

          <!-- Loop Mode -->
          <button id="btn-loop-mode" title="Toggle Loop / Ping-Pong" class="dcc-btn !h-6 !px-2 !text-[10px] ml-1">
            <span id="text-loop-mode">Loop</span>
          </button>
        </div>

        <!-- Frame Thumbnails Strip (Draggable Reordering) -->
        <div id="frames-strip" class="flex-1 flex items-center gap-1.5 overflow-x-auto py-1 px-2" title="Drag and drop cards to reorder frames">
          <!-- Frame items dynamically inserted here -->
        </div>

        <!-- Frame Action & Reorder Buttons -->
        <div class="flex items-center gap-1">
          <!-- Reorder buttons -->
          <div class="flex items-center bg-[#1c1c1c] border border-[#383838] rounded-[2px] p-0.5 mr-0.5" title="Reorder Active Frame">
            <button id="btn-move-frame-prev" title="Move Frame Left (Alt+[)" class="dcc-tool-btn !w-5 !h-5 !border-none !bg-transparent hover:!bg-[#383838]">
              <svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
            <span class="text-[9px] text-[#8c8c8c] font-semibold px-0.5 uppercase">Move</span>
            <button id="btn-move-frame-next" title="Move Frame Right (Alt+])" class="dcc-tool-btn !w-5 !h-5 !border-none !bg-transparent hover:!bg-[#383838]">
              <svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
            </button>
          </div>

          <button id="btn-add-frame" title="Add New Blank Frame" class="dcc-btn !h-6 !px-2">
            <svg class="w-3 h-3 fill-current text-[#00a8e8]" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            <span>Add Frame</span>
          </button>
          
          <button id="btn-duplicate-frame" title="Duplicate Active Frame" class="dcc-btn !h-6 !px-2">
            <svg class="w-3 h-3 fill-current text-[#8c8c8c]" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
            <span>Duplicate</span>
          </button>

          <button id="btn-delete-frame" title="Delete Active Frame" class="dcc-tool-btn !w-6 !h-6 hover:!border-[#e53e3e] hover:!text-[#e53e3e]">
            <svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
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
      this.engine.addBlankFrame();
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
    const activeChar = this.engine.project?.getActiveVariant() || null;

    this.engine.frames.forEach((frame, idx) => {
      const isActive = idx === this.engine.currentFrameIndex;
      const frameCard = document.createElement('div');
      frameCard.draggable = true;
      frameCard.className = `group relative flex-shrink-0 flex flex-col items-center p-1 rounded-[2px] cursor-pointer border transition-all ${
        isActive
          ? 'bg-[#1c1c1c] border-[#00a8e8] shadow-sm'
          : 'bg-[#222222] border-[#333333] hover:border-[#4c4c4c]'
      }`;
      frameCard.dataset.frameIndex = idx;
      frameCard.title = `Frame ${idx + 1} (Drag to reorder)`;

      // Canvas thumbnail
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 34;
      thumbCanvas.height = 34;
      thumbCanvas.className = 'w-[34px] h-[34px] rounded-[1px] bg-[#141414] pixelated pointer-events-none';
      const thumbCtx = thumbCanvas.getContext('2d');
      thumbCtx.imageSmoothingEnabled = false;

      this.engine.renderCharacterFrame(activeChar, idx, thumbCtx, 34, 34);

      const label = document.createElement('span');
      label.className = `text-[10px] font-mono mt-0.5 ${isActive ? 'text-[#00a8e8] font-bold' : 'text-[#8c8c8c]'}`;
      label.textContent = `${idx + 1}`;

      frameCard.appendChild(thumbCanvas);
      frameCard.appendChild(label);

      // Card click
      frameCard.addEventListener('click', () => {
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
          c.classList.remove('border-[#00a8e8]', 'bg-[#00a8e8]/20', 'scale-105');
        });
      });

      frameCard.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (this.draggedFrameIndex !== null && this.draggedFrameIndex !== idx) {
          frameCard.classList.add('border-[#00a8e8]', 'bg-[#00a8e8]/20', 'scale-105');
        }
      });

      frameCard.addEventListener('dragleave', () => {
        frameCard.classList.remove('border-[#00a8e8]', 'bg-[#00a8e8]/20', 'scale-105');
      });

      frameCard.addEventListener('drop', (e) => {
        e.preventDefault();
        frameCard.classList.remove('border-[#00a8e8]', 'bg-[#00a8e8]/20', 'scale-105');
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
      const isCardActive = (i === this.engine.currentFrameIndex);
      if (isCardActive) {
        card.className = 'flex-shrink-0 flex flex-col items-center p-1 rounded-[2px] cursor-pointer border bg-[#1c1c1c] border-[#00a8e8] shadow-sm transition-all';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      } else {
        card.className = 'flex-shrink-0 flex flex-col items-center p-1 rounded-[2px] cursor-pointer border bg-[#222222] border-[#333333] hover:border-[#4c4c4c] transition-all';
      }
      const label = card.querySelector('span');
      if (label) {
        label.className = `text-[10px] font-mono mt-0.5 ${isCardActive ? 'text-[#00a8e8] font-bold' : 'text-[#8c8c8c]'}`;
      }
    }
  }
}
