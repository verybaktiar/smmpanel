# Rubber-band Slider

Drag past either end and it stretches, then springs back

Keywords: range, slider, volume, brightness, scrub, overscroll, elastic, stretch, drag, ios, input, bounds

## CSS

```css
.thumb {
  transition: none;                 /* follows the pointer 1:1 */
}
.thumb.snap {
  transition: left 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
/* Past the ends, JS adds only 32% of the overshoot:
   pct = clamped + (raw - clamped) * 0.32  — the rubber band.
   On release it removes the overshoot and lets .snap spring home. */
```

## React

```jsx
function RubberSlider() {
  const track = useRef(null);
  const [pct, setPct] = useState(0.5);
  const [snap, setSnap] = useState(false);

  const at = (clientX, rubber) => {
    const r = track.current.getBoundingClientRect();
    const raw = (clientX - r.left) / r.width;
    const clamped = Math.min(Math.max(raw, 0), 1);
    return rubber ? clamped + (raw - clamped) * 0.32 : clamped;
  };

  return (
    <div ref={track} className="track"
      onPointerMove={(e) => e.buttons && (setSnap(false), setPct(at(e.clientX, true)))}
      onPointerUp={(e) => { setSnap(true); setPct(at(e.clientX, false)); }}
    >
      <span className={snap ? 'thumb snap' : 'thumb'} style={{ left: `${pct * 100}%` }} />
    </div>
  );
}
```

## Prompt guidance

Build a horizontal slider whose thumb resists past the ends like a rubber band. While dragging, map the pointer to 0–1, but when it exceeds the range add only ~32% of the overshoot so it stretches; on release remove the overshoot and spring the thumb back into range with cubic-bezier(0.34,1.56,0.64,1).
