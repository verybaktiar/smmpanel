# Pointer Tooltip

Label trails the cursor with eased follow

Keywords: hover, hint, label, cursor follow, info, help, popover, caption, context, mouse, floating, tip

## CSS

```css
.tip {
  position: absolute;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.zone:hover .tip { opacity: 1; }
/* JS lerps tip x/y toward the pointer each frame */
```

## React

```jsx
function PointerTooltip() {
  const ref = useRef(null);
  const pos = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  useEffect(() => {
    let raf;
    const loop = () => {
      const p = pos.current;
      p.x += (p.tx - p.x) * 0.18;
      p.y += (p.ty - p.y) * 0.18;
      if (ref.current)
        ref.current.style.transform = `translate(${p.x}px, ${p.y}px)`;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    pos.current.tx = e.clientX - r.left;
    pos.current.ty = e.clientY - r.top;
  };
  return (
    <div onMouseMove={onMove} style={{ position: 'relative' }}>
      <span ref={ref} className="tip">follow</span>
    </div>
  );
}
```

## Prompt guidance

Build a tooltip label that smoothly trails the cursor inside a zone. On mousemove store the target x/y relative to the zone; in a requestAnimationFrame loop, lerp the label's current position toward the target by ~0.18 each frame and apply it as a translate, so it eases behind the pointer instead of snapping. Fade the label in on hover and show the live coordinates.
