// Main Application Controller (Version 2)
// Coordinates Project Model, Motion Engine, Layers Panel, Variants Panel,
// Animation Manager, Timeline, Canvas Viewport, Exporters, and Native File Dialogs.

import { Project } from './project-model.js?v=2.2.3';
import { MotionEngine } from './motion-engine.js?v=2.2.3';
import { CanvasViewport } from './canvas-viewport.js?v=2.2.3';
import { Timeline } from './timeline.js?v=2.2.3';
import { LayersPanel } from './layers-panel.js?v=2.2.3';
import { VariantsPanel } from './variants-panel.js?v=2.2.3';
import { AnimationManager } from './animation-manager.js?v=2.2.3';
import { Exporters } from './exporters.js?v=2.2.3';
import { NativeFileSystem } from './file-system.js?v=2.2.3';
import { createDemoProject } from './demo-sprites.js?v=2.2.3';
import { SwatchesPanel } from './swatches-panel.js?v=2.2.3';

export class App {
  constructor() {
    // 1. Initialize default Demo Project with layers, animations, and variant
    this.project = createDemoProject();
    this.engine = new MotionEngine(this.project);
    this.exporters = new Exporters(this.engine);

    // History stack for Undo/Redo
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 30;

    this.initDOM();
    this.initSubsystems();
    this.bindTopBarActions();
    this.bindToolControls();
    this.bindColorControls();
    this.bindModals();
    this.setupGlobalShortcuts();

    // Push initial snapshot
    this.pushHistory();
  }

  initDOM() {
    this.canvasEl = document.getElementById('viewport-canvas');
    this.layersContainer = document.getElementById('layers-panel-container');
    this.variantsContainer = document.getElementById('variants-panel-container');
    this.animManagerContainer = document.getElementById('animation-manager-container');
    this.timelineContainer = document.getElementById('timeline-container');
  }

  initSubsystems() {
    // 1. Canvas Viewport
    this.viewport = new CanvasViewport(this.canvasEl, this.engine, {
      onStateChange: () => {
        this.timeline.refreshThumbnails();
        this.variantsPanel.renderAllPreviews();
        this.layersPanel.refreshThumbnails();
        this.updateHUD();
      },
      onHistoryPush: () => this.pushHistory(),
      onColorChange: (rgba, hex) => {
        const preview = document.getElementById('color-preview-circle');
        const label = document.getElementById('color-hex-label');
        const input = document.getElementById('input-color-picker');
        if (preview) preview.style.backgroundColor = hex;
        if (label) label.textContent = hex;
        if (input) input.value = hex;
        if (this.swatchesPanel) this.swatchesPanel.highlightColor(hex);
      }
    });

    // 2. Layers Panel
    this.layersPanel = new LayersPanel(this.layersContainer, this.project, this.engine, {
      onLayerChange: () => {
        this.viewport.render();
        this.timeline.refreshThumbnails();
        this.variantsPanel.renderAllPreviews();
        this.pushHistory();
      },
      onEditTargetChange: (layer) => {
        this.viewport.render();
        this.updateHUD();
      }
    });

    // 3. Variants Panel
    this.variantsPanel = new VariantsPanel(this.variantsContainer, this.project, this.engine, {
      onSelectVariant: (variant) => {
        this.layersPanel.render();
        this.timeline.refreshThumbnails();
        this.viewport.render();
        this.updateHUD();
      },
      onVariantChange: () => {
        this.layersPanel.render();
        this.timeline.refreshThumbnails();
        this.viewport.render();
        this.pushHistory();
      }
    });

    // 4. Animation Manager
    this.animManager = new AnimationManager(this.animManagerContainer, this.project, this.engine, {
      onClipChange: () => {
        this.timeline.refreshThumbnails();
        this.variantsPanel.renderAllPreviews();
        this.viewport.render();
        this.updateHUD();
      },
      onClipListUpdate: () => {
        this.timeline.refreshThumbnails();
        this.variantsPanel.renderAllPreviews();
        this.viewport.render();
        this.pushHistory();
        this.updateHUD();
      }
    });

    // 5. Timeline
    this.timeline = new Timeline(this.timelineContainer, this.engine, {
      onFrameChange: (idx) => {
        if (this.viewport.heldPixel) this.viewport.cancelHeldPixel();
        this.viewport.render();
        this.variantsPanel.renderCurrentFrame(idx);
        this.updateHUD();
      },
      onTimelineUpdate: () => {
        if (this.viewport.heldPixel) this.viewport.cancelHeldPixel();
        this.viewport.render();
        this.variantsPanel.renderCurrentFrame(this.engine.currentFrameIndex);
        this.pushHistory();
        this.updateHUD();
      }
    });

    // 6. Floating Custom Swatches Panel
    const toggleBtn = document.getElementById('btn-toggle-swatches-panel');
    this.swatchesPanel = new SwatchesPanel({
      viewport: this.viewport,
      project: this.project,
      engine: this.engine,
      onColorSelect: (hex) => {
        this.viewport.setColorHex(hex);
      },
      onToggleVisibility: (visible) => {
        if (toggleBtn) {
          if (visible) toggleBtn.classList.add('active');
          else toggleBtn.classList.remove('active');
        }
      }
    });

    this.updateHUD();
  }

  // --- Work Mode Toggle: Paint Layers vs Animate Clips ---
  setWorkMode(mode) {
    if (this.viewport.heldPixel) this.viewport.cancelHeldPixel();
    this.viewport.workMode = mode;
    const btnDesign = document.getElementById('btn-mode-design');
    const btnAnimate = document.getElementById('btn-mode-animate');

    if (mode === 'design') {
      btnDesign.className = 'dcc-segment-btn active';
      btnAnimate.className = 'dcc-segment-btn';
      this.setActiveTool('add_pixel');
    } else {
      btnAnimate.className = 'dcc-segment-btn active';
      btnDesign.className = 'dcc-segment-btn';
      this.setActiveTool('box_select');
    }
    this.viewport.render();
    this.updateHUD();
  }

  // --- Tool Switching ---
  setActiveTool(toolName) {
    if (this.viewport.heldPixel && toolName !== 'pick_place') {
      this.viewport.cancelHeldPixel();
    }
    this.viewport.activeTool = toolName;

    // Reset visual tool button styling
    const toolIds = [
      'tool-box_select', 'tool-lasso_select', 'tool-pin_warp',
      'tool-smear', 'tool-pick_place', 'tool-add_pixel',
      'tool-remove_pixel', 'tool-paint_bucket', 'tool-color_dropper'
    ];

    toolIds.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.className = 'dcc-tool-btn';
      }
    });

    const activeBtn = document.getElementById(`tool-${toolName}`);
    if (activeBtn) {
      activeBtn.className = 'dcc-tool-btn active';
    }

    // Toggle specific tool property sub-bars
    const brushPanel = document.getElementById('panel-brush-props');
    const pinPanel = document.getElementById('panel-pin-props');
    const pickPanel = document.getElementById('panel-pick-props');
    const fillPanel = document.getElementById('panel-fill-props');

    if (brushPanel) brushPanel.classList.toggle('hidden', toolName !== 'smear');
    if (pinPanel) pinPanel.classList.toggle('hidden', toolName !== 'pin_warp');
    if (fillPanel) fillPanel.classList.toggle('hidden', toolName !== 'paint_bucket');
    if (pickPanel) {
      pickPanel.classList.toggle('hidden', toolName !== 'pick_place');
      if (toolName === 'pick_place') {
        this.viewport.updatePickStatus();
      }
    }

    this.viewport.render();
  }

  bindToolControls() {
    const tools = [
      { id: 'tool-box_select', name: 'box_select' },
      { id: 'tool-lasso_select', name: 'lasso_select' },
      { id: 'tool-pin_warp', name: 'pin_warp' },
      { id: 'tool-smear', name: 'smear' },
      { id: 'tool-pick_place', name: 'pick_place' },
      { id: 'tool-add_pixel', name: 'add_pixel' },
      { id: 'tool-remove_pixel', name: 'remove_pixel' },
      { id: 'tool-paint_bucket', name: 'paint_bucket' },
      { id: 'tool-color_dropper', name: 'color_dropper' }
    ];

    tools.forEach(t => {
      const btn = document.getElementById(t.id);
      if (btn) {
        btn.addEventListener('click', () => this.setActiveTool(t.name));
      }
    });

    // Clear Frame / Layer button
    const clearBtn = document.getElementById('btn-clear-frame');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (this.viewport.workMode === 'design') {
          const editLayers = this.viewport.getActiveEditLayers();
          if (confirm(`Clear pixels on active layer(s)?`)) {
            editLayers.forEach(l => l.clear());
            this.pushHistory();
            this.viewport.render();
            this.timeline.refreshThumbnails();
            this.variantsPanel.renderAllPreviews();
          }
        } else {
          if (confirm(`Reset deformation offsets on current frame?`)) {
            this.engine.clearFrameMotion();
            this.pushHistory();
            this.viewport.render();
            this.timeline.refreshThumbnails();
            this.variantsPanel.renderAllPreviews();
          }
        }
      });
    }

    // Zoom Buttons
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      this.viewport.zoom = Math.min(this.viewport.maxZoom, this.viewport.zoom * 1.25);
      this.viewport.render();
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      this.viewport.zoom = Math.max(this.viewport.minZoom, this.viewport.zoom / 1.25);
      this.viewport.render();
    });
    document.getElementById('btn-zoom-fit')?.addEventListener('click', () => {
      this.viewport.centerView();
    });

    // Brush Radius & Pin Falloff
    const smearSlider = document.getElementById('input-brush-radius');
    const smearLabel = document.getElementById('val-brush-radius');
    if (smearSlider) {
      smearSlider.addEventListener('input', (e) => {
        this.viewport.brushRadius = parseInt(e.target.value, 10);
        if (smearLabel) smearLabel.textContent = `${this.viewport.brushRadius}px`;
        this.viewport.render();
      });
    }

    const pinSlider = document.getElementById('input-pin-radius');
    const pinLabel = document.getElementById('val-pin-radius');
    if (pinSlider) {
      pinSlider.addEventListener('input', (e) => {
        this.viewport.pinRadius = parseInt(e.target.value, 10);
        if (pinLabel) pinLabel.textContent = `${this.viewport.pinRadius}px`;
        this.viewport.render();
      });
    }

    // Fill Tolerance & Contiguous
    const fillTolSlider = document.getElementById('input-fill-tolerance');
    const fillTolLabel = document.getElementById('val-fill-tolerance');
    if (fillTolSlider) {
      fillTolSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.viewport.fillTolerance = isNaN(val) ? 25 : val;
        if (fillTolLabel) fillTolLabel.textContent = `${this.viewport.fillTolerance}`;
      });
    }

    const fillContigCheck = document.getElementById('input-fill-contiguous');
    if (fillContigCheck) {
      fillContigCheck.addEventListener('change', (e) => {
        this.viewport.fillContiguous = !!e.target.checked;
      });
    }

    // Brush Size
    const brushSizeSelect = document.getElementById('select-brush-size');
    if (brushSizeSelect) {
      brushSizeSelect.addEventListener('change', (e) => {
        this.viewport.brushSize = parseInt(e.target.value, 10) || 1;
        this.viewport.updatePickStatus();
        this.viewport.render();
      });
    }

    // View Toggles
    const gridToggle = document.getElementById('toggle-grid');
    if (gridToggle) {
      gridToggle.addEventListener('change', (e) => {
        this.viewport.showGrid = e.target.checked;
        this.viewport.render();
      });
    }

    const onionToggle = document.getElementById('toggle-onion');
    if (onionToggle) {
      onionToggle.addEventListener('change', (e) => {
        this.viewport.showOnionSkin = e.target.checked;
        this.viewport.render();
      });
    }
  }

  bindColorControls() {
    const colorPicker = document.getElementById('input-color-picker');
    if (colorPicker) {
      colorPicker.addEventListener('input', (e) => {
        this.viewport.setColorHex(e.target.value);
      });
    }

    document.getElementById('btn-quick-dropper')?.addEventListener('click', () => {
      this.setActiveTool('color_dropper');
    });

    // Pre-populate swatches strip
    const palette = [
      '#0f172a', '#334155', '#64748b', '#94a3b8', '#ffffff',
      '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6',
      '#6366f1', '#8b5cf6', '#ec4899', '#78350f', '#d97706'
    ];
    const swatchesContainer = document.getElementById('palette-swatches-strip');
    if (swatchesContainer) {
      palette.forEach(hex => {
        const swatch = document.createElement('button');
        swatch.className = 'w-4 h-4 rounded-md border border-white/20 hover:scale-125 transition-transform flex-shrink-0';
        swatch.style.backgroundColor = hex;
        swatch.title = hex;
        swatch.onclick = () => this.viewport.setColorHex(hex);
        swatchesContainer.appendChild(swatch);
      });
    }

    document.getElementById('btn-toggle-swatches-panel')?.addEventListener('click', () => {
      this.swatchesPanel?.toggle();
    });
  }

  bindTopBarActions() {
    // Mode Switcher Buttons
    document.getElementById('btn-mode-design')?.addEventListener('click', () => this.setWorkMode('design'));
    document.getElementById('btn-mode-animate')?.addEventListener('click', () => this.setWorkMode('animate'));

    // Save Project As... (Native File Dialog)
    document.getElementById('btn-save-project-as')?.addEventListener('click', async () => {
      const res = await this.exporters.saveProjectAs();
      if (res && res.success) {
        alert(`Project successfully saved as: ${res.filename}`);
      }
    });

    // Open Project (Native File Dialog)
    document.getElementById('btn-open-project')?.addEventListener('click', async () => {
      const file = await NativeFileSystem.openFile([
        { description: 'Sprite Studio V2 Project', accept: { 'application/json': ['.spv2.json', '.json'] } }
      ]);
      if (file) {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          const loadedProject = await Project.fromJSON(data);
          this.loadProject(loadedProject);
          alert(`Successfully opened project: ${loadedProject.name}`);
        } catch (err) {
          console.error('Failed to open project:', err);
          alert('Error loading project file: ' + err.message);
        }
      }
    });

    // Undo / Redo
    document.getElementById('btn-undo')?.addEventListener('click', () => this.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.redo());

    // UI Scale Setup (default 150%, selectable via View menu or top bar)
    this.initUIScale();
  }

  initUIScale() {
    const savedScale = localStorage.getItem('spv2_ui_scale');
    const scale = savedScale ? parseFloat(savedScale) : 1.5; // Default 1.5 = 50% bigger
    this.setUIScale(isNaN(scale) ? 1.5 : scale, false);

    // Bind click events on View menu UI Scale items
    document.querySelectorAll('.menu-ui-scale').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const sc = parseFloat(item.getAttribute('data-scale'));
        if (!isNaN(sc)) {
          this.setUIScale(sc, true);
        }
        // Close menu dropdown
        document.querySelectorAll('.dcc-dropdown-menu').forEach(d => d.classList.remove('show'));
        document.querySelectorAll('.dcc-menu-item').forEach(m => m.classList.remove('active'));
      });
    });

    // Quick toggle button on top bar to cycle through scales
    document.getElementById('btn-toggle-scale')?.addEventListener('click', () => {
      const scales = [1.0, 1.25, 1.5, 1.75, 2.0];
      const currentIdx = scales.findIndex(s => Math.abs(s - (this.uiScale || 1.5)) < 0.01);
      const nextScale = scales[(currentIdx + 1) % scales.length];
      this.setUIScale(nextScale, true);
    });
  }

  setUIScale(scale, save = true) {
    this.uiScale = scale;
    document.documentElement.style.setProperty('--ui-scale', scale.toString());
    if (save) {
      localStorage.setItem('spv2_ui_scale', scale.toString());
    }

    // Update label in top bar
    const label = document.getElementById('label-current-scale');
    if (label) {
      label.textContent = `${Math.round(scale * 100)}%`;
    }

    // Update checkmarks in View menu
    document.querySelectorAll('.menu-ui-scale').forEach(item => {
      const sc = parseFloat(item.getAttribute('data-scale'));
      const checkEl = item.querySelector('.scale-check');
      if (checkEl) {
        if (Math.abs(sc - scale) < 0.01) {
          checkEl.textContent = '✓';
          checkEl.className = 'scale-check shortcut text-[#00a8e8] font-bold';
        } else {
          checkEl.textContent = '';
          checkEl.className = 'scale-check shortcut';
        }
      }
    });

    // Notify canvas and responsive layout
    window.dispatchEvent(new Event('resize'));
    if (this.viewport) {
      this.viewport.resizeCanvas();
    }
  }

  loadProject(newProject) {
    this.project = newProject;
    this.engine.project = newProject;
    this.engine.currentFrameIndex = 0;
    this.layersPanel.setProject(newProject);
    this.variantsPanel.setProject(newProject);
    this.animManager.setProject(newProject);
    this.swatchesPanel?.setProject(newProject, this.engine);
    this.viewport.centerView();
    this.viewport.render();
    this.timeline.refreshThumbnails();
    this.variantsPanel.renderAllPreviews();
    this.updateHUD();
    this.undoStack = [];
    this.redoStack = [];
    this.pushHistory();
  }

  bindModals() {
    // New Project Modal
    const newModal = document.getElementById('modal-new-project');
    const openNewBtn = document.getElementById('btn-open-new-modal');
    const closeNewBtn = document.getElementById('btn-close-new-modal');
    const cancelNewBtn = document.getElementById('btn-cancel-new-modal');
    const createNewBtn = document.getElementById('btn-create-new-project');

    const widthInput = document.getElementById('input-new-width');
    const heightInput = document.getElementById('input-new-height');
    const nameInput = document.getElementById('input-new-project-name');

    openNewBtn?.addEventListener('click', () => newModal?.classList.remove('hidden'));
    closeNewBtn?.addEventListener('click', () => newModal?.classList.add('hidden'));
    cancelNewBtn?.addEventListener('click', () => newModal?.classList.add('hidden'));

    // Preset size buttons in new modal
    document.querySelectorAll('.btn-preset-size').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-preset-size').forEach(b => {
          b.className = 'btn-preset-size dcc-preset-btn';
        });
        btn.className = 'btn-preset-size dcc-preset-btn active';
        if (widthInput) widthInput.value = btn.dataset.w;
        if (heightInput) heightInput.value = btn.dataset.h;
      });
    });

    createNewBtn?.addEventListener('click', () => {
      const w = parseInt(widthInput.value, 10) || 32;
      const h = parseInt(heightInput.value, 10) || 32;
      const name = nameInput.value.trim() || 'New Character';

      const freshProject = new Project(name, w, h);
      this.loadProject(freshProject);
      newModal?.classList.add('hidden');
    });

    // Export Modal
    const exportModal = document.getElementById('modal-export');
    const openExportBtn = document.getElementById('btn-open-export');
    const closeExportBtn = document.getElementById('btn-close-export');

    openExportBtn?.addEventListener('click', () => {
      const activeChar = this.project.getActiveVariant();
      const label = document.getElementById('export-active-character-label');
      if (label) {
        label.textContent = `Export: ${activeChar ? activeChar.name : 'Master Sprite'} (${this.project.getActiveClip()?.name || 'Clip'})`;
      }
      exportModal?.classList.remove('hidden');
    });
    closeExportBtn?.addEventListener('click', () => exportModal?.classList.add('hidden'));

    // Export Action Buttons with Native Save As
    document.getElementById('btn-export-sheet-png')?.addEventListener('click', async () => {
      const scale = parseInt(document.getElementById('select-export-scale')?.value, 10) || 4;
      const layout = document.getElementById('select-export-layout')?.value || 'horizontal';
      const char = this.project.getActiveVariant() || null;
      const clip = this.project.getActiveClip();
      await this.exporters.exportSpritesheet(char, clip, layout, scale);
      exportModal?.classList.add('hidden');
    });

    document.getElementById('btn-export-gif')?.addEventListener('click', async () => {
      const scale = parseInt(document.getElementById('select-export-scale')?.value, 10) || 4;
      const char = this.project.getActiveVariant() || null;
      const clip = this.project.getActiveClip();
      await this.exporters.exportGif(char, clip, scale);
      exportModal?.classList.add('hidden');
    });

    document.getElementById('btn-export-frames-zip')?.addEventListener('click', async () => {
      const scale = parseInt(document.getElementById('select-export-scale')?.value, 10) || 4;
      const char = this.project.getActiveVariant() || null;
      const clip = this.project.getActiveClip();
      await this.exporters.exportFramesZip(char, clip, scale);
      exportModal?.classList.add('hidden');
    });

    document.getElementById('btn-modal-batch-all')?.addEventListener('click', async () => {
      const scale = parseInt(document.getElementById('select-export-scale')?.value, 10) || 4;
      await this.exporters.batchExportZip('all', scale);
      exportModal?.classList.add('hidden');
    });

    // Help Modal
    const helpModal = document.getElementById('modal-help');
    document.getElementById('btn-open-help')?.addEventListener('click', () => helpModal?.classList.remove('hidden'));
    document.getElementById('btn-close-help')?.addEventListener('click', () => helpModal?.classList.add('hidden'));
  }

  // --- Undo / Redo History ---
  async pushHistory() {
    try {
      const snapshot = await this.project.toJSON();
      this.undoStack.push(JSON.stringify(snapshot));
      if (this.undoStack.length > this.maxHistory) {
        this.undoStack.shift();
      }
      this.redoStack = [];
      this.updateUndoRedoButtons();
    } catch (e) {
      console.warn('History push failed:', e);
    }
  }

  async undo() {
    if (this.viewport?.heldPixel) this.viewport.cancelHeldPixel();
    if (this.undoStack.length <= 1) return;
    const current = this.undoStack.pop();
    this.redoStack.push(current);
    const prevSnapshotStr = this.undoStack[this.undoStack.length - 1];
    if (prevSnapshotStr) {
      const data = JSON.parse(prevSnapshotStr);
      this.project = await Project.fromJSON(data);
      this.engine.project = this.project;
      this.layersPanel.setProject(this.project);
      this.variantsPanel.setProject(this.project);
      this.animManager.setProject(this.project);
      this.swatchesPanel?.setProject(this.project, this.engine);
      this.viewport.render();
      this.timeline.refreshThumbnails();
      this.variantsPanel.renderAllPreviews();
      this.updateHUD();
      this.updateUndoRedoButtons();
    }
  }

  async redo() {
    if (this.viewport?.heldPixel) this.viewport.cancelHeldPixel();
    if (this.redoStack.length === 0) return;
    const nextSnapshotStr = this.redoStack.pop();
    this.undoStack.push(nextSnapshotStr);
    const data = JSON.parse(nextSnapshotStr);
    this.project = await Project.fromJSON(data);
    this.engine.project = this.project;
    this.layersPanel.setProject(this.project);
    this.variantsPanel.setProject(this.project);
    this.animManager.setProject(this.project);
    this.swatchesPanel?.setProject(this.project, this.engine);
    this.viewport.render();
    this.timeline.refreshThumbnails();
    this.variantsPanel.renderAllPreviews();
    this.updateHUD();
    this.updateUndoRedoButtons();
  }

  updateUndoRedoButtons() {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = (this.undoStack.length <= 1);
    if (redoBtn) redoBtn.disabled = (this.redoStack.length === 0);
  }

  updateHUD() {
    const frameHud = document.getElementById('hud-frame-info');
    const clip = this.project?.getActiveClip();
    if (frameHud && clip) {
      frameHud.textContent = `Frame ${this.engine.currentFrameIndex + 1} / ${clip.frames.length}`;
    }
    this.viewport?.renderViewportHUD();
  }

  setupGlobalShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      // Undo / Redo
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undo();
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
        return;
      }

      // Escape: Deselect or cancel held pixel
      if (e.key === 'Escape') {
        if (this.viewport.heldPixel) {
          this.viewport.cancelHeldPixel();
        } else if (this.viewport.selectionMask) {
          this.viewport.selectionMask = null;
          this.viewport.selectionBounds = null;
          this.viewport.render();
        }
        return;
      }

      // Tool shortcuts
      if (e.key === '1') this.setActiveTool('box_select');
      else if (e.key === '2') this.setActiveTool('lasso_select');
      else if (e.key === '3') this.setActiveTool('pin_warp');
      else if (e.key === '4') this.setActiveTool('smear');
      else if (e.key === '6') this.setActiveTool('pick_place');
      else if (e.key === '7') this.setActiveTool('add_pixel');
      else if (e.key === '8') this.setActiveTool('remove_pixel');
      else if (e.key.toLowerCase() === 'b') this.setActiveTool('paint_bucket');
      else if (e.key === '9') this.setActiveTool('color_dropper');
      else if (e.key.toLowerCase() === 'p') this.swatchesPanel?.toggle();

      // Brush Size Shortcuts: [ and ]
      if (e.key === '[' || e.key === ']') {
        const sizes = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
        let curIdx = sizes.indexOf(this.viewport.brushSize);
        if (curIdx === -1) curIdx = 0;
        if (e.key === '[') curIdx = Math.max(0, curIdx - 1);
        if (e.key === ']') curIdx = Math.min(sizes.length - 1, curIdx + 1);
        const newSize = sizes[curIdx];
        this.viewport.brushSize = newSize;
        const brushSizeSelect = document.getElementById('select-brush-size');
        if (brushSizeSelect) brushSizeSelect.value = newSize.toString();
        this.viewport.updatePickStatus();
        this.viewport.render();
      }
    });
  }
}

// Bootstrap on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
