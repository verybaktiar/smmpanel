# Slide to Unlock

Drag past the latch or it springs back

Keywords: swipe, confirm, iphone, lock screen, drag, commitment, payment confirm, latch, security, gesture, slider, unlock

## CSS

```css
.thumb {
  transition: left 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.track.dragging .thumb { transition: none; }   /* follow finger 1:1 */
.track.unlocked .thumb { background: #4cd08a; }
```

## React

```jsx
function SlideUnlock({ onUnlock }) {
  const [x, setX] = useState(0);
  const max = 184;
  const onMove = (dx) => setX(Math.min(Math.max(dx, 0), max));
  const onEnd = () => {
    if (x >= max * 0.85) { setX(max); onUnlock(); }
    else setX(0); // spring back
  };
  return (
    <div className="track">
      <div
        className="thumb"
        style={{ left: x }}
        onPointerMove={(e) => e.buttons && onMove(x + e.movementX)}
        onPointerUp={onEnd}
      />
    </div>
  );
}
```

## Prompt guidance

Build an iOS-style slide-to-unlock control. A round thumb sits at the left of a pill track; dragging moves it 1:1 with the pointer (disable the transition while dragging) and a green fill grows behind it. On release, if the thumb passed ~85% of the track, latch it open at the far end and mark it unlocked; otherwise spring it back to the start with a cubic-bezier(0.34, 1.56, 0.64, 1).
