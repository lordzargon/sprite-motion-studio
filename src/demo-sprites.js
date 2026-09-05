// Built-in pixel art generator for demo sprites so the app has instant test data
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

  // Helper to draw pixel rectangles
  const rect = (ctx, color, x, y, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };

  // 1. Knight (Base Sprite)
  const knightData = createPixelCanvas(32, 32, (ctx) => {
    // Helmet
    rect(ctx, '#64748b', 12, 4, 8, 7);
    rect(ctx, '#94a3b8', 13, 5, 6, 2);
    rect(ctx, '#0f172a', 13, 8, 6, 2); // visor slit
    rect(ctx, '#f59e0b', 15, 3, 2, 2); // plume

    // Body Armor
    rect(ctx, '#475569', 11, 11, 10, 9);
    rect(ctx, '#cbd5e1', 13, 12, 6, 7); // chestplate
    rect(ctx, '#d97706', 12, 19, 8, 2); // belt

    // Left Arm & Shield
    rect(ctx, '#64748b', 8, 12, 3, 7);
    rect(ctx, '#3b82f6', 6, 13, 4, 8); // shield
    rect(ctx, '#fbbf24', 7, 15, 2, 4); // shield emblem

    // Right Arm & Sword
    rect(ctx, '#64748b', 21, 12, 3, 6);
    rect(ctx, '#78350f', 22, 17, 2, 3); // hilt
    rect(ctx, '#f59e0b', 20, 16, 6, 2); // guard
    rect(ctx, '#e2e8f0', 22, 6, 2, 10); // blade

    // Legs & Boots
    rect(ctx, '#334155', 12, 21, 3, 6);
    rect(ctx, '#334155', 17, 21, 3, 6);
    rect(ctx, '#1e293b', 11, 26, 4, 3);
    rect(ctx, '#1e293b', 17, 26, 4, 3);
  });

  // 2. Wizard (Target Sprite 1)
  const wizardData = createPixelCanvas(32, 32, (ctx) => {
    // Wizard Hat
    rect(ctx, '#4338ca', 11, 2, 10, 3);
    rect(ctx, '#4338ca', 13, 0, 6, 3);
    rect(ctx, '#fbbf24', 12, 5, 8, 2); // hat brim ribbon

    // Face & Beard
    rect(ctx, '#fcd34d', 13, 7, 6, 4); // face
    rect(ctx, '#1e1b4b', 15, 8, 1, 1); // eye
    rect(ctx, '#1e1b4b', 18, 8, 1, 1); // eye
    rect(ctx, '#f8fafc', 12, 10, 8, 6); // long beard

    // Robe
    rect(ctx, '#3730a3', 10, 13, 12, 14);
    rect(ctx, '#4f46e5', 12, 14, 8, 12);
    rect(ctx, '#fbbf24', 15, 14, 2, 12); // gold trim

    // Staff
    rect(ctx, '#78350f', 23, 6, 2, 22); // wooden staff
    rect(ctx, '#06b6d4', 22, 3, 4, 4); // crystal orb
    rect(ctx, '#67e8f9', 23, 4, 2, 2); // glow

    // Hands
    rect(ctx, '#fcd34d', 21, 15, 3, 3);
    rect(ctx, '#fcd34d', 8, 16, 3, 3);
  });

  // 3. Rogue / Archer (Target Sprite 2)
  const rogueData = createPixelCanvas(32, 32, (ctx) => {
    // Hood & Mask
    rect(ctx, '#14532d', 12, 4, 8, 7);
    rect(ctx, '#166534', 13, 5, 6, 2);
    rect(ctx, '#fcd34d', 13, 8, 6, 3); // face
    rect(ctx, '#15803d', 13, 10, 6, 2); // face mask
    rect(ctx, '#052e16', 14, 8, 1, 1); // eyes
    rect(ctx, '#052e16', 17, 8, 1, 1);

    // Leather Armor & Cape
    rect(ctx, '#78350f', 11, 12, 10, 8);
    rect(ctx, '#92400e', 13, 13, 6, 6);
    rect(ctx, '#166534', 9, 13, 3, 9); // green cape left

    // Bow
    rect(ctx, '#b45309', 22, 7, 2, 16);
    rect(ctx, '#e2e8f0', 21, 8, 1, 14); // bowstring

    // Legs
    rect(ctx, '#451a03', 12, 20, 3, 7);
    rect(ctx, '#451a03', 17, 20, 3, 7);
    rect(ctx, '#1c1917', 11, 26, 4, 3);
    rect(ctx, '#1c1917', 17, 26, 4, 3);
  });

  // 4. Skeleton Warrior (Target Sprite 3)
  const skeletonData = createPixelCanvas(32, 32, (ctx) => {
    // Skull
    rect(ctx, '#f1f5f9', 12, 4, 8, 7);
    rect(ctx, '#0f172a', 13, 7, 2, 2); // eye socket
    rect(ctx, '#0f172a', 17, 7, 2, 2); // eye socket
    rect(ctx, '#0f172a', 15, 10, 2, 1); // nose/teeth

    // Ribcage & Spine
    rect(ctx, '#e2e8f0', 15, 11, 2, 9); // spine
    rect(ctx, '#cbd5e1', 11, 12, 10, 2); // rib 1
    rect(ctx, '#cbd5e1', 12, 15, 8, 2);  // rib 2
    rect(ctx, '#cbd5e1', 13, 17, 6, 2);  // rib 3
    rect(ctx, '#713f12', 12, 19, 8, 2);  // ragged loincloth

    // Rusty Scythe / Axe
    rect(ctx, '#451a03', 22, 5, 2, 22);
    rect(ctx, '#94a3b8', 19, 5, 8, 3);
    rect(ctx, '#dc2626', 18, 6, 2, 2); // rust / blood

    // Bone legs
    rect(ctx, '#e2e8f0', 13, 21, 2, 6);
    rect(ctx, '#e2e8f0', 17, 21, 2, 6);
    rect(ctx, '#cbd5e1', 12, 27, 3, 2);
    rect(ctx, '#cbd5e1', 17, 27, 3, 2);
  });

  // 5. Slime Monster (Target Sprite 4)
  const slimeData = createPixelCanvas(32, 32, (ctx) => {
    // Gelatinous body
    rect(ctx, '#10b981', 8, 14, 16, 14);
    rect(ctx, '#059669', 10, 12, 12, 4);
    rect(ctx, '#34d399', 11, 10, 10, 3);
    rect(ctx, '#6ee7b7', 10, 14, 4, 4); // shine

    // Big Cute Eyes
    rect(ctx, '#ffffff', 11, 16, 4, 5);
    rect(ctx, '#ffffff', 18, 16, 4, 5);
    rect(ctx, '#0f172a', 13, 18, 2, 3);
    rect(ctx, '#0f172a', 18, 18, 2, 3);
    rect(ctx, '#ffffff', 13, 18, 1, 1); // pupil shine
    rect(ctx, '#ffffff', 18, 18, 1, 1);
  });

  return [
    { id: 'knight', name: 'Knight (Base)', isBase: true, dataUrl: knightData, width: 32, height: 32 },
    { id: 'wizard', name: 'Wizard', isBase: false, dataUrl: wizardData, width: 32, height: 32 },
    { id: 'rogue', name: 'Rogue Archer', isBase: false, dataUrl: rogueData, width: 32, height: 32 },
    { id: 'skeleton', name: 'Skeleton', isBase: false, dataUrl: skeletonData, width: 32, height: 32 },
    { id: 'slime', name: 'Slime', isBase: false, dataUrl: slimeData, width: 32, height: 32 },
  ];
}
