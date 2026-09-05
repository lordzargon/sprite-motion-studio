// Main Application Controller
import { MotionEngine, MotionFrame } from './motion-engine.js';
import { CanvasViewport } from './canvas-viewport.js';
import { Timeline } from './timeline.js';
import { TargetSpritesDeck } from './target-sprites.js';
import { Exporters } from './exporters.js';
import { createDemoSprites } from './demo-sprites.js';
import { getBuiltinPresets } from './presets.js';

export class App {
  constructor() {
    this.engine = new MotionEngine(32, 32);
    this.exporters = new Exporters(this.engine);

    // History stack for Undo/Redo
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 30;

    this.initDOM();
    this.initSubsystems();
    this.loadInitialDemoData();
    this.setupGlobalShortcuts();
  }

  initDOM() {
    this.canvasEl = document.getElementById('viewport-canvas');
    this.timelineContainer = document.getElementById('timeline-container');
    this.targetDeckContainer = document.getElementById('target-deck-container');
  }

  initSubsystems() {
    // 1. Canvas Viewport
    this.viewport = new CanvasViewport(this.canvasEl, this.engine, {
      onStateChange: () => {
        this.timeline.refreshThumbnails();
        this.targetDeck.renderCurrentFrame(this.engine.currentFrameIndex);
        this.updatePickPlaceHUD();
      },
      onHistoryPush: () => this.pushHistory(),
      onColorChange: (rgba, hex) => {
        const preview = document.getElementById('color-preview-circle');
        const label = document.getElementById('color-hex-label');
        const input = document.getElementById('input-color-picker');
        if (preview) preview.style.backgroundColor = hex;
        if (label) label.textContent = hex;
        if (input) input.value = hex;
      }
    });

    // 2. Timeline
    this.timeline = new Timeline(this.timelineContainer, this.engine, {
      getBaseImage: () => this.viewport.baseImage,
      onFrameChange: (idx) => {
        if (this.viewport) this.viewport.heldPixel = null;
        this.viewport.render();
        this.targetDeck.renderCurrentFrame(idx);
        this.updateHUD();
        this.updatePickPlaceHUD();
      },
      onTimelineUpdate: () => {
        if (this.viewport) this.viewport.heldPixel = null;
        this.viewport.render();
        this.targetDeck.renderCurrentFrame(this.engine.currentFrameIndex);
        this.pushHistory();
        this.updatePickPlaceHUD();
      }
    });

    // 3. Target Sprites Deck
    this.targetDeck = new TargetSpritesDeck(this.targetDeckContainer, this.engine, {
      onExportSingle: (sprite, type) => {
        const scale = (typeof getExportScale === 'function') ? getExportScale() : (parseInt(document.getElementById('select-export-scale')?.value, 10) || 4);
        const layout = document.getElementById('select-export-layout')?.value || 'horizontal';
        if (type === 'spritesheet') {
          this.exporters.exportSpritesheet(sprite.img, sprite.name, layout, scale);
        } else if (type === 'gif') {
          this.exporters.exportGif(sprite.img, sprite.name, scale);
        } else if (type === 'frames') {
          const frames = this.exporters.generateFrameCanvases(sprite.img, scale);
          frames.forEach(f => {
            f.canvas.toBlob(b => Exporters.downloadFile(b, `${sprite.name}_${f.filename}`), 'image/png');
          });
        }
      },
      onBatchExport: (type) => {
        const scale = (typeof getExportScale === 'function') ? getExportScale() : (parseInt(document.getElementById('select-export-scale')?.value, 10) || 4);
        this.exporters.batchExportZip(this.targetDeck.targetSprites, this.viewport.baseImage, type, scale);
      }
    });

    this.bindToolControls();
    this.bindColorControls();
    this.bindTopBarActions();
  }

  // Undo / Redo System
  pushHistory() {
    const state = JSON.stringify(this.engine.exportToJson('history_state'));
    this.undoStack.push(state);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = []; // clear redo on new action
    this.updateUndoRedoButtons();
  }

  undo() {
    if (this.undoStack.length === 0) return;
    if (this.viewport) this.viewport.heldPixel = null;
    const currentState = JSON.stringify(this.engine.exportToJson('history_state'));
    this.redoStack.push(currentState);
    const prevState = JSON.parse(this.undoStack.pop());
    this.engine.loadFromJson(prevState);
    this.timeline.renderTimelineUI();
    this.viewport.render();
    this.targetDeck.renderCurrentFrame(this.engine.currentFrameIndex);
    this.updateUndoRedoButtons();
    this.updatePickPlaceHUD();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    if (this.viewport) this.viewport.heldPixel = null;
    const currentState = JSON.stringify(this.engine.exportToJson('history_state'));
    this.undoStack.push(currentState);
    const nextState = JSON.parse(this.redoStack.pop());
    this.engine.loadFromJson(nextState);
    this.timeline.renderTimelineUI();
    this.viewport.render();
    this.targetDeck.renderCurrentFrame(this.engine.currentFrameIndex);
    this.updateUndoRedoButtons();
    this.updatePickPlaceHUD();
  }

  updateUndoRedoButtons() {
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    if (btnUndo) btnUndo.disabled = this.undoStack.length === 0;
    if (btnRedo) btnRedo.disabled = this.redoStack.length === 0;
  }

  // Load demo sprites and initial preset
  loadInitialDemoData() {
    const demoSprites = createDemoSprites();
    const presets = getBuiltinPresets();

    // Set Knight as base sprite
    const knight = demoSprites.find(s => s.isBase);
    if (knight) {
      const img = new Image();
      img.onload = () => {
        this.viewport.setBaseImage(img, knight.width, knight.height);
        this.extractBaseSpritePalette(img);
        this.timeline.refreshThumbnails();

        // Add remaining demo sprites as targets
        demoSprites.filter(s => !s.isBase).forEach(tgt => {
          const tImg = new Image();
          tImg.onload = () => {
            this.targetDeck.addTargetSprite(tgt.name, tImg, tgt.id);
          };
          tImg.src = tgt.dataUrl;
        });

        // Apply first preset (Idle Breathe)
        this.applyPreset(presets[0]);
      };
      img.src = knight.dataUrl;
    }
  }

  extractBaseSpritePalette(img) {
    try {
      const cvs = document.createElement('canvas');
      const w = img.naturalWidth || img.width || 32;
      const h = img.naturalHeight || img.height || 32;
      cvs.width = w;
      cvs.height = h;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const colorCounts = new Map();

      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 30) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
          colorCounts.set(hex, (colorCounts.get(hex) || 0) + 1);
        }
      }

      // Sort by frequency
      const extracted = Array.from(colorCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(entry => entry[0]);

      // Standard palette
      const standard = ['#ffffff', '#000000', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#ec4899', '#92400e'];
      const combined = Array.from(new Set([...extracted, ...standard]));
      this.populateSwatches(combined);
    } catch (e) {
      this.populateSwatches(['#ffffff', '#000000', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#ec4899', '#92400e']);
    }
  }

  populateSwatches(colors) {
    const strip = document.getElementById('palette-swatches-strip');
    if (!strip) return;
    strip.innerHTML = '';
    colors.forEach(hex => {
      const swatch = document.createElement('button');
      swatch.className = 'w-3.5 h-3.5 rounded-sm border border-white/20 hover:scale-125 transition-transform flex-shrink-0 cursor-pointer shadow-sm';
      swatch.style.backgroundColor = hex;
      swatch.title = hex;
      swatch.addEventListener('click', () => {
        this.viewport.setColorHex(hex);
      });
      strip.appendChild(swatch);
    });
  }

  bindColorControls() {
    const colorPickerInput = document.getElementById('input-color-picker');
    if (colorPickerInput) {
      colorPickerInput.addEventListener('input', (e) => {
        this.viewport.setColorHex(e.target.value);
      });
    }

    const quickDropper = document.getElementById('btn-quick-dropper');
    if (quickDropper) {
      quickDropper.addEventListener('click', () => {
        document.getElementById('tool-color_dropper')?.click();
      });
    }

    const brushSizeSelect = document.getElementById('select-brush-size');
    if (brushSizeSelect) {
      brushSizeSelect.addEventListener('change', (e) => {
        this.viewport.brushSize = parseInt(e.target.value, 10) || 1;
      });
    }

    this.populateSwatches(['#ffffff', '#000000', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#ec4899', '#92400e']);
  }

  applyPreset(preset) {
    if (!preset) return;
    if (this.viewport) this.viewport.heldPixel = null;
    this.engine.fps = preset.fps;
    this.engine.loop = preset.loop;
    const rawFrames = preset.createFrames(this.viewport.spriteWidth, this.viewport.spriteHeight);

    this.engine.frames = rawFrames.map((fData, idx) => {
      return MotionFrame.fromJSON(fData, this.viewport.spriteWidth, this.viewport.spriteHeight, fData.name || `Frame ${idx + 1}`);
    });
    this.engine.currentFrameIndex = 0;

    this.timeline.renderTimelineUI();
    this.viewport.render();
    this.targetDeck.renderCurrentFrame(0);
    this.pushHistory();
    this.updatePickPlaceHUD();
  }

  bindToolControls() {
    const tools = ['box_select', 'lasso_select', 'pin_warp', 'smear', 'nudge', 'pick_place', 'add_pixel', 'remove_pixel', 'color_dropper', 'pan'];

    const setActiveTool = (toolName) => {
      if (this.viewport.activeTool === 'pick_place' && toolName !== 'pick_place') {
        this.viewport.cancelPixelPickup();
      }
      this.viewport.activeTool = toolName;
      tools.forEach(t => {
        const btn = document.getElementById(`tool-${t}`);
        if (btn) {
          if (t === toolName) {
            btn.classList.add('bg-indigo-600', 'text-white', 'shadow-md', 'shadow-indigo-600/30');
            btn.classList.remove('text-slate-400', 'hover:bg-slate-800');
          } else {
            btn.classList.remove('bg-indigo-600', 'text-white', 'shadow-md', 'shadow-indigo-600/30');
            btn.classList.add('text-slate-400', 'hover:bg-slate-800');
          }
        }
      });

      // Show/hide relevant tool property panels
      const brushProps = document.getElementById('panel-brush-props');
      const pinProps = document.getElementById('panel-pin-props');
      const pickProps = document.getElementById('panel-pick-props');
      const tipGeneral = document.getElementById('tip-general');

      if (brushProps) brushProps.classList.toggle('hidden', toolName !== 'smear');
      if (pinProps) pinProps.classList.toggle('hidden', toolName !== 'pin_warp');
      if (pickProps) pickProps.classList.toggle('hidden', toolName !== 'pick_place');
      if (tipGeneral) tipGeneral.classList.toggle('hidden', toolName === 'smear' || toolName === 'pin_warp' || toolName === 'pick_place');

      this.updatePickPlaceHUD();
      this.viewport.render();
    };

    tools.forEach(t => {
      const btn = document.getElementById(`tool-${t}`);
      if (btn) {
        btn.addEventListener('click', () => setActiveTool(t));
      }
    });

    // Brush controls
    const brushRadiusInput = document.getElementById('input-brush-radius');
    if (brushRadiusInput) {
      brushRadiusInput.addEventListener('input', (e) => {
        this.viewport.brushRadius = parseFloat(e.target.value);
        document.getElementById('val-brush-radius').textContent = `${e.target.value}px`;
      });
    }

    // Pin controls
    const pinRadiusInput = document.getElementById('input-pin-radius');
    if (pinRadiusInput) {
      pinRadiusInput.addEventListener('input', (e) => {
        this.viewport.pinRadius = parseFloat(e.target.value);
        document.getElementById('val-pin-radius').textContent = `${e.target.value}px`;
      });
    }

    // View toggles
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

    // Clear frame button
    const btnClearFrame = document.getElementById('btn-clear-frame');
    if (btnClearFrame) {
      btnClearFrame.addEventListener('click', () => {
        this.pushHistory();
        this.engine.getCurrentFrame().clear();
        this.viewport.clearSelection();
        this.viewport.render();
        this.timeline.refreshThumbnails();
        this.targetDeck.renderCurrentFrame(this.engine.currentFrameIndex);
      });
    }

    // Zoom buttons
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      this.viewport.zoom = Math.min(64, this.viewport.zoom * 1.5);
      this.viewport.render();
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      this.viewport.zoom = Math.max(1, this.viewport.zoom / 1.5);
      this.viewport.render();
    });
    document.getElementById('btn-zoom-fit')?.addEventListener('click', () => {
      this.viewport.centerView();
      this.viewport.render();
    });
  }

  bindTopBarActions() {
    // 1. Upload Base Sprite
    const baseInput = document.getElementById('input-base-sprite');
    if (baseInput) {
      baseInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const img = new Image();
            img.onload = () => {
              this.viewport.setBaseImage(img);
              this.extractBaseSpritePalette(img);
              this.timeline.refreshThumbnails();
              this.targetDeck.renderCurrentFrame(this.engine.currentFrameIndex);
            };
            img.src = evt.target.result;
          };
          reader.readAsDataURL(file);
        }
        baseInput.value = '';
      });
    }

    // 2. Preset Select Dropdown
    const presetSelect = document.getElementById('select-preset');
    if (presetSelect) {
      const presets = getBuiltinPresets();
      presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        presetSelect.appendChild(opt);
      });
      presetSelect.addEventListener('change', (e) => {
        const found = presets.find(p => p.id === e.target.value);
        if (found) this.applyPreset(found);
      });
    }

    // 3. Export Preset JSON
    document.getElementById('btn-export-preset')?.addEventListener('click', () => {
      const name = prompt('Enter animation preset name:', 'my_sprite_animation') || 'sprite_animation';
      this.exporters.exportMotionPreset(name);
    });

    // 4. Load Preset JSON
    const loadPresetInput = document.getElementById('input-load-preset');
    if (loadPresetInput) {
      loadPresetInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            try {
              const data = JSON.parse(evt.target.result);
              this.engine.loadFromJson(data);
              this.timeline.renderTimelineUI();
              this.viewport.render();
              this.targetDeck.renderCurrentFrame(this.engine.currentFrameIndex);
              this.pushHistory();
            } catch (err) {
              alert('Error parsing .spritemotion.json: ' + err.message);
            }
          };
          reader.readAsText(file);
        }
        loadPresetInput.value = '';
      });
    }

    // 5. Sampling Mode toggle (Pixel Art vs Smooth Bilinear)
    const samplingModeSelect = document.getElementById('select-sampling-mode');
    if (samplingModeSelect) {
      samplingModeSelect.addEventListener('change', (e) => {
        this.engine.samplingMode = e.target.value;
        this.viewport.render();
        this.targetDeck.renderCurrentFrame(this.engine.currentFrameIndex);
      });
    }

    // 6. Undo / Redo
    document.getElementById('btn-undo')?.addEventListener('click', () => this.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.redo());

    // 7. Export Modal Toggle & Actions
    const exportModal = document.getElementById('modal-export');
    const exportTargetLabel = document.getElementById('export-target-count-label');

    const getExportScale = () => {
      const el = document.getElementById('select-export-scale');
      return el ? parseInt(el.value, 10) || 1 : 1;
    };

    const getExportLayout = () => {
      const el = document.getElementById('select-export-layout');
      return el ? el.value || 'horizontal' : 'horizontal';
    };

    document.getElementById('btn-open-export')?.addEventListener('click', () => {
      if (exportTargetLabel) {
        const count = this.targetDeck.targetSprites.length;
        exportTargetLabel.textContent = `${count} target sprite${count === 1 ? '' : 's'}`;
      }
      exportModal.classList.remove('hidden');
    });

    document.getElementById('btn-close-export')?.addEventListener('click', () => {
      exportModal.classList.add('hidden');
    });

    // Base Sprite Exports from Modal
    document.getElementById('btn-export-base-frames-zip')?.addEventListener('click', () => {
      if (this.viewport.baseImage) {
        this.exporters.exportFramesZip(this.viewport.baseImage, 'base_sprite', getExportScale());
      }
    });

    document.getElementById('btn-export-base-sheet-png')?.addEventListener('click', () => {
      if (this.viewport.baseImage) {
        this.exporters.exportSpritesheet(this.viewport.baseImage, 'base_sprite', getExportLayout(), getExportScale());
      }
    });

    document.getElementById('btn-export-base-gif')?.addEventListener('click', () => {
      if (this.viewport.baseImage) {
        this.exporters.exportGif(this.viewport.baseImage, 'base_sprite', getExportScale());
      }
    });

    // Batch Exports from Modal
    document.getElementById('btn-modal-batch-sheets')?.addEventListener('click', () => {
      this.exporters.batchExportZip(this.targetDeck.targetSprites, this.viewport.baseImage, 'spritesheet', getExportScale());
    });

    document.getElementById('btn-modal-batch-frames')?.addEventListener('click', () => {
      this.exporters.batchExportZip(this.targetDeck.targetSprites, this.viewport.baseImage, 'frames', getExportScale());
    });

    document.getElementById('btn-modal-batch-gifs')?.addEventListener('click', () => {
      this.exporters.batchExportZip(this.targetDeck.targetSprites, this.viewport.baseImage, 'gif', getExportScale());
    });

    document.getElementById('btn-modal-export-preset')?.addEventListener('click', () => {
      const name = prompt('Enter animation preset name:', 'my_sprite_animation') || 'sprite_animation';
      this.exporters.exportMotionPreset(name);
    });

    // 8. Help Modal Toggle
    const helpModal = document.getElementById('modal-help');
    document.getElementById('btn-open-help')?.addEventListener('click', () => {
      helpModal.classList.remove('hidden');
    });
    document.getElementById('btn-close-help')?.addEventListener('click', () => {
      helpModal.classList.add('hidden');
    });
  }

  setupGlobalShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if (e.key === '1') {
        document.getElementById('tool-box_select')?.click();
      } else if (e.key === '2') {
        document.getElementById('tool-lasso_select')?.click();
      } else if (e.key === '3') {
        document.getElementById('tool-pin_warp')?.click();
      } else if (e.key === '4') {
        document.getElementById('tool-smear')?.click();
      } else if (e.key === '5') {
        document.getElementById('tool-nudge')?.click();
      } else if (e.key === '6') {
        document.getElementById('tool-pick_place')?.click();
      } else if (e.key === '7') {
        document.getElementById('tool-add_pixel')?.click();
      } else if (e.key === '8') {
        document.getElementById('tool-remove_pixel')?.click();
      } else if (e.key === '9') {
        document.getElementById('tool-color_dropper')?.click();
      }
    });
  }

  updateHUD() {
    const frameLabel = document.getElementById('hud-frame-info');
    if (frameLabel) {
      const cur = this.engine.currentFrameIndex + 1;
      const total = this.engine.frames.length;
      frameLabel.textContent = `Frame ${cur} / ${total}`;
    }
  }

  updatePickPlaceHUD() {
    const dot = document.getElementById('pick-status-dot');
    const status = document.getElementById('val-pick-status');
    if (this.viewport && this.viewport.heldPixel) {
      if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
      if (status) status.textContent = `Pixel held [x:${this.viewport.heldPixel.origSourceX}, y:${this.viewport.heldPixel.origSourceY}] — Click down to place / swap`;
    } else {
      if (dot) dot.className = 'w-2 h-2 rounded-full bg-slate-500';
      if (status) status.textContent = 'Click pixel to pick up';
    }
  }
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
