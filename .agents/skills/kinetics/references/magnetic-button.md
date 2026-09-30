# Magnetic Button

Cursor pulls the button toward it inside a dead zone

Keywords: magnet, hover, attract, pull, cursor, sticky, cta, playful, pointer, proximity, gravity, follow

## CSS

```css
.magnet-btn {
  transition: transform 0.15s ease-out;
}
/* JS computes offset from pointer to center,
   multiplies by a pull factor, applies translate */
```

## React

```jsx
function MagneticButton() {
  const ref = useRef(null);
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    ref.current.style.transform =
      `translate(${x * 0.35}px, ${y * 0.35}px)`;
  };
  const onLeave = () => {
    ref.current.style.transform = 'translate(0,0)';
  };
  return (
    <div onMouseMove={onMove} onMouseLeave={onLeave}>
      <button ref={ref} style={{ transition: 'transform .15s ease-out' }}>
        Hover near me
      </button>
    </div>
  );
}
```

## Prompt guidance

Build a button that is magnetically pulled toward the cursor while the pointer is inside its surrounding zone. On mousemove, translate the button toward the pointer by ~35% of the offset from its center; reset to translate(0,0) on mouseleave. Use a short transform transition (~0.15s ease-out) so it glides rather than snaps.
