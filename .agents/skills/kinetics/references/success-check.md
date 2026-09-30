# Success Check

Ring and tick draw themselves on, then undraw on toggle

Keywords: checkmark, done, complete, confirmation, order placed, payment success, tick, circle, celebrate, form submitted, svg, draw

## CSS

```css
.ring {
  fill: none; stroke: #2A2A2E; stroke-width: 3;
  stroke-dasharray: 151; stroke-dashoffset: 151;
  transition: stroke-dashoffset 0.5s cubic-bezier(0.65, 0, 0.35, 1);
}
.tick {
  fill: none; stroke: #4CD08A; stroke-width: 4; stroke-linecap: round;
  stroke-dasharray: 28; stroke-dashoffset: 28;
  transition: stroke-dashoffset 0.3s ease-out 0.4s;
}
.check.done .ring { stroke: #4CD08A; stroke-dashoffset: 0; }
.check.done .tick { stroke-dashoffset: 0; }
```

## React

```jsx
function SuccessCheck() {
  const [done, setDone] = useState(false);
  return (
    <button className={done ? 'check done' : 'check'}
            onClick={() => setDone(d => !d)}>
      <svg viewBox="0 0 52 52">
        <circle className="ring" cx="26" cy="26" r="24" />
        <path className="tick" d="M15 27 l7 7 l15 -15" />
      </svg>
    </button>
  );
}
```

## Prompt guidance

Build a circular success indicator whose ring and checkmark draw themselves on click. Set stroke-dasharray to each path's length and animate stroke-dashoffset from full to 0 — the ring over ~0.5s, then the tick over ~0.3s with a short delay so it follows. Toggle a .done class; recolor the ring to green as it completes.
