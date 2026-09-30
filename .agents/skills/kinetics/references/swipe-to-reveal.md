# Swipe to Reveal

Drag an item horizontally to expose action buttons

Keywords: actions, delete, archive, mobile, list item, gesture, email, ios, hidden buttons, slide, mail app, drag

## CSS

```css
.swipe-item {
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.swipe-item.dragging { transition: none; }
.swipe-item.open { transform: translateX(-96px); }
```

## React

```jsx
function SwipeToReveal() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const start = useRef(0);
  const dragging = useRef(false);

  const onDown = (e) => {
    dragging.current = true;
    start.current = e.clientX;
    ref.current.classList.add('dragging');
  };
  const onMove = (e) => {
    if (!dragging.current) return;
    const dx = Math.min(0, e.clientX - start.current);
    ref.current.style.transform = `translateX(${dx}px)`;
  };
  const onUp = (e) => {
    if (!dragging.current) return;
    dragging.current = false;
    ref.current.classList.remove('dragging');
    const dx = e.clientX - start.current;
    setOpen(dx < -96);
    ref.current.style.transform = '';
  };

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: 0 }}>
        <button>Archive</button>
        <button>Delete</button>
      </div>
      <div
        ref={ref}
 className={open ? 'swipe-item open' : 'swipe-item'}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        Swipe me left
      </div>
    </div>
  );
}
```

## Prompt guidance

Build a list item that can be swiped left to reveal archive and delete action buttons behind it. Track pointerdown/move/up, translate the item left following the pointer (clamped to 0 on the right). On release, if dragged past ~96px add an .open class that holds it at translateX(-96px) with a spring transition; otherwise spring it back to 0. The action buttons sit absolutely behind the item.
