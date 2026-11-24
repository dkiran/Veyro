import { useEffect, useRef } from 'react';

interface Node { x: number; y: number; n: number[] }
interface Car { a: number; b: number; t: number; speed: number; trail: { x: number; y: number }[]; hue: number }

/** Animated route network: vehicles glide between nodes leaving glowing trails. Purely decorative. */
export default function LoginBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, raf = 0, last = performance.now();
    let nodes: Node[] = [], cars: Car[] = [];

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.max(8, Math.min(26, Math.round((w * h) / 52000)));
      nodes = Array.from({ length: count }, () => ({ x: Math.random() * w, y: Math.random() * h, n: [] }));
      // connect each node to its 2-3 nearest neighbours (undirected)
      nodes.forEach((p, i) => {
        nodes.map((q, j) => ({ j, d: (p.x - q.x) ** 2 + (p.y - q.y) ** 2 }))
          .filter((o) => o.j !== i).sort((a, b) => a.d - b.d).slice(0, 3)
          .forEach(({ j }) => { if (!p.n.includes(j)) p.n.push(j); if (!nodes[j].n.includes(i)) nodes[j].n.push(i); });
      });
      cars = Array.from({ length: Math.round(count * 0.9) }, () => {
        const a = Math.floor(Math.random() * nodes.length);
        return { a, b: nodes[a].n[Math.floor(Math.random() * nodes[a].n.length)], t: Math.random(), speed: 0.05 + Math.random() * 0.09, trail: [], hue: 150 + Math.random() * 70 };
      });
    };

    const pos = (c: Car) => {
      const A = nodes[c.a], B = nodes[c.b];
      return { x: A.x + (B.x - A.x) * c.t, y: A.y + (B.y - A.y) * c.t };
    };

    const draw = (time: number, dt: number) => {
      ctx.clearRect(0, 0, w, h);
      // faint map grid
      ctx.strokeStyle = 'rgba(148,163,184,0.06)'; ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      // routes
      ctx.strokeStyle = 'rgba(96,165,250,0.16)'; ctx.lineWidth = 1.2;
      nodes.forEach((p, i) => p.n.forEach((j) => { if (j > i) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke(); } }));
      // pulsing nodes
      nodes.forEach((p, i) => {
        const pulse = 0.5 + 0.5 * Math.sin(time / 900 + i);
        ctx.fillStyle = `rgba(147,197,253,${0.35 + pulse * 0.3})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(147,197,253,${0.18 * (1 - pulse)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 4 + pulse * 10, 0, Math.PI * 2); ctx.stroke();
      });
      // vehicles
      for (const c of cars) {
        if (dt > 0) {
          const A = nodes[c.a], B = nodes[c.b];
          const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
          c.t += (c.speed * 120 * dt) / len;
          if (c.t >= 1) {
            const from = c.a; c.a = c.b;
            const opts = nodes[c.a].n.filter((k) => k !== from);
            c.b = opts.length ? opts[Math.floor(Math.random() * opts.length)] : from;
            c.t = 0;
          }
          c.trail.push(pos(c)); if (c.trail.length > 26) c.trail.shift();
        }
        for (let i = 1; i < c.trail.length; i++) {
          const k = i / c.trail.length;
          ctx.strokeStyle = `hsla(${c.hue},90%,65%,${k * 0.55})`; ctx.lineWidth = 1 + k * 2.2; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(c.trail[i - 1].x, c.trail[i - 1].y); ctx.lineTo(c.trail[i].x, c.trail[i].y); ctx.stroke();
        }
        const p = pos(c);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
        g.addColorStop(0, `hsla(${c.hue},95%,70%,0.9)`); g.addColorStop(1, `hsla(${c.hue},95%,60%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      draw(now, dt);
      raf = requestAnimationFrame(frame);
    };
    const start = () => { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(frame); };
    const onVis = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    const onResize = () => { build(); if (reduce) draw(performance.now(), 0); };

    build();
    if (reduce) { for (const c of cars) { c.t = Math.random(); } draw(performance.now(), 0); }
    else { start(); document.addEventListener('visibilitychange', onVis); }
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  return <canvas ref={ref} className="login-bg" aria-hidden="true" />;
}
