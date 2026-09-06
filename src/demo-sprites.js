// Built-in pixel art generator for demo sprites & V2 Master Project
import { Project } from './project-model.js?v=2.1.0';

export function createDemoProject() {
  const project = new Project('Knight Champion', 32, 32);
  project.masterSprite.layers = []; // clear initial default

  const rect = (ctx, color, x, y, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };

  // 1. Layer: Legs & Boots (bottom layer)
  const legsLayer = project.masterSprite.addLayer('Legs & Boots', false);
  rect(legsLayer.ctx, '#334155', 12, 21, 3, 6);
  rect(legsLayer.ctx, '#334155', 17, 21, 3, 6);
  rect(legsLayer.ctx, '#1e293b', 11, 26, 4, 3);
  rect(legsLayer.ctx, '#1e293b', 17, 26, 4, 3);

  // 2. Layer: Torso & Armor
  const torsoLayer = project.masterSprite.addLayer('Torso & Armor', false);
  rect(torsoLayer.ctx, '#475569', 11, 11, 10, 9);
  rect(torsoLayer.ctx, '#cbd5e1', 13, 12, 6, 7);
  rect(torsoLayer.ctx, '#d97706', 12, 19, 8, 2);

  // 3. Layer: Head & Plume
  const headLayer = project.masterSprite.addLayer('Head & Plume', false);
  rect(headLayer.ctx, '#64748b', 12, 4, 8, 7);
  rect(headLayer.ctx, '#94a3b8', 13, 5, 6, 2);
  rect(headLayer.ctx, '#0f172a', 13, 8, 6, 2);
  rect(headLayer.ctx, '#f59e0b', 15, 3, 2, 2);

  // 4. Layer: Left Arm & Shield
  const shieldLayer = project.masterSprite.addLayer('Left Arm & Shield', false);
  rect(shieldLayer.ctx, '#64748b', 8, 12, 3, 7);
  rect(shieldLayer.ctx, '#3b82f6', 6, 13, 4, 8);
  rect(shieldLayer.ctx, '#fbbf24', 7, 15, 2, 4);

  // 5. Layer: Right Arm & Sword (top layer, default edit target)
  const swordLayer = project.masterSprite.addLayer('Right Arm & Sword', true);
  rect(swordLayer.ctx, '#64748b', 21, 12, 3, 6);
  rect(swordLayer.ctx, '#78350f', 22, 17, 2, 3);
  rect(swordLayer.ctx, '#f59e0b', 20, 16, 6, 2);
  rect(swordLayer.ctx, '#e2e8f0', 22, 6, 2, 10);

  // Animation Clips:
  // 1. Idle (Breathing bob)
  const idleClip = project.getActiveClip();
  idleClip.name = 'Idle';
  // Frame 2 & 3: Torso and Head bob down 1px
  const shiftDownMask = (disp, W, H, fromY, toY, fromX, toX) => {
    for (let y = fromY; y <= toY; y++) {
      for (let x = fromX; x <= toX; x++) {
        const idx = (y * W + x) * 2;
        disp[idx] = 0;
        disp[idx + 1] = 1; // shift down 1px
      }
    }
  };

  const f2Torso = idleClip.frames[1].getDisplacement(torsoLayer.id);
  const f2Head = idleClip.frames[1].getDisplacement(headLayer.id);
  const f2Shield = idleClip.frames[1].getDisplacement(shieldLayer.id);
  const f2Sword = idleClip.frames[1].getDisplacement(swordLayer.id);
  shiftDownMask(f2Torso, 32, 32, 11, 20, 11, 21);
  shiftDownMask(f2Head, 32, 32, 3, 11, 12, 20);
  shiftDownMask(f2Shield, 32, 32, 12, 21, 6, 11);
  shiftDownMask(f2Sword, 32, 32, 6, 20, 20, 25);

  const f3Torso = idleClip.frames[2].getDisplacement(torsoLayer.id);
  const f3Head = idleClip.frames[2].getDisplacement(headLayer.id);
  const f3Shield = idleClip.frames[2].getDisplacement(shieldLayer.id);
  const f3Sword = idleClip.frames[2].getDisplacement(swordLayer.id);
  shiftDownMask(f3Torso, 32, 32, 11, 20, 11, 21);
  shiftDownMask(f3Head, 32, 32, 3, 11, 12, 20);
  shiftDownMask(f3Shield, 32, 32, 12, 21, 6, 11);
  shiftDownMask(f3Sword, 32, 32, 6, 20, 20, 25);

  // 2. Add "Walk" Clip
  const walkClip = project.addClip('Walk', 8);
  // Frame 2: Legs stride
  const f2Legs = walkClip.frames[1].getDisplacement(legsLayer.id);
  shiftDownMask(f2Legs, 32, 32, 21, 28, 11, 15);
  // Frame 4: Opposite leg stride
  const f4Legs = walkClip.frames[3].getDisplacement(legsLayer.id);
  shiftDownMask(f4Legs, 32, 32, 21, 28, 16, 20);

  // 3. Add "Attack" Clip
  const attackClip = project.addClip('Attack', 8);
  // Frame 2: Sword arm raised back
  const f2AtkSword = attackClip.frames[1].getDisplacement(swordLayer.id);
  for (let y = 6; y <= 20; y++) {
    for (let x = 20; x <= 25; x++) {
      const idx = (y * 32 + x) * 2;
      f2AtkSword[idx] = 2;
      f2AtkSword[idx + 1] = -2;
    }
  }
  // Frame 3: Sword slashing forward
  const f3AtkSword = attackClip.frames[2].getDisplacement(swordLayer.id);
  for (let y = 6; y <= 20; y++) {
    for (let x = 20; x <= 25; x++) {
      const idx = (y * 32 + x) * 2;
      f3AtkSword[idx] = -4;
      f3AtkSword[idx + 1] = 2;
    }
  }

  // Make Idle active by default
  project.activeClipId = idleClip.id;

  // Add Demo Variant: "Paladin (Cape & Gold Crest)"
  const paladin = project.addVariant('Paladin (Cape & Gold Crest)', null);
  // Add variant-specific layer: Cape
  const capeLayer = paladin.layerOverrides[0].clone('Royal Cape');
  capeLayer.clear();
  // Draw red cape behind torso
  rect(capeLayer.ctx, '#dc2626', 9, 13, 4, 12);
  rect(capeLayer.ctx, '#b91c1c', 10, 15, 3, 11);
  rect(capeLayer.ctx, '#ef4444', 9, 13, 2, 3); // shoulder clasp
  paladin.layerOverrides.splice(1, 0, capeLayer); // insert above legs, behind torso

  // Add Ponytail to Head layer on variant
  const headOverride = paladin.layerOverrides.find(l => l.name === 'Head & Plume');
  if (headOverride) {
    rect(headOverride.ctx, '#fbbf24', 9, 4, 3, 6); // gold ponytail
    rect(headOverride.ctx, '#d97706', 8, 7, 2, 4); // tail tip
  }

  // Set active variant to null (Master is active initially)
  project.activeVariantId = null;

  return project;
}

// Target sprites generator for standalone previews if needed
export function createDemoSprites() {
  const createPixelCanvas = (w, h, drawFn) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawFn(ctx, w, h);
    return canvas.toDataURL('image/png');
  };

  const rect = (ctx, color, x, y, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };

  const knightData = createPixelCanvas(32, 32, (ctx) => {
    rect(ctx, '#64748b', 12, 4, 8, 7);
    rect(ctx, '#94a3b8', 13, 5, 6, 2);
    rect(ctx, '#0f172a', 13, 8, 6, 2);
    rect(ctx, '#f59e0b', 15, 3, 2, 2);
    rect(ctx, '#475569', 11, 11, 10, 9);
    rect(ctx, '#cbd5e1', 13, 12, 6, 7);
    rect(ctx, '#d97706', 12, 19, 8, 2);
    rect(ctx, '#64748b', 8, 12, 3, 7);
    rect(ctx, '#3b82f6', 6, 13, 4, 8);
    rect(ctx, '#fbbf24', 7, 15, 2, 4);
    rect(ctx, '#64748b', 21, 12, 3, 6);
    rect(ctx, '#78350f', 22, 17, 2, 3);
    rect(ctx, '#f59e0b', 20, 16, 6, 2);
    rect(ctx, '#e2e8f0', 22, 6, 2, 10);
    rect(ctx, '#334155', 12, 21, 3, 6);
    rect(ctx, '#334155', 17, 21, 3, 6);
    rect(ctx, '#1e293b', 11, 26, 4, 3);
    rect(ctx, '#1e293b', 17, 26, 4, 3);
  });

  return [
    { name: 'Knight Champion', dataUrl: knightData, w: 32, h: 32 }
  ];
}
