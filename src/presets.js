// Built-in motion animation presets (Idle breathe, Walk cycle, Sword Slash, Bounce/Jump)
// Author Once, Apply to Many ready out-of-the-box!

export function getBuiltinPresets() {
  return [
    {
      id: 'idle_breathe',
      name: 'Idle Breathing (4 Frames)',
      fps: 6,
      loop: true,
      createFrames: (w, h) => {
        // 4 frames: Rest -> Slight Squash & Bow -> Rest -> Slight Stretch
        const frames = [];
        
        // Frame 1: Rest (no offset)
        const f1 = new Float32Array(w * h * 2);
        frames.push({ name: 'Idle 1 (Rest)', displacement: Array.from(f1), duration: 1.0 });

        // Frame 2: Breathe In / Slight down compression
        const f2 = new Float32Array(w * h * 2);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 2;
            if (y < 20) {
              f2[idx + 1] = 1; // shift upper torso & head down by 1px
            }
          }
        }
        frames.push({ name: 'Idle 2 (Inhale)', displacement: Array.from(f2), duration: 1.0 });

        // Frame 3: Peak inhale
        const f3 = new Float32Array(w * h * 2);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 2;
            if (y < 12) {
              f3[idx + 1] = 1;
            } else if (y >= 12 && y < 22) {
              // Expand chest slightly outward
              f3[idx] = x < w / 2 ? -1 : 1;
            }
          }
        }
        frames.push({ name: 'Idle 3 (Peak)', displacement: Array.from(f3), duration: 1.0 });

        // Frame 4: Exhale recovery
        const f4 = new Float32Array(w * h * 2);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 2;
            if (y < 16) {
              f4[idx + 1] = -1; // slight lift up
            }
          }
        }
        frames.push({ name: 'Idle 4 (Exhale)', displacement: Array.from(f4), duration: 1.0 });

        return frames;
      }
    },

    {
      id: 'walk_cycle',
      name: 'Walk Cycle (6 Frames)',
      fps: 10,
      loop: true,
      createFrames: (w, h) => {
        const frames = [];

        // 6-frame classic walk bobbing and limb shift
        const steps = [
          { name: 'Contact L', torsoDy: 0, leftLegDx: 2, rightLegDx: -2, weaponDy: 0 },
          { name: 'Passing L', torsoDy: -1, leftLegDx: 1, rightLegDx: -1, weaponDy: -1 },
          { name: 'Contact High', torsoDy: -2, leftLegDx: 0, rightLegDx: 0, weaponDy: -2 },
          { name: 'Contact R', torsoDy: 0, leftLegDx: -2, rightLegDx: 2, weaponDy: 0 },
          { name: 'Passing R', torsoDy: -1, leftLegDx: -1, rightLegDx: 1, weaponDy: -1 },
          { name: 'Contact High R', torsoDy: -2, leftLegDx: 0, rightLegDx: 0, weaponDy: -2 }
        ];

        steps.forEach((step) => {
          const field = new Float32Array(w * h * 2);
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * 2;
              // Torso & Head (upper part)
              if (y < 20) {
                field[idx + 1] = step.torsoDy;
              }
              // Left Leg / Side (x < 15, y >= 20)
              if (y >= 20 && x < w / 2) {
                field[idx] = step.leftLegDx;
              }
              // Right Leg / Side (x >= 15, y >= 20)
              if (y >= 20 && x >= w / 2) {
                field[idx] = step.rightLegDx;
              }
              // Weapon / Hand (x > 20)
              if (x > 20 && y >= 6 && y < 20) {
                field[idx + 1] = step.weaponDy;
              }
            }
          }
          frames.push({ name: step.name, displacement: Array.from(field), duration: 1.0 });
        });

        return frames;
      }
    },

    {
      id: 'slash_attack',
      name: 'Slash Attack (5 Frames)',
      fps: 12,
      loop: false,
      createFrames: (w, h) => {
        const frames = [];

        // Frame 1: Windup (pull back left)
        const f1 = new Float32Array(w * h * 2);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 2;
            fieldOffset(f1, idx, -2, 1); // lean back
          }
        }
        frames.push({ name: 'Windup', displacement: Array.from(f1), duration: 1.2 });

        // Frame 2: Forward Lunge & Strike
        const f2 = new Float32Array(w * h * 2);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 2;
            if (x > 18) {
              fieldOffset(f2, idx, 4, -2); // weapon swing forward
            } else {
              fieldOffset(f2, idx, 3, 0); // body forward
            }
          }
        }
        frames.push({ name: 'Strike', displacement: Array.from(f2), duration: 0.8 });

        // Frame 3: Overswing & Impact
        const f3 = new Float32Array(w * h * 2);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 2;
            if (x > 16) {
              fieldOffset(f3, idx, 5, 2); // weapon downward followthrough
            } else {
              fieldOffset(f3, idx, 2, 1);
            }
          }
        }
        frames.push({ name: 'Impact', displacement: Array.from(f3), duration: 1.0 });

        // Frame 4: Recovery
        const f4 = new Float32Array(w * h * 2);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 2;
            fieldOffset(f4, idx, 1, 0);
          }
        }
        frames.push({ name: 'Recovery', displacement: Array.from(f4), duration: 1.0 });

        // Frame 5: Return to rest
        const f5 = new Float32Array(w * h * 2);
        frames.push({ name: 'Rest', displacement: Array.from(f5), duration: 1.0 });

        return frames;
      }
    }
  ];
}

function fieldOffset(arr, idx, dx, dy) {
  arr[idx] = dx;
  arr[idx + 1] = dy;
}
