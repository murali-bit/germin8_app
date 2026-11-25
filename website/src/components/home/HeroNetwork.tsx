import React, { useEffect, useRef } from 'react';

/**
 * Animated geometric network for the homepage hero.
 *
 * The geometry (rings, radials, curved pathways) is built once as a real graph of
 * nodes and edges in a fixed 1600x900 space and never moves. Small gold-white lights
 * walk that graph: they travel along an edge, illuminate the node they reach, then
 * hand over to a connected edge (lines, arcs or curves) and carry on.
 */

const VW = 1600;
const VH = 900;
const CX = VW / 2;
const CY = VH / 2;
const GOLD = '201,163,50'; // #C9A332
const INK = '23,23,23'; // #171717

type Pt = { x: number; y: number };

interface GNode {
  x: number;
  y: number;
  diamond: boolean;
  edges: number[];
  glow: number;
  pulseT: number;
  pulseAmp: number;
}

interface GEdge {
  a: number;
  b: number;
  len: number;
  gold: boolean;
  lit: number;
  pts: Pt[]; // dense polyline, uniform in arc length
  pointAt: (dist: number, fromA: boolean) => Pt;
}

interface Light {
  state: 'wait' | 'run' | 'fade';
  wait: number;
  edge: number;
  from: number;
  s: number;
  speed: number;
  hops: number;
  maxHops: number;
  alpha: number;
  trailLen: number;
  trail: Pt[];
}

const rad = (d: number) => (d * Math.PI) / 180;

function makeEdge(a: number, b: number, nodes: GNode[], f: (u: number) => Pt, gold: boolean): GEdge {
  const N = 72;
  const raw: Pt[] = [];
  for (let i = 0; i <= N; i++) raw.push(f(i / N));
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y));
  const len = cum[N];
  // resample so index maps linearly onto distance
  const pts: Pt[] = [];
  let j = 1;
  for (let i = 0; i <= N; i++) {
    const d = (len * i) / N;
    while (j < N && cum[j] < d) j++;
    const span = cum[j] - cum[j - 1] || 1;
    const t = (d - cum[j - 1]) / span;
    pts.push({ x: raw[j - 1].x + (raw[j].x - raw[j - 1].x) * t, y: raw[j - 1].y + (raw[j].y - raw[j - 1].y) * t });
  }
  const pointAt = (dist: number, fromA: boolean): Pt => {
    const d = Math.min(Math.max(fromA ? dist : len - dist, 0), len);
    const k = (d / len) * N;
    const i = Math.min(Math.floor(k), N - 1);
    const t = k - i;
    return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
  };
  void nodes;
  return { a, b, len, gold, lit: 0, pts, pointAt };
}

function buildGraph() {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const rings = [
    { r: 250, n: 12, off: 0 },
    { r: 400, n: 24, off: 0 },
    { r: 560, n: 24, off: 7.5 },
    { r: 740, n: 36, off: 0 },
    { r: 960, n: 36, off: 5 },
  ];
  const ringNodes: number[][] = [];
  const ringAngle: number[][] = [];

  rings.forEach((ring, ri) => {
    const ids: number[] = [];
    const angs: number[] = [];
    for (let k = 0; k < ring.n; k++) {
      const ang = rad(ring.off + (360 / ring.n) * k);
      nodes.push({
        x: CX + Math.cos(ang) * ring.r,
        y: CY + Math.sin(ang) * ring.r,
        diamond: ri % 2 === 0 ? k % 2 === 0 : k % 6 === 0,
        edges: [],
        glow: 0,
        pulseT: 1,
        pulseAmp: 0,
      });
      ids.push(nodes.length - 1);
      angs.push(ang);
    }
    ringNodes.push(ids);
    ringAngle.push(angs);
  });

  const seen = new Set<string>();
  const link = (a: number, b: number, f: (u: number) => Pt, gold: boolean) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    const e = makeEdge(a, b, nodes, f, gold);
    edges.push(e);
    nodes[a].edges.push(edges.length - 1);
    nodes[b].edges.push(edges.length - 1);
  };
  const goldPick = (i: number) => (i * 7 + 3) % 5 === 0;

  // ring arcs
  rings.forEach((ring, ri) => {
    const ids = ringNodes[ri];
    ids.forEach((id, k) => {
      const nid = ids[(k + 1) % ids.length];
      const a0 = ringAngle[ri][k];
      const a1 = a0 + (Math.PI * 2) / ring.n;
      link(id, nid, (u) => ({ x: CX + Math.cos(a0 + (a1 - a0) * u) * ring.r, y: CY + Math.sin(a0 + (a1 - a0) * u) * ring.r }), goldPick(ri * 31 + k));
    });
  });

  // radial / diagonal links between neighbouring rings
  const nearest = (ri: number, ang: number) => {
    let best = 0;
    let bd = Infinity;
    ringAngle[ri].forEach((a, k) => {
      let d = Math.abs(((a - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      d = Math.abs(d);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    return ringNodes[ri][best];
  };
  for (let ri = 1; ri < rings.length; ri++) {
    ringNodes[ri].forEach((id, k) => {
      const inner = nearest(ri - 1, ringAngle[ri][k]);
      const A = nodes[inner];
      const B = nodes[id];
      link(inner, id, (u) => ({ x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u }), goldPick(ri * 17 + k));
    });
  }
  // also make sure every inner node reaches outward
  for (let ri = 0; ri < rings.length - 1; ri++) {
    ringNodes[ri].forEach((id, k) => {
      const outer = nearest(ri + 1, ringAngle[ri][k]);
      const A = nodes[id];
      const B = nodes[outer];
      link(id, outer, (u) => ({ x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u }), false);
    });
  }

  // long curved pathways spanning rings
  for (let k = 0; k < 24; k += 3) {
    const a = ringNodes[1][k];
    const b = nearest(3, ringAngle[1][k] + rad(38));
    const A = nodes[a];
    const B = nodes[b];
    const mx = (A.x + B.x) / 2;
    const my = (A.y + B.y) / 2;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const bend = k % 6 === 0 ? 0.28 : -0.28;
    const cx = mx - dy * bend;
    const cy = my + dx * bend;
    link(a, b, (u) => {
      const v = 1 - u;
      return { x: v * v * A.x + 2 * v * u * cx + u * u * B.x, y: v * v * A.y + 2 * v * u * cy + u * u * B.y };
    }, true);
  }

  return { nodes, edges };
}

const DECOR_DASH_RADII = [325, 650, 850];

export const HeroNetwork: React.FC<{ className?: string }> = ({ className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { nodes, edges } = buildGraph();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let scale = 1;
    let offX = 0;
    let offY = 0;
    let layer: HTMLCanvasElement | null = null;

    const drawNodeShape = (c: CanvasRenderingContext2D, n: GNode) => {
      if (n.diamond) {
        const s = 4.6;
        const g = c.createLinearGradient(n.x - s, n.y - s, n.x + s, n.y + s);
        g.addColorStop(0, 'rgb(236,214,138)');
        g.addColorStop(0.5, `rgb(${GOLD})`);
        g.addColorStop(1, 'rgb(158,124,30)');
        c.beginPath();
        c.moveTo(n.x, n.y - s);
        c.lineTo(n.x + s, n.y);
        c.lineTo(n.x, n.y + s);
        c.lineTo(n.x - s, n.y);
        c.closePath();
        c.fillStyle = g;
        c.fill();
        c.lineWidth = 0.8;
        c.strokeStyle = `rgba(${INK},0.25)`;
        c.stroke();
      } else {
        c.beginPath();
        c.arc(n.x, n.y, 2.4, 0, Math.PI * 2);
        c.fillStyle = `rgba(${GOLD},0.85)`;
        c.fill();
        c.beginPath();
        c.arc(n.x, n.y, 5, 0, Math.PI * 2);
        c.lineWidth = 0.7;
        c.strokeStyle = `rgba(${INK},0.12)`;
        c.stroke();
      }
    };

    const strokeEdge = (c: CanvasRenderingContext2D, e: GEdge) => {
      c.beginPath();
      c.moveTo(e.pts[0].x, e.pts[0].y);
      for (let i = 1; i < e.pts.length; i++) c.lineTo(e.pts[i].x, e.pts[i].y);
      c.stroke();
    };

    const visible = (x: number, y: number, pad = 0) => {
      const sx = x * scale + offX;
      const sy = y * scale + offY;
      return sx > -pad && sx < w + pad && sy > -pad && sy < h + pad;
    };

    const buildLayer = () => {
      layer = document.createElement('canvas');
      layer.width = Math.round(w * dpr);
      layer.height = Math.round(h * dpr);
      const c = layer.getContext('2d');
      if (!c) return;
      c.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
      c.lineCap = 'round';

      // decorative dashed orbits
      c.setLineDash([2, 9]);
      c.lineWidth = 1;
      c.strokeStyle = `rgba(${INK},0.14)`;
      DECOR_DASH_RADII.forEach((r) => {
        c.beginPath();
        c.arc(CX, CY, r, 0, Math.PI * 2);
        c.stroke();
      });
      c.setLineDash([]);

      // edges
      edges.forEach((e) => {
        c.lineWidth = e.gold ? 1.1 : 1;
        c.strokeStyle = e.gold ? `rgba(${GOLD},0.42)` : `rgba(${INK},0.1)`;
        strokeEdge(c, e);
      });

      // nodes
      nodes.forEach((n) => {
        if (visible(n.x, n.y, 20)) drawNodeShape(c, n);
      });
    };

    const resize = () => {
      const r = host.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      scale = w < 700 ? Math.max(h / VH, w / 900) : Math.max(w / VW, h / VH);
      offX = (w - VW * scale) / 2;
      offY = (h - VH * scale) / 2;
      buildLayer();
      if (reduce) frame(0);
    };

    // cursor proximity: nodes near the pointer wake up
    const mouse = { x: -9999, y: -9999 };
    const onMove = (ev: PointerEvent) => {
      const r = host.getBoundingClientRect();
      mouse.x = (ev.clientX - r.left - offX) / scale;
      mouse.y = (ev.clientY - r.top - offY) / scale;
    };
    const onLeave = () => {
      mouse.x = mouse.y = -9999;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);

    // ---- lights ----------------------------------------------------------
    const LIGHTS = window.innerWidth < 700 ? 6 : 10;
    const lights: Light[] = Array.from({ length: LIGHTS }, (_, i) => ({
      state: 'wait',
      wait: 0.4 + i * 0.55 + Math.random() * 0.6,
      edge: 0,
      from: 0,
      s: 0,
      speed: 80,
      hops: 0,
      maxHops: 8,
      alpha: 0,
      trailLen: 120,
      trail: [],
    }));

    const pickNode = () => {
      for (let tries = 0; tries < 60; tries++) {
        const i = Math.floor(Math.random() * nodes.length);
        const n = nodes[i];
        if (visible(n.x, n.y, -10) && n.edges.length) return i;
      }
      return 0;
    };

    const nextEdge = (nodeIdx: number, cameFrom: number) => {
      const opts = nodes[nodeIdx].edges;
      const alt = opts.filter((e) => e !== cameFrom);
      const pool = alt.length ? alt : opts;
      return pool[Math.floor(Math.random() * pool.length)];
    };

    const spawn = (l: Light) => {
      const n = pickNode();
      l.from = n;
      l.edge = nextEdge(n, -1);
      l.s = 0;
      l.hops = 0;
      l.maxHops = 6 + Math.floor(Math.random() * 9);
      l.speed = 70 + Math.random() * 90;
      l.trailLen = 90 + Math.random() * 90;
      l.alpha = 0;
      l.trail = [];
      l.state = 'run';
      const nd = nodes[n];
      nd.glow = 1;
      nd.pulseT = 0;
      nd.pulseAmp = 0.7;
    };

    const update = (dt: number) => {
      const decayN = Math.exp(-dt * 1.3);
      const decayE = Math.exp(-dt * 0.9);
      nodes.forEach((n) => {
        n.glow *= decayN;
        if (n.pulseT < 1) n.pulseT = Math.min(1, n.pulseT + dt / 1.2);
      });
      edges.forEach((e) => (e.lit *= decayE));

      lights.forEach((l) => {
        if (l.state === 'wait') {
          l.wait -= dt;
          if (l.wait <= 0) spawn(l);
          return;
        }
        if (l.state === 'run') l.alpha = Math.min(1, l.alpha + dt * 2.2);
        else {
          l.alpha -= dt * 1.1;
          if (l.alpha <= 0) {
            l.state = 'wait';
            l.wait = 0.6 + Math.random() * 3;
            l.trail = [];
            return;
          }
        }

        l.s += l.speed * dt;
        let e = edges[l.edge];
        e.lit = Math.min(1, e.lit + dt * 4);
        while (l.s >= e.len) {
          l.s -= e.len;
          const arrived = e.a === l.from ? e.b : e.a;
          const nd = nodes[arrived];
          nd.glow = 1;
          nd.pulseT = 0;
          nd.pulseAmp = Math.random() < 0.3 ? 1.5 : 0.8;
          l.hops++;
          l.from = arrived;
          if (l.hops >= l.maxHops && l.state === 'run') l.state = 'fade';
          l.edge = nextEdge(arrived, l.edge);
          e = edges[l.edge];
        }

        const p = e.pointAt(l.s, e.a === l.from);
        l.trail.push(p);
        // trim by length
        let acc = 0;
        for (let i = l.trail.length - 1; i > 0; i--) {
          acc += Math.hypot(l.trail[i].x - l.trail[i - 1].x, l.trail[i].y - l.trail[i - 1].y);
          if (acc > l.trailLen) {
            l.trail.splice(0, i - 1);
            break;
          }
        }
      });
    };

    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (layer) ctx.drawImage(layer, 0, 0);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // illuminated pathways
      edges.forEach((e) => {
        if (e.lit < 0.03) return;
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = `rgba(${GOLD},${(e.lit * 0.38).toFixed(3)})`;
        strokeEdge(ctx, e);
      });

      // nodes lighting up
      nodes.forEach((n) => {
        const md = Math.hypot(n.x - mouse.x, n.y - mouse.y);
        if (md < 170) {
          const k = 1 - md / 170;
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 26);
          g.addColorStop(0, `rgba(${GOLD},${(0.5 * k).toFixed(3)})`);
          g.addColorStop(1, `rgba(${GOLD},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 26, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(n.x, n.y, 8 + 4 * k, 0, Math.PI * 2);
          ctx.lineWidth = 0.9;
          ctx.strokeStyle = `rgba(${GOLD},${(0.6 * k).toFixed(3)})`;
          ctx.stroke();
        }
        if (n.glow > 0.03 && visible(n.x, n.y, 40)) {
          const r = 22 * (0.5 + n.glow * 0.5);
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r);
          g.addColorStop(0, `rgba(${GOLD},${(0.55 * n.glow).toFixed(3)})`);
          g.addColorStop(1, `rgba(${GOLD},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
          ctx.fill();
          drawNodeShape(ctx, n);
          ctx.beginPath();
          ctx.arc(n.x, n.y, 1.8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${Math.min(1, n.glow).toFixed(3)})`;
          ctx.fill();
        }
        if (n.pulseT < 1 && visible(n.x, n.y, 60)) {
          const t = n.pulseT;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 7 + t * 30 * Math.min(1.3, n.pulseAmp), 0, Math.PI * 2);
          ctx.lineWidth = 1;
          ctx.strokeStyle = `rgba(${GOLD},${((1 - t) * (1 - t) * 0.5 * n.pulseAmp).toFixed(3)})`;
          ctx.stroke();
        }
      });

      // travelling lights
      lights.forEach((l) => {
        const tr = l.trail;
        const m = tr.length;
        if (l.state === 'wait' || m < 2) return;
        for (let i = 1; i < m; i++) {
          const k = i / (m - 1);
          const a = Math.pow(k, 1.7) * l.alpha;
          if (a < 0.01) continue;
          if (k > 0.55) {
            ctx.beginPath();
            ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
            ctx.lineTo(tr[i].x, tr[i].y);
            ctx.lineWidth = 2 + 5 * k;
            ctx.strokeStyle = `rgba(${GOLD},${(a * 0.13).toFixed(3)})`;
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
          ctx.lineTo(tr[i].x, tr[i].y);
          ctx.lineWidth = 0.7 + 1.5 * k;
          ctx.strokeStyle = `rgba(${GOLD},${(a * 0.95).toFixed(3)})`;
          ctx.stroke();
        }
        const head = tr[m - 1];
        const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 17);
        g.addColorStop(0, `rgba(255,248,222,${(0.85 * l.alpha).toFixed(3)})`);
        g.addColorStop(0.3, `rgba(${GOLD},${(0.45 * l.alpha).toFixed(3)})`);
        g.addColorStop(1, `rgba(${GOLD},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(head.x, head.y, 2.1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${l.alpha.toFixed(3)})`;
        ctx.fill();
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = `rgba(${GOLD},${(0.9 * l.alpha).toFixed(3)})`;
        ctx.stroke();
      });
    };

    function frame(dt: number) {
      if (reduce) {
        // single static frame with a few illuminated nodes
        nodes.forEach((n, i) => {
          n.glow = i % 17 === 0 ? 0.8 : 0;
          n.pulseT = 1;
        });
      } else update(dt);
      draw();
    }

    // ---- loop control ----------------------------------------------------
    let raf = 0;
    let last = 0;
    let running = false;
    let inView = true;

    const tick = (t: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      frame(dt);
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (reduce || running || !inView || document.hidden) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const io = new IntersectionObserver(([en]) => {
      inView = en.isIntersecting;
      if (inView) start();
      else stop();
    });
    io.observe(host);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={className} style={{ width: '100%', height: '100%', display: 'block' }} />;
};
