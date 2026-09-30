# Heartbeat Monitor

Glowing dot traces an EKG along the path

Keywords: ekg, pulse, health, vitals, medical, heartbeat, monitor, line, trace, cardio, fitness, alive

## CSS

```css
.dot {
  background: #4cd08a;
  box-shadow: 0 0 12px 2px #4cd08a;
  offset-path: path("M0,42 L80,18 L92,68 L104,42 L230,42");
  animation: trace 2.4s linear infinite;
}
@keyframes trace {
  from { offset-distance: 0%; }
  to   { offset-distance: 100%; }
}
```

## React

```jsx
const PATH = 'M0,42 L80,18 L92,68 L104,42 L230,42';

function Heartbeat() {
  return (
    <div className="ekg">
      <svg viewBox="0 0 230 84">
        <path className="line" d={PATH} />
      </svg>
      <span className="dot" style={{ offsetPath: `path("${PATH}")` }} />
    </div>
  );
}
```

## Prompt guidance

Build a heart-rate monitor. Draw a faint EKG line as an SVG path (flat, a sharp QRS spike, flat, a small bump, flat). Then put a glowing accent dot on the same path using CSS offset-path: path(...) and animate offset-distance from 0% to 100% on an infinite 2.4s linear loop so the dot sweeps along the trace. Give the dot a box-shadow glow so it reads like a live signal.
