# Value Scrubber

Drag horizontally to scrub the number

Keywords: number input, drag, slider, numeric, dollar amount, price, currency, budget, money, date, year, age, scrub, fine tune, figma, timeline

## CSS

```css
.value {
  cursor: ew-resize;
  touch-action: none;
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.value.scrubbing {
  color: #ff8a00;
  transform: scale(1.06);
}
```

## React

```jsx
function Scrubber({ start = 48 }) {
  const [v, setV] = useState(start);
  const onDown = (e) => {
    const x0 = e.clientX, v0 = v;
    const move = (m) => setV(v0 + Math.round(m.clientX - x0));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <span style={{ cursor: 'ew-resize' }} onPointerDown={onDown}>
      {v}
    </span>
  );
}
```

## Prompt guidance

Build a draggable number scrubber: a large value you can click and drag horizontally to change, like a Blender/After Effects field. On pointerdown capture the start X and value; on pointermove add the pixel delta to the original value (1px ≈ 1 unit). Show an ew-resize cursor, pop the value to scale(1.06) with a spring while scrubbing, and release cleanly on pointerup.
