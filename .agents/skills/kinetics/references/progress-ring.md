# Progress Ring

Circular stroke eases to a new value on each run

Keywords: circular progress, donut, percent, goal, fitness, activity ring, dashboard, kpi, completion, radial, gauge, tracker

## CSS

```css
.ring .prog {
  fill: none; stroke: #FF8A00; stroke-width: 6; stroke-linecap: round;
  stroke-dasharray: 213.6;            /* 2π · r (r = 34) */
  transition: stroke-dashoffset 0.9s cubic-bezier(0.16, 1, 0.3, 1);
}
/* offset = circumference · (1 − pct); rotate −90deg so it
   starts at 12 o'clock. JS sets the offset + label. */
```

## React

```jsx
function ProgressRing({ pct }) {
  const C = 2 * Math.PI * 34;
  return (
    <svg viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx="40" cy="40" r="34" className="track" />
      <circle
        cx="40" cy="40" r="34" className="prog"
        style={{
          strokeDasharray: C,
          strokeDashoffset: C * (1 - pct / 100),
          transition: 'stroke-dashoffset .9s cubic-bezier(.16,1,.3,1)',
        }}
      />
    </svg>
  );
}
```

## Prompt guidance

Build a circular progress ring driven by a percentage. Use two stacked SVG circles (track + progress); set the progress circle's stroke-dasharray to its circumference (2π·r) and animate stroke-dashoffset to circumference·(1−pct) with cubic-bezier(0.16,1,0.3,1) over ~0.9s. Rotate the ring −90deg so it fills from the top, and show the percentage in the center.
