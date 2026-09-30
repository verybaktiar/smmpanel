# Rotary Knob

Drag in a circle to set a value; snaps to detents on release

Keywords: dial, volume, control, audio, synth, angle, rotate, circular, detent, tuner, settings, temperature, time, clock

## CSS

```css
.knob {
  border-radius: 50%;
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.knob.dragging { transition: none; }
.knob::before {
  content: '';
  position: absolute; top: 8px; left: 50%;
  width: 4px; height: 16px; margin-left: -2px;
  border-radius: 2px; background: #FF8A00;
}
```

## React

```jsx
function RotaryKnob({ max = 270, steps = 10 }) {
  const ref = useRef(null);
  const [angle, setAngle] = useState(0);
  const dragging = useRef(false);
  const prevAngle = useRef(0);
  const pointerOffset = 225;

  const getAngle = (e) => {
    const r = ref.current.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI + 90;
  };

  const onDown = (e) => {
    dragging.current = true;
    prevAngle.current = getAngle(e);
  };
  const onMove = (e) => {
    if (!dragging.current) return;
    const cur = getAngle(e);
    let delta = cur - prevAngle.current;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    prevAngle.current = cur;
    setAngle((a) => Math.min(max, Math.max(0, a + delta)));
  };
  const onUp = () => {
    dragging.current = false;
    setAngle((a) => Math.round(a / (max / steps)) * (max / steps));
  };

  return (
    <div
      ref={ref}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      style={{ transform: `rotate(${angle + pointerOffset}deg)`, transition: dragging.current ? 'none' : 'transform .5s cubic-bezier(.34,1.56,.64,1)' }}
    />
  );
}
```

## Prompt guidance

Build a rotary knob that the user can drag in a circle to set a value from 0 to 270 degrees. On pointerdown record the starting angle from the knob center; on pointermove compute the delta angle, clamp it to 0–270, and rotate the knob. On release snap to the nearest detent (e.g. 10 steps) with a spring cubic-bezier(0.34,1.56,0.64,1). Show the current value as a number below the knob and fill an SVG arc proportional to the angle.
