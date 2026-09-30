# Drag to Dismiss

Pointer-tracked drag, snaps back or flies off past threshold

Keywords: swipe, delete, remove, gesture, flick, card, mobile, touch, throw, discard, snap back, tinder

## CSS

```css
.drag-card {
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1),
              opacity 0.35s;
  touch-action: none;
}
.drag-card.snap-back {
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
/* JS tracks pointerdown/move/up, applies translate
   proportional to drag distance, checks threshold on release */
```

## React

```jsx
function DraggableCard({ onDismiss, children }) {
  const [x, setX] = useState(0);
  const start = useRef(0);
  const dragging = useRef(false);

  const onDown = (e) => { dragging.current = true; start.current = e.clientX; };
  const onMove = (e) => {
    if (!dragging.current) return;
    setX(e.clientX - start.current);
  };
  const onUp = () => {
    dragging.current = false;
    if (Math.abs(x) > 100) onDismiss();
    else setX(0);
  };

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      style={{
        transform: `translateX(${x}px) rotate(${x * 0.05}deg)`,
        opacity: Math.max(1 - Math.abs(x) / 250, 0.3),
        transition: dragging.current ? 'none' : 'transform .5s cubic-bezier(.34,1.56,.64,1)',
      }}
    >
      {children}
    </div>
  );
}
```

## Prompt guidance

Build a card you can drag horizontally with the pointer to dismiss. Track pointerdown/move/up, translate by the drag delta plus a subtle rotation, and fade opacity with distance. On release past a 100px threshold fling it off-screen; otherwise spring it back with cubic-bezier(0.34,1.56,0.64,1).
