# Before / After

Drag the handle to wipe between layers

Keywords: comparison, slider, image compare, split view, wipe, handle, drag, photo editing, difference, versus, reveal, juxtapose

## CSS

```css
.after  { clip-path: inset(0 50% 0 0); }   /* reveal up to the divider */
.divider, .handle { left: 50%; }
/* JS sets:  after.clipPath = `inset(0 ${100 - pct}% 0 0)` */
```

## React

```jsx
function Compare({ before, after }) {
  const [pct, setPct] = useState(50);
  const onMove = (e) => {
    if (!e.buttons) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPct(((e.clientX - r.left) / r.width) * 100);
  };
  return (
    <div className="compare" onPointerMove={onMove}>
      {before}
      <div style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>{after}</div>
      <div className="divider" style={{ left: `${pct}%` }} />
    </div>
  );
}
```

## Prompt guidance

Build a before/after image comparison slider. Stack two full-size layers; clip the top (after) layer with clip-path: inset(0 R% 0 0). Dragging a centre handle horizontally sets the percentage so R = 100 - pct, wiping the after layer in and out while a thin vertical divider and round handle track the split. Clamp to 0–100% and update on pointermove while pressed.
