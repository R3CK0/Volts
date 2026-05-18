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
  let nodes = [];          // { x, y, depth, kind, age, parent }
  let edges = [];          // { from, to, kind, age }
  let activeLeaves = [];   // node refs that are still extendable
  let phase = 'grow';      // grow | hold | fade
  let phaseTimer = 0;
  let stepTimer = 0;
  const STEP_INTERVAL = 28;  // frames between expansion steps
  const KMAX = 4;
  const MAX_DEPTH = 7;
  const BETA_RATIO = 0.55;   // probability of spawning a β-branch when room allows
  const INVALID_RATE = 0.32; // some candidates get rejected by validator

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
    const root = { x: W / 2, y: 60, depth: 0, kind: 'primary', age: 0, parent: null };
    nodes.push(root);
    activeLeaves.push(root);
    phase = 'grow'; phaseTimer = 0; stepTimer = 0;
  }

  function depthY(d) {
    const top = 60, bottom = H - 60;
    return top + (bottom - top) * (d / MAX_DEPTH);
  }

  function expand() {
    // For each currently active leaf, propose 2–4 candidates.
    // Validate them; keep up to one primary; spawn β-branches if room < KMAX.
    const newLeaves = [];
    for (const leaf of activeLeaves) {
      if (leaf.depth >= MAX_DEPTH) continue;
      // 1) propose candidates
      const cands = Math.floor(p.random(3, 5));
      const proposals = [];
      for (let i = 0; i < cands; i++) {
        const valid = p.random() > INVALID_RATE;
        proposals.push({ valid, score: p.random() });
      }
      // sort by score desc
      proposals.sort((a, b) => b.score - a.score);
      const validProps = proposals.filter(q => q.valid);

      // 2) place each candidate as a fanned node, but only valid ones get extended
      const fanAngle = p.PI / 3;
      const fanCount = proposals.length;
      const childY = depthY(leaf.depth + 1);
      const dy = childY - leaf.y;

      // Decide which valid proposals become branches.
      let primaryAssigned = false;
      let activeCount = newLeaves.length + activeLeaves.filter(l => l !== leaf && l.depth < MAX_DEPTH).length;

      // We need to know who is invalid vs pruned for the visual.
      // Strategy: of the proposals, the top valid → primary; next valid within ratio & under cap → β-branch; rest of valids → pruned (grey).
      for (let i = 0; i < proposals.length; i++) {
        const q = proposals[i];
        const t = (i + 0.5) / fanCount - 0.5;
        const angle = t * fanAngle;
        const dist = Math.sqrt(dy * dy + (dy * Math.tan(angle)) ** 2) * 0.95;
        const cx = leaf.x + Math.sin(angle) * dist;
        const cy = leaf.y + Math.cos(angle) * dist;

        let kind;
        if (!q.valid) {
          kind = 'invalid';
        } else if (!primaryAssigned) {
          kind = 'primary';
          primaryAssigned = true;
        } else if (activeCount < KMAX && p.random() < BETA_RATIO) {
          kind = 'beta';
          activeCount++;
        } else {
          kind = 'pruned';
        }

        const node = { x: cx, y: cy, depth: leaf.depth + 1, kind, age: 0, parent: leaf };
        nodes.push(node);
        edges.push({ from: leaf, to: node, kind, age: 0 });

        if (kind === 'primary' || kind === 'beta') {
          newLeaves.push(node);
        }
      }
    }
    // active leaves for next step = newLeaves capped at KMAX (keep highest-y so we always feel progress)
    newLeaves.sort((a, b) => b.y - a.y);
    activeLeaves = newLeaves.slice(0, KMAX);

    // termination: if no active leaves or at max depth → hold then fade
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
    // generate softmax-ish scores
    let raw = [];
    for (let i = 0; i < K; i++) raw.push(p.random(0.4, 1));
    raw.sort((a, b) => b - a);
    // normalize so leader is 1.0
    const lead = raw[0];
    for (let i = 0; i < K; i++) raw[i] /= lead;
    // mark some invalid (lower priority)
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

    // Right side: emerging branches
    if (stepPhase >= 3) {
      const k = Math.min(1, phaseT / PHASES[3]);
      const targets = candidates.filter(c => c.kind === 'primary' || c.kind === 'beta');
      const bx = W * 0.86;
      const startY = H / 2 - ((targets.length - 1) * 28) / 2;
      for (let i = 0; i < targets.length; i++) {
        const c = targets[i];
        const py = chartY + candidates.indexOf(c) * (rowH + gap) + rowH / 2;
        const ny = startY + i * 28;
        const xa = chartX + chartW + 80;
        const xb = bx;
        const xm = p.lerp(xa, xb, k);
        const ym = p.lerp(py, ny, k);

        p.stroke(c.kind === 'primary' ? p.color(21, 128, 61, 220) : p.color(217, 119, 6, 220));
        p.strokeWeight(1.6);
        p.noFill();
        p.bezier(xa, py, xa + 30, py, xm - 30, ym, xm, ym);

        p.noStroke();
        p.fill(c.kind === 'primary' ? p.color(21, 128, 61) : p.color(217, 119, 6));
        p.circle(xm, ym, c.kind === 'primary' ? 14 : 11);
      }

      p.noStroke();
      p.fill(VOLTS_COLORS.muted);
      p.textFont('JetBrains Mono');
      p.textSize(10);
      p.textAlign(p.CENTER, p.TOP);
      p.text(`|B| ≤ k_max=4`, bx, H / 2 + 40);
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
