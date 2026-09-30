# Reorderable List

Drag items up and down; others shift to make room

Keywords: drag and drop, sort, rank, todo, playlist, kanban, order, rearrange, priority, dnd, shuffle, move

## CSS

```css
.reorder-item {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
              opacity 0.2s, box-shadow 0.2s;
}
.reorder-item.dragging {
  transition: none;
  opacity: 0.9;
  box-shadow: 0 8px 24px -6px rgba(0,0,0,0.6);
  z-index: 10;
}
```

## React

```jsx
function ReorderList({ items: initial }) {
  const [items, setItems] = useState(initial);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragY, setDragY] = useState(0);
  const startY = useRef(0);
  const itemH = 44;

  const onDown = (i, e) => {
    setDragIdx(i);
    startY.current = e.clientY;
  };
  const onMove = (e) => {
    if (dragIdx === null) return;
    const dy = e.clientY - startY.current;
    setDragY(dy);
    const target = Math.min(items.length - 1,
      Math.max(0, Math.round((i * itemH + dy) / itemH)));
    if (target !== dragIdx) {
      const next = [...items];
      const [m] = next.splice(dragIdx, 1);
      next.splice(target, 0, m);
      setItems(next);
      setDragIdx(target);
      startY.current = e.clientY;
      setDragY(0);
    }
  };
  const onUp = () => { setDragIdx(null); setDragY(0); };

  return (
    <div onPointerMove={onMove} onPointerUp={onUp}>
      {items.map((item, i) => (
        <div
          key={item}
          onPointerDown={(e) => onDown(i, e)}
          style={{
            transform: dragIdx === i ? `translateY(${dragY}px)` : '',
            transition: dragIdx === i ? 'none' : 'transform .3s cubic-bezier(.16,1,.3,1)',
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
}
```

## Prompt guidance

Build a reorderable vertical list where items can be dragged up or down to rearrange. On pointerdown on an item, mark it as dragging (disable its transition, add a shadow). On pointermove translate it by the drag delta; when it crosses the midpoint of an adjacent item, swap their positions in the array and reset the drag origin so the dragged item stays under the cursor. On release, snap it into place with a glide cubic-bezier(0.16,1,0.3,1) transition. Show a drag handle on each item.
