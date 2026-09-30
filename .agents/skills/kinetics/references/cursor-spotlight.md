# Cursor Spotlight

Radial glow follows the pointer across a contained surface

Keywords: spotlight, flashlight, hover glow, radial, mouse follow, reveal, dark, torch, highlight, gradient, interactive, beam

## CSS

```css
.spotlight-glow {
  position: absolute;
  width: 220px; height: 220px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255,138,0,0.22), transparent 70%);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
/* JS sets glow.style.left/top to pointer position
   relative to the container on every mousemove */
```

## React

```jsx
function SpotlightSurface({ children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: -200, y: -200 });

  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  return (
    <div ref={ref} onMouseMove={onMove} style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute',
        width: 220, height: 220, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,138,0,0.22), transparent 70%)',
        left: pos.x, top: pos.y,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }} />
      {children}
    </div>
  );
}
```

## Prompt guidance

Build a surface with a soft radial spotlight that follows the cursor. Inside an overflow-hidden container place an absolutely-positioned radial-gradient circle and on mousemove set its left/top to the pointer position (translate -50% to center it). Use pointer-events: none so it never blocks interaction.
