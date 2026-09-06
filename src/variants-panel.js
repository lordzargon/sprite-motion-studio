// Variants Panel UI Component (Version 2 - DCC Theme)
// Manages hierarchical Sprite Variants (reskinning, layer overrides,
// and cascading animations) with live multi-variant synchronized preview.

export class VariantsPanel {
  constructor(containerEl, project, engine, callbacks = {}) {
    this.container = containerEl;
    this.project = project;
    this.engine = engine;
    this.callbacks = callbacks; // { onSelectVariant, onVariantChange }

    this.render();
  }

  setProject(project) {
    this.project = project;
    this.render();
  }

  render() {
    this.container.innerHTML = '';

    // Panel Header
    const header = document.createElement('div');
    header.className = 'dcc-dock-header';
    header.innerHTML = `
      <div class="dcc-dock-tab">
        <svg class="w-3.5 h-3.5 text-[#00a8e8] fill-current" viewBox="0 0 24 24"><path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/></svg>
        <span>Variants</span>
        <span class="text-[9px] px-1 py-0.2 rounded-[1px] bg-[#1c1c1c] text-[#00a8e8] font-mono border border-[#383838]">${1 + this.project.variants.length}</span>
      </div>
      <button id="btn-add-variant" class="dcc-btn !h-5 !px-1.5 !text-[10px]">
        <svg class="w-3 h-3 fill-current text-[#00a8e8]" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        New Variant
      </button>
    `;

    const addBtn = header.querySelector('#btn-add-variant');
    addBtn.onclick = () => this.showAddVariantDialog();

    this.container.appendChild(header);

    // Variant Cards Deck (scrollable)
    const list = document.createElement('div');
    list.className = 'flex-1 overflow-y-auto p-1.5 space-y-1.5';

    // 1. Master Sprite Card
    const isMasterActive = (this.project.activeVariantId === null);
    const masterCard = this.createCharacterCard(null, isMasterActive);
    list.appendChild(masterCard);

    // 2. Variants Cards
    this.project.variants.forEach(variant => {
      const isVariantActive = (this.project.activeVariantId === variant.id);
      const card = this.createCharacterCard(variant, isVariantActive);
      list.appendChild(card);
    });

    this.container.appendChild(list);

    // Initial render of previews
    this.renderAllPreviews();
  }

  createCharacterCard(variant, isActive) {
    const isMaster = (variant === null);
    const id = isMaster ? 'master' : variant.id;
    const name = isMaster ? `${this.project.name} (Master)` : variant.name;

    const card = document.createElement('div');
    card.className = `p-2 rounded-[2px] border transition relative flex flex-col gap-1.5 ${
      isActive
        ? 'bg-[#1c1c1c] border-[#00a8e8] shadow-sm'
        : 'bg-[#242424] border-[#383838] hover:border-[#484848]'
    }`;

    // Top Row: Title + Active Badge
    const topRow = document.createElement('div');
    topRow.className = 'flex items-center justify-between select-none';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'flex items-center gap-1.5 truncate';

    const badgeColor = isMaster ? 'bg-[#181818] text-[#00a8e8] border-[#00a8e8]/50' : 'bg-[#181818] text-[#d4d4d4] border-[#383838]';
    const typeLabel = isMaster ? 'BASE' : 'VAR';

    let parentInfo = '';
    if (!isMaster) {
      const parentName = variant.parentId ? (this.project.getVariant(variant.parentId)?.name || 'Parent') : 'Master';
      parentInfo = `<span class="text-[9px] text-[#8c8c8c] truncate" title="Cascades from ${parentName}">↳ ${parentName}</span>`;
    }

    titleWrap.innerHTML = `
      <span class="text-[9px] font-bold px-1 py-0.5 rounded-[1px] border ${badgeColor}">${typeLabel}</span>
      <span class="text-[11px] font-semibold text-[#d4d4d4] truncate">${name}</span>
      ${parentInfo}
    `;

    topRow.appendChild(titleWrap);

    if (isActive) {
      const activeTag = document.createElement('span');
      activeTag.className = 'text-[9px] font-bold uppercase tracking-wider text-[#00a8e8] flex items-center gap-1';
      activeTag.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-[#00a8e8]"></span>Active`;
      topRow.appendChild(activeTag);
    }

    // Middle Row: Centered Preview Canvas
    const previewContainer = document.createElement('div');
    previewContainer.className = 'w-full h-20 rounded-[2px] bg-[#181818] border border-[#333333] flex items-center justify-center relative overflow-hidden cursor-pointer group';
    previewContainer.onclick = () => {
      this.selectCharacter(variant);
    };

    const canvas = document.createElement('canvas');
    canvas.id = `variant-canvas-${id}`;
    canvas.width = 64;
    canvas.height = 64;
    canvas.className = 'w-14 h-14 pixelated transition-transform group-hover:scale-105';
    previewContainer.appendChild(canvas);

    // Hover hint
    const hoverOverlay = document.createElement('div');
    hoverOverlay.className = 'absolute inset-0 bg-[#000000]/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-[10px] font-bold text-[#00a8e8]';
    hoverOverlay.textContent = isActive ? 'Active on Canvas' : 'Click to Edit';
    previewContainer.appendChild(hoverOverlay);

    // Bottom Row: Action buttons
    const actionsRow = document.createElement('div');
    actionsRow.className = 'flex items-center justify-between pt-1 border-t border-[#2e2e2e] text-[10px]';

    const leftActions = document.createElement('div');
    leftActions.className = 'flex items-center gap-1';

    if (!isActive) {
      const editBtn = document.createElement('button');
      editBtn.className = 'dcc-btn !h-5 !px-1.5 !text-[10px]';
      editBtn.textContent = 'Edit Canvas';
      editBtn.onclick = () => this.selectCharacter(variant);
      leftActions.appendChild(editBtn);
    } else {
      const activeHint = document.createElement('span');
      activeHint.className = 'text-[10px] text-[#00a8e8] font-semibold';
      activeHint.textContent = isMaster ? 'Master Layers' : 'Variant Overrides';
      leftActions.appendChild(activeHint);
    }

    const rightActions = document.createElement('div');
    rightActions.className = 'flex items-center gap-0.5';

    // Duplicate button
    const dupBtn = document.createElement('button');
    dupBtn.className = 'p-1 rounded-[1px] hover:bg-[#383838] text-[#8c8c8c] hover:text-[#d4d4d4] transition';
    dupBtn.title = 'Duplicate Variant';
    dupBtn.innerHTML = `<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
    dupBtn.onclick = () => {
      const baseName = isMaster ? 'Master' : variant.name;
      const newVar = this.project.addVariant(`${baseName} (Copy)`, isMaster ? null : variant.id);
      this.render();
      if (this.callbacks.onVariantChange) this.callbacks.onVariantChange();
    };
    rightActions.appendChild(dupBtn);

    // Delete button (only for variants, not master)
    if (!isMaster) {
      const delBtn = document.createElement('button');
      delBtn.className = 'p-1 rounded-[1px] hover:bg-[#383838] text-[#8c8c8c] hover:text-[#e53e3e] transition';
      delBtn.title = 'Delete Variant';
      delBtn.innerHTML = `<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
      delBtn.onclick = () => {
        if (confirm(`Delete variant "${variant.name}"?`)) {
          this.project.deleteVariant(variant.id);
          this.render();
          if (this.callbacks.onVariantChange) this.callbacks.onVariantChange();
        }
      };
      rightActions.appendChild(delBtn);
    }

    actionsRow.appendChild(leftActions);
    actionsRow.appendChild(rightActions);

    card.appendChild(topRow);
    card.appendChild(previewContainer);
    card.appendChild(actionsRow);

    return card;
  }

  selectCharacter(variant) {
    this.project.activeVariantId = variant ? variant.id : null;
    this.render();
    if (this.callbacks.onSelectVariant) {
      this.callbacks.onSelectVariant(variant);
    }
  }

  showAddVariantDialog() {
    const name = prompt('Enter new Variant name (e.g. Paladin, Rogue with Cape, Red Armor):');
    if (!name || !name.trim()) return;

    // Use currently active variant as parent, or master
    const parentId = this.project.activeVariantId;
    const newVariant = this.project.addVariant(name.trim(), parentId);
    this.render();
    if (this.callbacks.onVariantChange) this.callbacks.onVariantChange();
  }

  renderAllPreviews() {
    const frameIndex = this.engine.currentFrameIndex;
    const outW = 64;
    const outH = 64;

    // 1. Render Master
    const masterCanvas = document.getElementById('variant-canvas-master');
    if (masterCanvas) {
      const ctx = masterCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      this.engine.renderCharacterFrame(null, frameIndex, ctx, outW, outH);
    }

    // 2. Render each variant
    this.project.variants.forEach(variant => {
      const vCanvas = document.getElementById(`variant-canvas-${variant.id}`);
      if (vCanvas) {
        const ctx = vCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        this.engine.renderCharacterFrame(variant, frameIndex, ctx, outW, outH);
      }
    });
  }

  renderCurrentFrame(frameIndex) {
    this.renderAllPreviews();
  }
}
