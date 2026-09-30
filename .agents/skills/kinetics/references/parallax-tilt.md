# Parallax Tilt

3D rotation tracks pointer position, glow follows beneath

Keywords: 3d card, tilt, hover, perspective, glare, product card, depth, mouse tracking, rotate, showcase, interactive, glow

## CSS

```css
.tilt-zone { perspective: 800px; }
.tilt-card {
  transition: transform 0.15s ease-out;
  transform-style: preserve-3d;
}
/* JS reads pointer position relative to card,
   maps to rotateX/rotateY within a max range */
```

## React

```jsx
function TiltCard({ children }) {
  const ref = useRef(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    setTilt({ x: (py - 0.5) * -16, y: (px - 0.5) * 16 });
  };

  return (
    <div style={{ perspective: 800 }} onMouseMove={onMove} onMouseLeave={() => setTilt({ x: 0, y: 0 })}>
      <div
        ref={ref}
        style={{
          transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
          transition: 'transform .15s ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}
```

## Prompt guidance

Build a card that tilts in 3D toward the cursor with a glow that follows. Set perspective on the wrapper; on mousemove map the pointer position to rotateX/rotateY within ±16deg over a short ease-out transition and move a radial glow to the pointer; reset on mouseleave.
