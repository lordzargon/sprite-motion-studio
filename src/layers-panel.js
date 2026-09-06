// Layers Panel UI Component (Version 2 - DCC Theme)
// Manages the layer stack for the active character (Master Sprite or Variant),
// with visibility toggles, locks, edit targets, reordering, and layer creation.

export class LayersPanel {
  constructor(containerEl, project, engine, callbacks = {}) {
    this.container = containerEl;
    this.project = project;
    this.engine = engine;
    this.callbacks = callbacks; // { onLayerChange, onEditTargetChange }

    this.render();
  }

  setProject(project) {
    this.project = project;
    this.render();
  }

  getActiveLayers() {
    const activeVariant = this.project.getActiveVariant();
    if (activeVariant) {
      return activeVariant.resolveLayers(this.project);
    }
    return this.project.masterSprite.layers;
  }

  render() {
    this.container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'dcc-dock-header';
    
    const titleContainer = document.createElement('div');
    titleContainer.className = 'dcc-dock-tab';
    
    const activeVariant = this.project.getActiveVariant();
    const titleText = activeVariant ? `Layers (${activeVariant.name})` : 'Layers (Master)';
    
    titleContainer.innerHTML = `
      <svg class="w-3.5 h-3.5 text-[#00a8e8] fill-current" viewBox="0 0 24 24"><path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9.07l-9-7-9 7 1.63 1.27L12 16z"/></svg>
      <span>${titleText}</span>
    `;

    const addBtn = document.createElement('button');
    addBtn.className = 'dcc-btn !h-5 !px-1.5 !text-[10px]';
    addBtn.innerHTML = `
      <svg class="w-3 h-3 fill-current text-[#00a8e8]" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      Add Layer
    `;
    addBtn.onclick = () => this.addNewLayer();

    header.appendChild(titleContainer);
    header.appendChild(addBtn);
    this.container.appendChild(header);

    // Layer Stack List (Top layers shown at top of list, i.e. reversed index)
    const listContainer = document.createElement('div');
    listContainer.className = 'flex-1 overflow-y-auto p-1.5 space-y-1';

    const layers = this.getActiveLayers();
    // Reverse for display so top-drawn layer is at the top of UI
    const reversedLayers = [...layers].map((l, idx) => ({ layer: l, origIndex: idx })).reverse();

    if (reversedLayers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-center py-6 text-[#5f5f5f] text-xs';
      empty.textContent = 'No layers. Click "+ Add Layer" to start.';
      listContainer.appendChild(empty);
    } else {
      reversedLayers.forEach(({ layer, origIndex }) => {
        const item = this.createLayerRow(layer, origIndex, layers.length);
        listContainer.appendChild(item);
      });
    }

    this.container.appendChild(listContainer);
  }

  createLayerRow(layer, origIndex, totalLayers) {
    const row = document.createElement('div');
    const isEdit = layer.isEditTarget;
    row.className = `p-1.5 rounded-[2px] border transition flex flex-col gap-1 ${
      isEdit 
        ? 'bg-[#1c1c1c] border-[#00a8e8] shadow-sm' 
        : 'bg-[#222222] border-[#333333] hover:border-[#444444]'
    }`;

    // Top row: Edit Target Radio/Checkbox + Thumbnail + Name + Visibility + Lock
    const topRow = document.createElement('div');
    topRow.className = 'flex items-center gap-1.5 select-none';

    // 1. Edit Target indicator button
    const editBtn = document.createElement('button');
    editBtn.title = isEdit ? 'Currently marked for Edit (Tools affect this layer)' : 'Click to mark this layer for Edit';
    editBtn.className = `px-1 py-0.5 rounded-[1px] text-[9px] font-mono font-bold uppercase transition flex items-center gap-1 ${
      isEdit 
        ? 'bg-[#00a8e8] text-white' 
        : 'bg-[#1c1c1c] text-[#8c8c8c] hover:text-[#d4d4d4] hover:bg-[#333333]'
    }`;
    editBtn.innerHTML = isEdit 
      ? `<span class="w-1.5 h-1.5 rounded-full bg-white"></span>EDIT` 
      : `<span class="w-1.5 h-1.5 rounded-full bg-[#555555]"></span>Edit`;
    editBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleEditTarget(layer, e.shiftKey);
    };

    // 2. Thumbnail Preview
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 24;
    thumbCanvas.height = 24;
    thumbCanvas.className = 'w-5 h-5 rounded-[1px] bg-[#141414] border border-[#383838] flex-shrink-0';
    const thumbCtx = thumbCanvas.getContext('2d');
    thumbCtx.imageSmoothingEnabled = false;
    thumbCtx.drawImage(layer.canvas, 0, 0, 24, 24);

    // 3. Name (Editable on click)
    const nameLabel = document.createElement('span');
    nameLabel.className = 'flex-1 text-[11px] font-medium text-[#d4d4d4] truncate cursor-pointer hover:text-[#00a8e8]';
    nameLabel.textContent = layer.name;
    nameLabel.title = 'Click to rename layer';
    nameLabel.onclick = () => {
      const newName = prompt('Rename Layer:', layer.name);
      if (newName && newName.trim()) {
        layer.name = newName.trim();
        this.render();
        if (this.callbacks.onLayerChange) this.callbacks.onLayerChange();
      }
    };

    // 4. Visibility Toggle (Eye icon)
    const visBtn = document.createElement('button');
    visBtn.className = `p-0.5 rounded-[1px] hover:bg-[#383838] transition ${layer.visible ? 'text-[#d4d4d4]' : 'text-[#555555]'}`;
    visBtn.title = layer.visible ? 'Hide Layer' : 'Show Layer';
    visBtn.innerHTML = layer.visible
      ? `<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`
      : `<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`;
    visBtn.onclick = (e) => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      this.render();
      if (this.callbacks.onLayerChange) this.callbacks.onLayerChange();
    };

    // 5. Lock Toggle (Lock icon)
    const lockBtn = document.createElement('button');
    lockBtn.className = `p-0.5 rounded-[1px] hover:bg-[#383838] transition ${layer.locked ? 'text-[#d69e2e]' : 'text-[#555555]'}`;
    lockBtn.title = layer.locked ? 'Unlock Layer' : 'Lock Layer';
    lockBtn.innerHTML = layer.locked
      ? `<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`
      : `<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/></svg>`;
    lockBtn.onclick = (e) => {
      e.stopPropagation();
      layer.locked = !layer.locked;
      if (layer.locked && layer.isEditTarget) {
        layer.isEditTarget = false;
      }
      this.render();
      if (this.callbacks.onLayerChange) this.callbacks.onLayerChange();
    };

    topRow.appendChild(editBtn);
    topRow.appendChild(thumbCanvas);
    topRow.appendChild(nameLabel);
    topRow.appendChild(visBtn);
    topRow.appendChild(lockBtn);

    // Bottom controls: Opacity Slider & Move / Delete Actions
    const bottomRow = document.createElement('div');
    bottomRow.className = 'flex items-center justify-between text-[10px] text-[#8c8c8c] pt-1 border-t border-[#2e2e2e]';

    // Opacity
    const opacityWrap = document.createElement('div');
    opacityWrap.className = 'flex items-center gap-1';
    const opVal = Math.round((layer.opacity !== undefined ? layer.opacity : 1) * 100);
    opacityWrap.innerHTML = `<span class="uppercase text-[9px] font-semibold text-[#8c8c8c]">Op:</span>`;
    const opSlider = document.createElement('input');
    opSlider.type = 'range';
    opSlider.min = '0';
    opSlider.max = '100';
    opSlider.value = String(opVal);
    opSlider.className = 'w-12 cursor-pointer';
    opSlider.oninput = (e) => {
      layer.opacity = parseInt(e.target.value, 10) / 100;
      if (this.callbacks.onLayerChange) this.callbacks.onLayerChange();
    };
    opacityWrap.appendChild(opSlider);

    // Reorder and Delete buttons
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'flex items-center gap-0.5';

    // Move Up in stack (visually Up = higher origIndex)
    const moveUpBtn = document.createElement('button');
    moveUpBtn.className = 'p-0.5 rounded-[1px] hover:bg-[#383838] text-[#8c8c8c] hover:text-[#d4d4d4] disabled:opacity-20';
    moveUpBtn.disabled = (origIndex >= totalLayers - 1);
    moveUpBtn.title = 'Move Layer Up';
    moveUpBtn.innerHTML = `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>`;
    moveUpBtn.onclick = (e) => {
      e.stopPropagation();
      this.reorderLayer(origIndex, origIndex + 1);
    };

    // Move Down in stack
    const moveDownBtn = document.createElement('button');
    moveDownBtn.className = 'p-0.5 rounded-[1px] hover:bg-[#383838] text-[#8c8c8c] hover:text-[#d4d4d4] disabled:opacity-20';
    moveDownBtn.disabled = (origIndex <= 0);
    moveDownBtn.title = 'Move Layer Down';
    moveDownBtn.innerHTML = `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>`;
    moveDownBtn.onclick = (e) => {
      e.stopPropagation();
      this.reorderLayer(origIndex, origIndex - 1);
    };

    // Delete Layer
    const delBtn = document.createElement('button');
    delBtn.className = 'p-0.5 rounded-[1px] hover:bg-[#383838] text-[#8c8c8c] hover:text-[#e53e3e] disabled:opacity-20';
    delBtn.disabled = (totalLayers <= 1);
    delBtn.title = 'Delete Layer';
    delBtn.innerHTML = `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
    delBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm(`Delete layer "${layer.name}"?`)) {
        this.deleteLayer(layer.id);
      }
    };

    actionsWrap.appendChild(moveUpBtn);
    actionsWrap.appendChild(moveDownBtn);
    actionsWrap.appendChild(delBtn);

    bottomRow.appendChild(opacityWrap);
    bottomRow.appendChild(actionsWrap);

    row.appendChild(topRow);
    row.appendChild(bottomRow);

    // Clicking row marks as edit
    row.onclick = () => {
      this.toggleEditTarget(layer, false);
    };

    return row;
  }

  toggleEditTarget(layer, multiSelect = false) {
    if (layer.locked) return;
    const layers = this.getActiveLayers();
    if (!multiSelect) {
      layers.forEach(l => l.isEditTarget = false);
      layer.isEditTarget = true;
    } else {
      layer.isEditTarget = !layer.isEditTarget;
    }
    this.render();
    if (this.callbacks.onEditTargetChange) {
      this.callbacks.onEditTargetChange(layer);
    }
  }

  addNewLayer() {
    const name = prompt('New Layer Name:', `Layer ${this.getActiveLayers().length + 1}`);
    if (!name || !name.trim()) return;

    const activeVariant = this.project.getActiveVariant();
    if (activeVariant) {
      const newLayer = this.project.masterSprite.addLayer(name.trim(), false);
      // Add as override
      activeVariant.layerOverrides.push(newLayer);
      newLayer.isEditTarget = true;
    } else {
      this.project.masterSprite.addLayer(name.trim(), true);
    }

    this.render();
    if (this.callbacks.onLayerChange) this.callbacks.onLayerChange();
  }

  deleteLayer(layerId) {
    const activeVariant = this.project.getActiveVariant();
    if (activeVariant) {
      const idx = activeVariant.layerOverrides.findIndex(l => l.id === layerId);
      if (idx !== -1) {
        activeVariant.layerOverrides.splice(idx, 1);
      }
    } else {
      this.project.masterSprite.removeLayer(layerId);
    }
    this.render();
    if (this.callbacks.onLayerChange) this.callbacks.onLayerChange();
  }

  reorderLayer(fromIdx, toIdx) {
    const activeVariant = this.project.getActiveVariant();
    if (activeVariant) {
      // Reorder overrides
      const [moved] = activeVariant.layerOverrides.splice(fromIdx, 1);
      if (moved) activeVariant.layerOverrides.splice(toIdx, 0, moved);
    } else {
      this.project.masterSprite.moveLayer(fromIdx, toIdx);
    }
    this.render();
    if (this.callbacks.onLayerChange) this.callbacks.onLayerChange();
  }

  refreshThumbnails() {
    // Quick update without full DOM re-render
    const layers = this.getActiveLayers();
    const canvases = this.container.querySelectorAll('canvas');
    if (canvases.length === layers.length) {
      const reversedLayers = [...layers].reverse();
      canvases.forEach((c, i) => {
        const l = reversedLayers[i];
        if (l) {
          const ctx = c.getContext('2d');
          ctx.clearRect(0, 0, 24, 24);
          ctx.drawImage(l.canvas, 0, 0, 24, 24);
        }
      });
    }
  }
}
