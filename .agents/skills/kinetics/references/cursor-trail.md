# Cursor Trail

A chain of dots chases the pointer with eased lag

Keywords: mouse, pointer, follow, dots, playful, decoration, chase, lag, comet, wake, ambient, fun

## CSS

```css
/* Pure transform work — no layout. Each dot eases toward
   the one ahead of it, so the chain lags into a comet tail. */
.trail-dot { position: absolute; will-change: transform; }
.trail-dot:nth-child(2) { opacity: 0.85; }
.trail-dot:nth-child(3) { opacity: 0.7; }
/* ...decreasing size + opacity down the chain... */
```

## React

```jsx
function CursorTrail({ count = 6 }) {
  const dots = useRef([]);
  const pts = useRef(Array.from({ length: count }, () => ({ x: 0, y: 0 })));
  const target = useRef({ x: 0, y: 0 });

  useEffect(() => {
    let id;
    const tick = () => {
      let lead = target.current;
      pts.current.forEach((p, i) => {
        p.x += (lead.x - p.x) * 0.35;
        p.y += (lead.y - p.y) * 0.35;
        const el = dots.current[i];
        if (el) el.style.transform = `translate(${p.x}px, ${p.y}px)`;
        lead = p;
      });
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div onPointerMove={(e) => {
      const r = e.currentTarget.getBoundingClientRect();
      target.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    }}>
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} ref={el => (dots.current[i] = el)} className="trail-dot" />
      ))}
    </div>
  );
}
```

## Prompt guidance

Build a contained area where a chain of dots follows the cursor with eased lag. Track the pointer; each animation frame, lerp each dot ~35% toward the dot ahead of it (the first toward the cursor) so they form a comet tail. Decrease size and opacity down the chain and hide when the pointer leaves.
