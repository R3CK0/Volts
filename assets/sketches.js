/* VOLTS — p5.js sketches
 * Hand-tuned generative visualizations for the paper landing page.
 * Each sketch lives in its own p5 instance.
 *
 * Palette
 *   brand-2  #15803d   primary green (selected / valid leader)
 *   brand-3  #22c55e   bright green
 *   amber    #fbbf24   β-branch (secondary)
 *   rose     #e11d48   invalid (validator reject)
 *   muted    #cbd5d0   pruned / low-score
 */

const VOLTS_COLORS = {
  primary: '#15803d',
  bright: '#22c55e',
  soft: '#bbf7d0',
  softer: '#dcfce7',
  amber: '#f59e0b',
  amberSoft: '#fde68a',
  rose: '#e11d48',
  roseSoft: '#fecdd3',
  muted: '#cbd5d0',
  text: '#0f2417',
  textSoft: '#3a5a45',
};

/* ---------------------------------------------------------------------------
 * Backdrop — drifting flow field of tiny particles.
 * Subtle, low contrast. Lives behind everything.
 * ------------------------------------------------------------------------- */
new p5((p) => {
  let particles = [];
  let t = 0;
  let w, h;

  const N = 90;

  p.setup = () => {
    const host = document.getElementById('backdrop');
    const c = p.createCanvas(window.innerWidth, window.innerHeight);
    c.parent(host);
    p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
    p.noiseSeed(11);
    w = p.width; h = p.height;
    for (let i = 0; i < N; i++) {
      particles.push({
        x: p.random(w), y: p.random(h),
        px: 0, py: 0,
        v: p.random(0.3, 0.8),
        life: p.random(120, 600),
        age: p.random(600),
        hue: p.random(125, 160),
      });
    }
    p.background(247, 251, 246);
  };

  p.windowResized = () => {
    p.resizeCanvas(window.innerWidth, window.innerHeight);
    w = p.width; h = p.height;
    p.background(247, 251, 246);
  };

  p.draw = () => {
    // Very slow fade so trails ghost away gracefully.
    p.noStroke();
    p.fill(247, 251, 246, 14);
    p.rect(0, 0, w, h);

    t += 0.0018;
    const scale = 0.0012;
    for (const pt of particles) {
      pt.px = pt.x; pt.py = pt.y;
      const n = p.noise(pt.x * scale, pt.y * scale, t);
      const a = n * p.TWO_PI * 2;
      pt.x += Math.cos(a) * pt.v;
      pt.y += Math.sin(a) * pt.v;
      pt.age++;
      if (pt.age > pt.life || pt.x < -10 || pt.x > w + 10 || pt.y < -10 || pt.y > h + 10) {
        pt.x = p.random(w); pt.y = p.random(h);
        pt.px = pt.x; pt.py = pt.y;
        pt.age = 0; pt.life = p.random(120, 600);
      }
      p.stroke(p.color(`hsla(${pt.hue}, 55%, 45%, 0.10)`));
      p.strokeWeight(0.7);
      p.line(pt.px, pt.py, pt.x, pt.y);
    }
  };
});

/* ---------------------------------------------------------------------------
 * HERO — Logit Tree Search.
 * A symbolic, beautified depiction of the VOLTS search:
 *   - root node at the top
 *   - each step the active leaves spawn validated children
 *   - one primary (deep green) per branch, β-branches in amber spawn new leaves
 *   - some candidates marked invalid (rose, with a soft "x"), low-score pruned (grey)
 *   - cap of k_max active branches at any time
 * The tree grows, fades, and starts over on a slow loop.
 * ------------------------------------------------------------------------- */
new p5((p) => {
  let W, H;
  let nodes = [];          // { x, y, depth, kind, age, parent, slotLeft, slotRight }
  let edges = [];          // { from, to, kind, age }
  let activeLeaves = [];   // node refs that are still extendable
  let phase = 'grow';      // grow | hold | fade
  let phaseTimer = 0;
  let stepTimer = 0;
  const STEP_INTERVAL = 32;
  const KMAX = 4;
  const MAX_DEPTH = 5;
  const BETA_RATIO = 0.5;
  const INVALID_RATE = 0.30;
  const TOP_PAD = 70;
  const BOT_PAD = 80;
  const SIDE_PAD = 30;

  p.setup = () => {
    const host = document.getElementById('hero-canvas');
    const c = p.createCanvas(560, 560);
    c.parent(host);
    p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
    p.frameRate(60);
    fitCanvas();
    reset();
    // Pre-grow a few steps so the first visible frame is already interesting.
    for (let i = 0; i < 3; i++) expand();
    for (const n of nodes) n.age = 30;
    for (const e of edges) e.age = 30;
  };

  function fitCanvas() {
    const host = document.getElementById('hero-canvas');
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const s = Math.min(rect.width, rect.height) || 480;
    p.resizeCanvas(s, s, true);
    W = p.width; H = p.height;
  }

  p.windowResized = () => { fitCanvas(); reset(); };

  function reset() {
    nodes = []; edges = []; activeLeaves = [];
    const root = {
      x: W / 2, y: TOP_PAD,
      depth: 0, kind: 'primary', age: 0, parent: null,
      slotLeft: SIDE_PAD, slotRight: W - SIDE_PAD,
    };
    nodes.push(root);
    activeLeaves.push(root);
    phase = 'grow'; phaseTimer = 0; stepTimer = 0;
  }

  function depthY(d) {
    return TOP_PAD + (H - TOP_PAD - BOT_PAD) * (d / MAX_DEPTH);
  }

  // Strict slot-based layout. Every parent owns a horizontal range. Every child
  // it produces is placed inside that range, full stop — never spilling into a
  // sibling's range. Active children (primary / beta) inherit one of N evenly-
  // divided sub-slots; inactive children (invalid / pruned) are placed in the
  // remaining gaps inside the slot.
  function expand() {
    const newLeaves = [];

    // First pass: roll candidates and pre-classify so we know how many actives
    // we'll have globally (needed to respect KMAX).
    const perLeaf = [];
    let projectedActive = 0;
    for (const leaf of activeLeaves) {
      if (leaf.depth >= MAX_DEPTH) { perLeaf.push(null); continue; }
      // Fewer candidates at deeper depths keeps things uncluttered.
      const maxCands = leaf.depth >= 3 ? 3 : 4;
      const candCount = Math.floor(p.random(2, maxCands + 0.999));
      const proposals = [];
      for (let i = 0; i < candCount; i++) proposals.push({ valid: p.random() > INVALID_RATE, score: p.random() });
      proposals.sort((a, b) => b.score - a.score);

      let primaryAssigned = false;
      let activeHere = 0;
      for (const q of proposals) {
        if (!q.valid) { q.kind = 'invalid'; continue; }
        if (!primaryAssigned) { q.kind = 'primary'; primaryAssigned = true; activeHere++; continue; }
        if (projectedActive + activeHere < KMAX && p.random() < BETA_RATIO) {
          q.kind = 'beta'; activeHere++;
        } else {
          q.kind = 'pruned';
        }
      }
      projectedActive += activeHere;
      perLeaf.push({ proposals, activeHere });
    }

    // Second pass: place. We arrange proposals in a stable order
    // (active-first), evenly across the parent's slot, then give active
    // children a tight sub-slot for their own subtree to grow into.
    for (let i = 0; i < activeLeaves.length; i++) {
      const leaf = activeLeaves[i];
      const data = perLeaf[i];
      if (!data) continue;
      const { proposals } = data;

      const slotL = leaf.slotLeft, slotR = leaf.slotRight;
      const slotW = slotR - slotL;
      const childY = depthY(leaf.depth + 1);

      // Order: actives first (preserving score order), then inactives.
      const actives = proposals.filter(q => q.kind === 'primary' || q.kind === 'beta');
      const inactives = proposals.filter(q => q.kind === 'invalid' || q.kind === 'pruned');
      const ordered = [...actives, ...inactives];

      // Each slot is a horizontal band of width slotW. We hand the active
      // children CENTRE positions (so their subtree has room left and right),
      // and tuck inactives at the edges of the slot.
      const N = ordered.length;
      // Active children take an evenly-spaced row across the *inner* 78% of the
      // slot, so they keep a margin away from cousin subtrees.
      const innerLeft = slotL + slotW * 0.11;
      const innerRight = slotR - slotW * 0.11;
      const innerW = innerRight - innerLeft;

      // Allocate sub-slot widths for actives (these become their own slot
      // ranges for the next depth).
      const activeStride = actives.length > 0 ? innerW / actives.length : innerW;

      const subSlotFor = new Map();
      for (let a = 0; a < actives.length; a++) {
        const subL = innerLeft + a * activeStride;
        const subR = subL + activeStride;
        subSlotFor.set(actives[a], { left: subL, right: subR });
      }

      // Inactives: place them flanking the active cluster — never out at the
      // canvas edges (which can be very far when the parent owns a wide slot).
      // Alternate left-of-cluster, right-of-cluster, then a second row inside.
      const inactiveBand = Math.min(18, Math.max(11, activeStride * 0.25));
      const activeLeftmost  = actives.length > 0 ? innerLeft + activeStride * 0.5                       : (slotL + slotR) / 2;
      const activeRightmost = actives.length > 0 ? innerLeft + activeStride * (actives.length - 0.5)    : (slotL + slotR) / 2;
      const inactivePositions = [];
      for (let k = 0; k < inactives.length; k++) {
        const row = Math.floor(k / 2);                 // 0, 0, 1, 1, ...
        const side = k % 2 === 0 ? -1 : 1;             // left, right, left, right
        const offset = inactiveBand * (row + 1);
        let cx = side < 0
          ? activeLeftmost - offset
          : activeRightmost + offset;
        // Stagger second row slightly lower so they don't sit on top of first.
        const cy = childY + row * 12;
        inactivePositions.push({ cx, cy });
      }

      // Now emit nodes and edges
      let inactiveIdx = 0;
      for (const q of ordered) {
        let cx, cy = childY, nodeSlotL, nodeSlotR;

        if (q.kind === 'primary' || q.kind === 'beta') {
          const s = subSlotFor.get(q);
          cx = (s.left + s.right) / 2;
          nodeSlotL = s.left; nodeSlotR = s.right;
        } else {
          const pos = inactivePositions[inactiveIdx++];
          cx = pos.cx;
          cy = pos.cy;
          nodeSlotL = cx - 6; nodeSlotR = cx + 6;
        }

        // Final clamp: never let a node sit outside its parent's slot.
        const clampPad = 4;
        if (cx < slotL + clampPad) cx = slotL + clampPad;
        if (cx > slotR - clampPad) cx = slotR - clampPad;

        const node = {
          x: cx, y: cy, depth: leaf.depth + 1,
          kind: q.kind, age: 0, parent: leaf,
          slotLeft: nodeSlotL, slotRight: nodeSlotR,
        };
        nodes.push(node);
        edges.push({ from: leaf, to: node, kind: q.kind, age: 0 });
        if (q.kind === 'primary' || q.kind === 'beta') newLeaves.push(node);
      }
    }

    activeLeaves = newLeaves.slice(0, KMAX);

    if (activeLeaves.length === 0 || activeLeaves[0].depth >= MAX_DEPTH) {
      phase = 'hold'; phaseTimer = 0;
    }
  }

  function drawNode(n) {
    const fade = Math.min(1, n.age / 22);
    const r = 7;
    p.noStroke();

    if (n.kind === 'primary') {
      // soft glow
      p.fill(34, 197, 94, 35 * fade);
      p.circle(n.x, n.y, r * 4);
      p.fill(21, 128, 61, 255 * fade);
      p.circle(n.x, n.y, r * 2);
    } else if (n.kind === 'beta') {
      p.fill(245, 158, 11, 30 * fade);
      p.circle(n.x, n.y, r * 3.4);
      p.fill(217, 119, 6, 255 * fade);
      p.circle(n.x, n.y, r * 1.8);
    } else if (n.kind === 'invalid') {
      // soft red dot with a thin × through it
      p.fill(225, 29, 72, 180 * fade);
      p.circle(n.x, n.y, r * 1.6);
      p.stroke(255, 255, 255, 255 * fade);
      p.strokeWeight(1.4);
      const s = r * 0.7;
      p.line(n.x - s, n.y - s, n.x + s, n.y + s);
      p.line(n.x - s, n.y + s, n.x + s, n.y - s);
    } else { // pruned
      p.fill(160, 175, 168, 160 * fade);
      p.circle(n.x, n.y, r * 1.3);
    }
  }

  function drawEdge(e) {
    const fade = Math.min(1, e.age / 18);
    let col, w;
    switch (e.kind) {
      case 'primary': col = p.color(21, 128, 61, 220 * fade); w = 2.2; break;
      case 'beta':    col = p.color(217, 119, 6, 200 * fade); w = 1.6; break;
      case 'invalid': col = p.color(225, 29, 72, 80 * fade); w = 1.0; break;
      default:        col = p.color(160, 175, 168, 90 * fade); w = 0.9;
    }
    p.stroke(col);
    p.strokeWeight(w);
    p.noFill();
    // a gentle curve
    const mx = (e.from.x + e.to.x) / 2;
    const my = e.from.y + (e.to.y - e.from.y) * 0.55;
    p.bezier(
      e.from.x, e.from.y,
      e.from.x, my,
      mx, my,
      e.to.x, e.to.y
    );
  }

  p.draw = () => {
    p.clear();
    // Soft halo behind the tree
    const cx = W / 2, cy = H * 0.46;
    for (let r = 220; r > 80; r -= 40) {
      p.noStroke();
      p.fill(34, 197, 94, 4);
      p.circle(cx, cy, r * 2);
    }

    // step the simulation
    if (phase === 'grow') {
      stepTimer++;
      if (stepTimer >= STEP_INTERVAL) {
        stepTimer = 0;
        expand();
      }
    } else if (phase === 'hold') {
      phaseTimer++;
      if (phaseTimer > 90) { phase = 'fade'; phaseTimer = 0; }
    } else if (phase === 'fade') {
      phaseTimer++;
      const k = phaseTimer / 70;
      // dim and at the end reset
      for (const e of edges) e.age = Math.max(0, e.age - 0.6);
      for (const n of nodes) n.age = Math.max(0, n.age - 0.6);
      if (k > 1) reset();
    }

    // age everyone
    for (const e of edges) e.age++;
    for (const n of nodes) n.age++;

    // draw edges then nodes
    for (const e of edges) drawEdge(e);
    for (const n of nodes) drawNode(n);

    // a faint "step" indicator at the top
    p.noStroke();
    p.fill(15, 36, 23, 90);
    p.textFont('JetBrains Mono');
    p.textSize(10);
    p.textAlign(p.LEFT, p.TOP);
    const d = activeLeaves[0]?.depth ?? 0;
    p.text(`step  t=${d}   |B|=${activeLeaves.length}   k_max=${KMAX}`, 16, H - 28);
  };
});

/* ---------------------------------------------------------------------------
 * TOKEN CANVAS — Sub-word vs custom-vocabulary tokenization.
 *
 * Top row:    "PickUp"    → "Pick" | "Up"  (2 tokens, validate impossible mid-action)
 * Bot row:    "PickUp"    → ⟦PickUp⟧      (1 token, validate at every step ✓)
 * Animation: tokens arrive one at a time; a green "✓" or red "✗" stamp appears.
 * ------------------------------------------------------------------------- */
new p5((p) => {
  let W, H;
  let cycle = 0;
  let frame = 0;

  // Two examples; we cycle through them.
  const examples = [
    {
      action: 'PickUp',
      sub: ['Pick', 'Up'],
      cust: ['PickUp'],
    },
    {
      action: 'Analyse_rock_sample',
      sub: ['Ana', 'lyse', '_', 'rock', '_', 'sam', 'ple'],
      cust: ['Analyse_rock_sample'],
    },
    {
      action: 'LoadTruck',
      sub: ['Load', 'Truck'],
      cust: ['LoadTruck'],
    },
  ];

  function fitCanvas(canvasId, ratio = 4/3) {
    const host = document.getElementById(canvasId);
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const w = Math.max(280, rect.width);
    const h = Math.max(220, rect.height || w / ratio);
    p.resizeCanvas(w, h, true);
    W = p.width; H = p.height;
    return true;
  }

  p.setup = () => {
    const host = document.getElementById('token-canvas');
    const c = p.createCanvas(600, 450);
    c.parent(host);
    p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
    fitCanvas('token-canvas');
  };

  p.windowResized = () => { fitCanvas('token-canvas'); };

  function drawTokenBox(x, y, w, h, label, opts) {
    const { fill, stroke, textColor, dashed } = opts;
    p.noStroke();
    if (fill) { p.fill(fill); p.rect(x, y, w, h, 8); }
    if (stroke) {
      p.stroke(stroke);
      p.strokeWeight(1.4);
      if (dashed) p.drawingContext.setLineDash([4, 4]);
      else p.drawingContext.setLineDash([]);
      p.noFill();
      p.rect(x, y, w, h, 8);
      p.drawingContext.setLineDash([]);
    }
    p.noStroke();
    p.fill(textColor || VOLTS_COLORS.text);
    p.textFont('JetBrains Mono');
    p.textStyle(p.BOLD);
    p.textSize(Math.max(11, Math.min(15, w / Math.max(label.length, 4) * 1.6)));
    p.textAlign(p.CENTER, p.CENTER);
    p.text(label, x + w / 2, y + h / 2);
  }

  function drawValidationStamp(x, y, ok, alpha) {
    p.noStroke();
    if (ok) {
      p.fill(34, 197, 94, alpha);
      p.circle(x, y, 26);
      p.stroke(255, 255, 255, alpha);
      p.strokeWeight(2.5);
      p.noFill();
      p.beginShape();
      p.vertex(x - 6, y);
      p.vertex(x - 2, y + 5);
      p.vertex(x + 7, y - 5);
      p.endShape();
    } else {
      p.fill(225, 29, 72, alpha);
      p.circle(x, y, 26);
      p.stroke(255, 255, 255, alpha);
      p.strokeWeight(2.5);
      p.line(x - 5, y - 5, x + 5, y + 5);
      p.line(x - 5, y + 5, x + 5, y - 5);
    }
  }

  p.draw = () => {
    p.clear();
    frame++;

    const ex = examples[cycle % examples.length];

    // Layout
    const padX = 24, padY = 28;
    const labelW = 90;

    // Row labels
    p.noStroke();
    p.fill(VOLTS_COLORS.textSoft);
    p.textFont('Inter');
    p.textStyle(p.NORMAL);
    p.textSize(11);
    p.textAlign(p.LEFT, p.CENTER);

    const rowH = (H - padY * 2) / 2;
    const y1 = padY + rowH * 0.5;
    const y2 = padY + rowH * 1.5;

    // Section headers
    p.fill(VOLTS_COLORS.muted);
    p.textSize(10);
    p.textStyle(p.BOLD);
    p.textAlign(p.LEFT, p.TOP);
    p.text('PRE FINE-TUNING · sub-word', padX, padY - 14);
    p.text('POST FINE-TUNING · custom vocabulary', padX, padY + rowH - 14);

    // Animation timing
    const cycleFrames = 280;
    const t = frame % cycleFrames;
    const subTokens = ex.sub;
    const custTokens = ex.cust;

    const arriveEvery = Math.floor(cycleFrames / (subTokens.length + 4));

    // Sub-word row
    const subArea = { x: padX, y: padY + 4, w: W - padX * 2, h: rowH - 14 };
    const subTokW = Math.min(110, (subArea.w - 20) / subTokens.length);
    const subStartX = subArea.x + (subArea.w - subTokens.length * subTokW - (subTokens.length - 1) * 4) / 2;
    const subY = subArea.y + (subArea.h - 38) / 2;
    let allSubArrived = true;
    for (let i = 0; i < subTokens.length; i++) {
      const arrive = i * arriveEvery + 10;
      if (t < arrive) { allSubArrived = false; continue; }
      const local = Math.min(1, (t - arrive) / 16);
      const px = subStartX + i * (subTokW + 4);
      const py = subY + (1 - local) * 14;
      p.push();
      p.drawingContext.globalAlpha = local;
      drawTokenBox(px, py, subTokW, 38, subTokens[i], {
        fill: '#eef7ec',
        stroke: '#cfe6cf',
        textColor: VOLTS_COLORS.text,
        dashed: true,
      });
      p.pop();
    }
    // Big ✗ to signal "validate impossible mid-action"
    if (allSubArrived) {
      const stampT = Math.min(1, (t - subTokens.length * arriveEvery - 14) / 18);
      if (stampT > 0) {
        drawValidationStamp(subArea.x + subArea.w - 22, subY + 19, false, 220 * stampT);
        p.noStroke();
        p.fill(225, 29, 72, 200 * stampT);
        p.textFont('Inter');
        p.textStyle(p.NORMAL);
        p.textSize(11);
        p.textAlign(p.RIGHT, p.TOP);
        p.text(`needs ${subTokens.length} tokens to validate`, subArea.x + subArea.w - 44, subY + 42);
      }
    }

    // Custom-vocab row
    const custArea = { x: padX, y: padY + rowH + 4, w: W - padX * 2, h: rowH - 14 };
    const custTokW = Math.min(280, Math.max(150, ex.action.length * 14));
    const custStartX = custArea.x + (custArea.w - custTokW) / 2;
    const custY = custArea.y + (custArea.h - 44) / 2;
    const custArriveAt = subTokens.length * arriveEvery + 20;
    if (t >= custArriveAt) {
      const local = Math.min(1, (t - custArriveAt) / 22);
      const py = custY + (1 - local) * 20;
      p.push();
      p.drawingContext.globalAlpha = local;
      drawTokenBox(custStartX, py, custTokW, 44, '⟦ ' + ex.action + ' ⟧', {
        fill: VOLTS_COLORS.softer,
        stroke: VOLTS_COLORS.primary,
        textColor: VOLTS_COLORS.primary,
        dashed: false,
      });
      p.pop();

      if (local >= 1) {
        const stampT = Math.min(1, (t - custArriveAt - 22) / 14);
        drawValidationStamp(custStartX + custTokW + 22, py + 22, true, 230 * stampT);
        p.noStroke();
        p.fill(21, 128, 61, 220 * stampT);
        p.textFont('Inter');
        p.textStyle(p.NORMAL);
        p.textSize(11);
        p.textAlign(p.LEFT, p.TOP);
        p.text('validates at every step', custStartX + custTokW + 38, py + 16);
      }
    }

    if (frame % cycleFrames === cycleFrames - 1) cycle++;
  };
});

/* ---------------------------------------------------------------------------
 * VALIDATOR CANVAS — a strip of candidate tokens entering a "validator gate"
 * where most pass through (green) and the infeasible ones get rejected (red ✗).
 * Visualizes per-token state checks inside the decoding loop.
 * ------------------------------------------------------------------------- */
new p5((p) => {
  let W, H;
  let tokens = [];
  let frame = 0;

  const ACTIONS = [
    'PickUp(A)','Stack(A,B)','PutDown(C)','Drive(t1,L1)',
    'LoadTruck(p,t)','UnloadTruck(p,t)','Sample(rock1)','Communicate(d1)',
    'Calibrate(c)','Board(d,t)','Disembark(d,t)','MoveCamera(r,p)',
  ];

  p.setup = () => {
    const host = document.getElementById('validator-canvas');
    const c = p.createCanvas(600, 450);
    c.parent(host);
    p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
    fit();
  };
  p.windowResized = fit;

  function fit() {
    const host = document.getElementById('validator-canvas');
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const w = Math.max(280, rect.width);
    const h = Math.max(220, rect.height || w * 0.75);
    p.resizeCanvas(w, h, true);
    W = p.width; H = p.height;
  }

  function spawn() {
    const a = ACTIONS[Math.floor(p.random(ACTIONS.length))];
    const valid = p.random() > 0.32;
    tokens.push({
      x: -90, y: H / 2 + p.random(-18, 18),
      label: a, valid,
      v: p.random(1.6, 2.4),
      decided: false,
      passT: 0,
    });
  }

  p.draw = () => {
    p.clear();
    frame++;

    if (frame % 22 === 0 && tokens.length < 7) spawn();

    // Gate column — center
    const gx = W * 0.58;
    // Soft gate gradient
    for (let i = 0; i < 24; i++) {
      const a = 18 - i * 0.6;
      p.noStroke();
      p.fill(34, 197, 94, Math.max(a, 0));
      p.rect(gx - 14 + i * 0.6, 40, 2, H - 80, 2);
    }
    // Gate stroke
    p.stroke(21, 128, 61, 200);
    p.strokeWeight(2);
    p.noFill();
    p.rect(gx - 14, 40, 28, H - 80, 14);

    // Gate label
    p.noStroke();
    p.fill(21, 128, 61);
    p.textFont('Inter');
    p.textStyle(p.BOLD);
    p.textSize(11);
    p.textAlign(p.CENTER, p.TOP);
    p.text('VALIDATOR', gx, 18);
    p.textStyle(p.NORMAL);
    p.fill(VOLTS_COLORS.muted);
    p.textSize(10);
    p.text('check  precond(a, s)', gx, H - 32);

    // "state s" label on the right
    p.fill(VOLTS_COLORS.muted);
    p.textSize(10);
    p.textAlign(p.RIGHT, p.TOP);
    p.text('current state  s', W - 18, 18);

    // Process tokens
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      t.x += t.v;

      // Decision happens as it crosses the gate
      if (!t.decided && t.x >= gx - 2) {
        t.decided = true;
        t.passT = 0;
      }
      if (t.decided) {
        t.passT++;
        if (!t.valid) {
          // veer downward, fade out
          t.y += t.passT * 0.18;
          t.v *= 0.94;
        }
      }

      // Render
      const fade = Math.min(1, Math.max(0, 1 - Math.max(0, t.x - W - 40) / 80));
      const labelW = Math.min(140, t.label.length * 8.4 + 18);
      const labelH = 26;
      const lx = t.x - labelW / 2, ly = t.y - labelH / 2;

      // Pre-gate: pale neutral. Post-gate: green or rose.
      let fill, stroke, text;
      if (!t.decided) {
        fill = p.color(255, 255, 255, 240 * fade);
        stroke = p.color(VOLTS_COLORS.muted);
        text = VOLTS_COLORS.text;
      } else if (t.valid) {
        fill = p.color(220, 252, 231, 240 * fade);
        stroke = p.color(VOLTS_COLORS.primary);
        text = VOLTS_COLORS.primary;
      } else {
        fill = p.color(254, 226, 232, 240 * fade);
        stroke = p.color(VOLTS_COLORS.rose);
        text = VOLTS_COLORS.rose;
      }
      p.noStroke();
      p.fill(fill);
      p.rect(lx, ly, labelW, labelH, 7);
      p.stroke(stroke);
      p.strokeWeight(1.3);
      p.noFill();
      if (!t.valid && t.decided) {
        p.drawingContext.setLineDash([4, 4]);
      } else {
        p.drawingContext.setLineDash([]);
      }
      p.rect(lx, ly, labelW, labelH, 7);
      p.drawingContext.setLineDash([]);

      p.noStroke();
      p.fill(text);
      p.textFont('JetBrains Mono');
      p.textStyle(p.BOLD);
      p.textSize(11);
      p.textAlign(p.CENTER, p.CENTER);
      p.text(t.label, t.x, t.y);

      // Pass/fail glyph
      if (t.decided && t.passT < 22) {
        const aa = 255 * (1 - t.passT / 22);
        if (t.valid) {
          p.noStroke();
          p.fill(34, 197, 94, aa);
          p.circle(t.x + labelW / 2 + 12, t.y, 16);
          p.stroke(255, 255, 255, aa);
          p.strokeWeight(2);
          p.noFill();
          p.beginShape();
          p.vertex(t.x + labelW / 2 + 8, t.y);
          p.vertex(t.x + labelW / 2 + 11, t.y + 3);
          p.vertex(t.x + labelW / 2 + 17, t.y - 4);
          p.endShape();
        } else {
          p.noStroke();
          p.fill(225, 29, 72, aa);
          p.circle(t.x + labelW / 2 + 12, t.y, 16);
          p.stroke(255, 255, 255, aa);
          p.strokeWeight(2);
          p.line(t.x + labelW / 2 + 8, t.y - 3, t.x + labelW / 2 + 16, t.y + 3);
          p.line(t.x + labelW / 2 + 8, t.y + 3, t.x + labelW / 2 + 16, t.y - 3);
        }
      }

      // remove
      if (t.x > W + 80 || (t.decided && !t.valid && t.y > H + 40)) tokens.splice(i, 1);
    }
  };
});

/* ---------------------------------------------------------------------------
 * BRANCHING CANVAS — a closer look at one decoding step:
 * One parent state s_i fans out a Top-K logits ranked bar. The leader becomes
 * the primary branch (green). Any score within β = 1.15 of the leader spawns a
 * new branch (amber). The rest get pruned (grey). Then we advance.
 * ------------------------------------------------------------------------- */
new p5((p) => {
  let W, H;
  let frame = 0;
  let stepPhase = 0;  // 0 propose, 1 rank, 2 mark, 3 spawn, 4 advance
  let phaseT = 0;
  const PHASES = [60, 60, 80, 80, 70];
  let candidates = [];
  let parentNode = null;
  let activeBranches = [];

  p.setup = () => {
    const host = document.getElementById('branching-canvas');
    const c = p.createCanvas(600, 450);
    c.parent(host);
    p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
    fit();
    reset();
  };
  p.windowResized = () => { fit(); reset(); };

  function fit() {
    const host = document.getElementById('branching-canvas');
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const w = Math.max(280, rect.width);
    const h = Math.max(220, rect.height || w * 0.75);
    p.resizeCanvas(w, h, true);
    W = p.width; H = p.height;
  }

  function reset() {
    parentNode = { x: W * 0.18, y: H / 2 };
    activeBranches = [parentNode];
    proposeCandidates();
    stepPhase = 0; phaseT = 0;
  }

  function proposeCandidates() {
    candidates = [];
    const K = 5;
    // Generate softmax-ish scores tuned so β-branches appear on most cycles
    // (i.e., usually 2–3 candidates land within ratio 1.15 of the leader).
    // Strategy: pick a leader high, then a couple "close" siblings near the leader,
    // and a couple "low" siblings to be pruned. A few will be marked invalid.
    let raw = [];
    const leader = p.random(0.85, 1.0);
    raw.push(leader);
    // one or two close siblings
    const closeN = Math.random() < 0.65 ? 2 : 1;
    for (let i = 0; i < closeN; i++) raw.push(leader * p.random(0.88, 0.99));
    // remaining are clearly lower
    while (raw.length < K) raw.push(p.random(0.45, 0.75));
    raw.sort((a, b) => b - a);
    const lead = raw[0];
    for (let i = 0; i < K; i++) raw[i] /= lead;
    for (let i = 0; i < K; i++) {
      candidates.push({
        ratio: raw[i],
        valid: p.random() > 0.22,
        kind: 'pending',
        y: 0,
      });
    }
  }

  function classify() {
    // Find leader among valid
    let leaderIdx = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].valid) { leaderIdx = i; break; }
    }
    if (leaderIdx === -1) return;
    const lead = candidates[leaderIdx].ratio;
    let activeCount = 1; // primary counts
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c.valid) { c.kind = 'invalid'; continue; }
      if (i === leaderIdx) { c.kind = 'primary'; continue; }
      const r = lead / c.ratio;
      if (r < 1.15 && activeCount < 4) { c.kind = 'beta'; activeCount++; }
      else { c.kind = 'pruned'; }
    }
  }

  function drawBar(x, y, w, h, ratio, kind, alpha) {
    // bar background
    p.noStroke();
    p.fill(241, 248, 238, 255 * alpha);
    p.rect(x, y, w, h, 6);
    // bar fill
    let col;
    switch (kind) {
      case 'primary': col = p.color(21, 128, 61, 230 * alpha); break;
      case 'beta':    col = p.color(217, 119, 6, 220 * alpha); break;
      case 'invalid': col = p.color(225, 29, 72, 150 * alpha); break;
      case 'pruned':  col = p.color(160, 175, 168, 160 * alpha); break;
      default:        col = p.color(120, 170, 130, 130 * alpha);
    }
    p.fill(col);
    const fillW = (w - 2) * ratio;
    p.rect(x + 1, y + 1, fillW, h - 2, 5);
    // outline if invalid
    if (kind === 'invalid') {
      p.stroke(225, 29, 72, 180 * alpha);
      p.strokeWeight(1.2);
      p.drawingContext.setLineDash([4, 4]);
      p.noFill();
      p.rect(x, y, w, h, 6);
      p.drawingContext.setLineDash([]);
    }
  }

  p.draw = () => {
    p.clear();
    frame++;

    // treeFocus: 0 = bars-only view (phases 0..2), 1 = tree-only view (phase 4 advance).
    // We ramp during phase 3 so the user sees the bars fade out as the tree takes over.
    let treeFocus = 0;
    if (stepPhase === 3) treeFocus = Math.min(1, phaseT / PHASES[3]) * 0.85;
    if (stepPhase === 4) treeFocus = 1;
    const barsAlpha = 1 - treeFocus;

    // Parent node + bars (left/middle of canvas) — fade out as treeFocus grows.
    if (barsAlpha > 0.01) {
      p.drawingContext.globalAlpha = barsAlpha;

      // Parent node
      p.noStroke();
      p.fill(34, 197, 94, 40);
      p.circle(parentNode.x, parentNode.y, 50);
      p.fill(21, 128, 61);
      p.circle(parentNode.x, parentNode.y, 18);
      p.fill(VOLTS_COLORS.muted);
      p.textFont('JetBrains Mono');
      p.textSize(10);
      p.textAlign(p.CENTER, p.CENTER);
      p.text('s_i', parentNode.x, parentNode.y + 28);

      p.drawingContext.globalAlpha = 1;
    }

    // Top-K bar chart in the middle
    const chartX = W * 0.32;
    const chartW = W * 0.42;
    const rowH = 22;
    const gap = 6;
    const totalH = candidates.length * (rowH + gap) - gap;
    const chartY = H / 2 - totalH / 2;

    // Phase logic
    phaseT++;
    if (phaseT > PHASES[stepPhase]) {
      phaseT = 0;
      stepPhase = (stepPhase + 1) % PHASES.length;
      if (stepPhase === 1) classify();
      if (stepPhase === 4) {
        // advance: pick primary + betas to be new branches; pulse them, then reset
      }
      if (stepPhase === 0) {
        // start new step: reset
        proposeCandidates();
      }
    }

    if (barsAlpha > 0.01) {
      p.drawingContext.globalAlpha = barsAlpha;

      // Title near top
      p.fill(VOLTS_COLORS.muted);
      p.textFont('Inter');
      p.textStyle(p.BOLD);
      p.textSize(10);
      p.textAlign(p.LEFT, p.TOP);
      p.text('TOP-K  CANDIDATES  ·  l_i', chartX, chartY - 22);

      // Connector lines from parent
      p.stroke(21, 128, 61, 60);
      p.strokeWeight(1);
      for (let i = 0; i < candidates.length; i++) {
        const cy = chartY + i * (rowH + gap) + rowH / 2;
        p.line(parentNode.x + 12, parentNode.y, chartX - 6, cy);
      }
      p.noStroke();

      // Draw each candidate bar
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const y = chartY + i * (rowH + gap);
        const kind = stepPhase >= 2 ? c.kind : 'pending';
        drawBar(chartX, y, chartW, rowH, c.ratio, kind, 1);

        // Ratio label
        p.fill(VOLTS_COLORS.textSoft);
        p.textFont('JetBrains Mono');
        p.textStyle(p.NORMAL);
        p.textSize(10);
        p.textAlign(p.LEFT, p.CENTER);
        p.text(c.ratio.toFixed(2), chartX + chartW + 8, y + rowH / 2);

        // β indicator
        if (stepPhase >= 2 && (kind === 'primary' || kind === 'beta')) {
          const tx = chartX + chartW + 38;
          p.noStroke();
          p.fill(kind === 'primary' ? p.color(21, 128, 61) : p.color(217, 119, 6));
          p.textStyle(p.BOLD);
          p.textSize(10);
          p.textAlign(p.LEFT, p.CENTER);
          p.text(kind === 'primary' ? 'primary' : 'β-branch', tx, y + rowH / 2);
        }
      }

      p.drawingContext.globalAlpha = 1;
    }

    // Tree showing new branches being created from s_i.
    // Shown during stepPhase 3 ("Step 4 · spawn") and 4 ("Step 5 · advance").
    // As treeFocus grows, the tree slides from the right side toward the centre
    // and grows in size, since the bars are fading out.
    if (stepPhase >= 3) {
      // k drives the spawn animation. Once we're past phase 3 the spawn is done, so k must stay at 1.
      const k = stepPhase >= 4 ? 1 : Math.min(1, phaseT / PHASES[3]);
      const advance = stepPhase >= 4 ? Math.min(1, phaseT / PHASES[4]) : 0;

      const targets = candidates.filter(c => c.kind === 'primary' || c.kind === 'beta');
      // Centre the tree as bars fade out.
      const treeX = p.lerp(W * 0.83, W * 0.5, treeFocus);
      const treeTopY = p.lerp(H * 0.22, H * 0.20, treeFocus);
      const treeBotY = p.lerp(H * 0.78, H * 0.65, treeFocus);
      const fanWidth = p.lerp(Math.min(W * 0.20, 110), Math.min(W * 0.50, 280), treeFocus);

      // Parent (copy of s_i)
      const parentScale = p.lerp(1.0, 1.5, treeFocus);
      p.noStroke();
      p.fill(34, 197, 94, 40 * k);
      p.circle(treeX, treeTopY, 36 * parentScale);
      p.fill(21, 128, 61, 255 * k);
      p.circle(treeX, treeTopY, 14 * parentScale);
      p.fill(VOLTS_COLORS.muted);
      p.textFont('JetBrains Mono');
      p.textStyle(p.NORMAL);
      p.textSize(10 * parentScale);
      p.textAlign(p.CENTER, p.CENTER);
      p.drawingContext.globalAlpha = k;
      p.text('s_i', treeX, treeTopY + 22 * parentScale);
      p.drawingContext.globalAlpha = 1;

      // Layout children evenly in the fan
      const N = targets.length;
      for (let i = 0; i < N; i++) {
        const c = targets[i];
        const t = N > 1 ? (i / (N - 1)) - 0.5 : 0;
        const cxTarget = treeX + t * fanWidth;
        const cyTarget = treeBotY;

        // Animate growth: line draws from parent toward child as k grows
        const lineEnd = k;
        const ex = p.lerp(treeX, cxTarget, lineEnd);
        const ey = p.lerp(treeTopY + 6, cyTarget, lineEnd);

        const col = c.kind === 'primary' ? p.color(21, 128, 61) : p.color(217, 119, 6);
        // Trunk fade-out when advancing (non-primary lose their connection visually)
        const trunkAlpha = c.kind === 'primary'
          ? 220
          : 220 * (1 - advance * 0.6);

        p.stroke(p.red(col), p.green(col), p.blue(col), trunkAlpha);
        p.strokeWeight(c.kind === 'primary' ? 2.2 : 1.6);
        p.noFill();
        // Slight curve so branches feel organic
        p.bezier(
          treeX, treeTopY + 6,
          treeX + (cxTarget - treeX) * 0.2, treeTopY + (cyTarget - treeTopY) * 0.45,
          treeX + (cxTarget - treeX) * 0.8, treeTopY + (cyTarget - treeTopY) * 0.55,
          ex, ey
        );

        // Child node (appears once the line reaches it)
        const childAlpha = Math.max(0, Math.min(1, (k - 0.55) / 0.4));
        if (childAlpha > 0) {
          const baseR = c.kind === 'primary' ? 14 : 11;
          const r = baseR * p.lerp(1.0, 1.5, treeFocus);
          // soft halo
          p.noStroke();
          p.fill(c.kind === 'primary' ? p.color(34, 197, 94, 35 * childAlpha) : p.color(245, 158, 11, 35 * childAlpha));
          p.circle(cxTarget, cyTarget, r * 2.6);
          p.fill(p.red(col), p.green(col), p.blue(col), 255 * childAlpha);
          p.circle(cxTarget, cyTarget, r);

          // label
          p.fill(VOLTS_COLORS.textSoft);
          p.textFont('JetBrains Mono');
          p.textStyle(p.NORMAL);
          p.textSize(p.lerp(9.5, 12, treeFocus));
          p.textAlign(p.CENTER, p.TOP);
          p.drawingContext.globalAlpha = childAlpha;
          p.text(c.kind === 'primary' ? 'primary' : 'β-branch', cxTarget, cyTarget + r + 4);
          p.drawingContext.globalAlpha = 1;
        }

        // Step 5 highlight: pulse the primary, dim the others
        if (stepPhase >= 4 && childAlpha > 0) {
          if (c.kind === 'primary') {
            const pulse = 0.5 + 0.5 * Math.sin(frame * 0.18);
            p.noStroke();
            p.fill(34, 197, 94, 40 + 60 * pulse);
            p.circle(cxTarget, cyTarget, 40 + 8 * pulse + 18 * treeFocus);
          }
        }
      }

      // Caption underneath the tree — kept well clear of the child labels.
      p.noStroke();
      p.fill(VOLTS_COLORS.muted);
      p.textFont('JetBrains Mono');
      p.textStyle(p.NORMAL);
      p.textSize(p.lerp(10, 12, treeFocus));
      p.textAlign(p.CENTER, p.TOP);
      const captionY = treeBotY + p.lerp(38, 80, treeFocus);
      p.text(`new branches  ·  |B| ≤ k_max=4`, treeX, captionY);
    }

    // Phase label
    const PHASE_LABELS = [
      'Step 1 · propose candidates from logits',
      'Step 2 · validator filters infeasible actions',
      'Step 3 · classify within β = 1.15 of leader',
      'Step 4 · spawn new branches up to k_max',
      'Step 5 · advance, repeat'
    ];
    p.noStroke();
    p.fill(VOLTS_COLORS.textSoft);
    p.textFont('Inter');
    p.textStyle(p.NORMAL);
    p.textSize(11);
    p.textAlign(p.LEFT, p.BOTTOM);
    p.text(PHASE_LABELS[stepPhase], 18, H - 14);
  };
});
