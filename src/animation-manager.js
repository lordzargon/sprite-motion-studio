// Animation Manager UI Component (Version 2 - DCC Theme)
// Manages multiple named animation clips ("Idle", "Run", "Attack", etc.),
// frame rates, looping, and fast switching.

export class AnimationManager {
  constructor(containerEl, project, engine, callbacks = {}) {
    this.container = containerEl;
    this.project = project;
    this.engine = engine;
    this.callbacks = callbacks; // { onClipChange, onClipListUpdate }

    this.render();
  }

  setProject(project) {
    this.project = project;
    this.render();
  }

  render() {
    this.container.innerHTML = '';
    const activeClip = this.project.getActiveClip();

    const root = document.createElement('div');
    root.className = 'flex items-center gap-1.5 select-none';

    // Label
    const label = document.createElement('div');
    label.className = 'flex items-center gap-1 text-[10px] text-[#8c8c8c] uppercase font-semibold';
    label.innerHTML = `
      <svg class="w-3 h-3 text-[#00a8e8] fill-current" viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg>
      <span>Clip:</span>
    `;
    root.appendChild(label);

    // Clip Selector Dropdown
    const select = document.createElement('select');
    select.id = 'select-animation-clip';
    select.className = '!h-6 !text-[11px] font-semibold text-[#00a8e8] cursor-pointer';

    this.project.animations.forEach(clip => {
      const opt = document.createElement('option');
      opt.value = clip.id;
      opt.textContent = `${clip.name} (${clip.frames.length}f)`;
      if (activeClip && clip.id === activeClip.id) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });

    select.onchange = (e) => {
      this.project.activeClipId = e.target.value;
      this.engine.currentFrameIndex = 0;
      if (this.callbacks.onClipChange) this.callbacks.onClipChange();
    };
    root.appendChild(select);

    // New Clip Button
    const newBtn = document.createElement('button');
    newBtn.className = 'dcc-tool-btn !w-5 !h-5';
    newBtn.title = 'Add New Animation Clip';
    newBtn.innerHTML = `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
    newBtn.onclick = () => this.showAddClipDialog();
    root.appendChild(newBtn);

    // Duplicate Clip Button
    const dupBtn = document.createElement('button');
    dupBtn.className = 'dcc-tool-btn !w-5 !h-5';
    dupBtn.title = 'Duplicate Current Clip';
    dupBtn.innerHTML = `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
    dupBtn.onclick = () => {
      if (!activeClip) return;
      const copy = activeClip.clone(`${activeClip.name} (Copy)`);
      this.project.animations.push(copy);
      this.project.activeClipId = copy.id;
      this.engine.currentFrameIndex = 0;
      this.render();
      if (this.callbacks.onClipListUpdate) this.callbacks.onClipListUpdate();
    };
    root.appendChild(dupBtn);

    // Rename Clip Button
    const renameBtn = document.createElement('button');
    renameBtn.className = 'dcc-tool-btn !w-5 !h-5';
    renameBtn.title = 'Rename Current Clip';
    renameBtn.innerHTML = `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
    renameBtn.onclick = () => {
      if (!activeClip) return;
      const newName = prompt('Rename Animation Clip:', activeClip.name);
      if (newName && newName.trim()) {
        activeClip.name = newName.trim();
        this.render();
        if (this.callbacks.onClipListUpdate) this.callbacks.onClipListUpdate();
      }
    };
    root.appendChild(renameBtn);

    // Delete Clip Button
    if (this.project.animations.length > 1) {
      const delBtn = document.createElement('button');
      delBtn.className = 'dcc-tool-btn !w-5 !h-5 hover:!border-[#e53e3e] hover:!text-[#e53e3e]';
      delBtn.title = 'Delete Current Clip';
      delBtn.innerHTML = `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
      delBtn.onclick = () => {
        if (!activeClip) return;
        if (confirm(`Delete animation clip "${activeClip.name}"?`)) {
          this.project.deleteClip(activeClip.id);
          this.engine.currentFrameIndex = 0;
          this.render();
          if (this.callbacks.onClipListUpdate) this.callbacks.onClipListUpdate();
        }
      };
      root.appendChild(delBtn);
    }

    // Divider
    const divider = document.createElement('div');
    divider.className = 'w-[1px] h-4 bg-[#3c3c3c] mx-0.5';
    root.appendChild(divider);

    // FPS Input (Scrubbable inline style)
    const fpsContainer = document.createElement('div');
    fpsContainer.className = 'flex items-center gap-1 text-[10px] text-[#8c8c8c]';
    const fps = activeClip ? activeClip.fps : 8;
    fpsContainer.innerHTML = `
      <span class="uppercase font-semibold text-[#8c8c8c]">FPS:</span>
      <input type="number" id="input-clip-fps" min="1" max="60" value="${fps}" class="w-10 !h-5 font-mono text-center !py-0 !text-[11px] text-[#00a8e8]" />
    `;
    const fpsInput = fpsContainer.querySelector('#input-clip-fps');
    fpsInput.onchange = (e) => {
      const val = parseInt(e.target.value, 10) || 8;
      this.engine.fps = val;
    };
    root.appendChild(fpsContainer);

    // Loop Toggle
    const loopLabel = document.createElement('label');
    loopLabel.className = 'flex items-center gap-1 text-[11px] text-[#8c8c8c] cursor-pointer hover:text-[#d4d4d4] transition ml-1';
    const isLoop = activeClip ? activeClip.loop : true;
    loopLabel.innerHTML = `
      <input type="checkbox" id="toggle-clip-loop" ${isLoop ? 'checked' : ''} />
      <span>Loop</span>
    `;
    const loopInput = loopLabel.querySelector('#toggle-clip-loop');
    loopInput.onchange = (e) => {
      if (activeClip) activeClip.loop = e.target.checked;
    };
    root.appendChild(loopLabel);

    this.container.appendChild(root);
  }

  showAddClipDialog() {
    const name = prompt('New Animation Name (e.g. Walk, Run, Attack, Hurt, Jump, Cast):');
    if (!name || !name.trim()) return;

    const clip = this.project.addClip(name.trim(), 8);
    this.engine.currentFrameIndex = 0;
    this.render();
    if (this.callbacks.onClipListUpdate) this.callbacks.onClipListUpdate();
  }
}
