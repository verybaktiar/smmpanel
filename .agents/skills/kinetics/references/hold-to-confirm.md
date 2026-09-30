# Hold to Confirm

Press and hold; a ring fills, release early to cancel

Keywords: long press, destructive, delete confirmation, safety, dangerous action, press and hold, ring, timer, guard, verify, deliberate, confirm

## CSS

```css
.hold-btn .prog {
  stroke-dasharray: 207;
  stroke-dashoffset: 207;            /* empty ring */
  transition: stroke-dashoffset 0.2s ease-out;
}
.hold-btn.holding .prog {
  stroke-dashoffset: 0;              /* fill over the hold */
  transition: stroke-dashoffset 0.8s linear;
}
/* JS adds .holding on pointerdown, and a 800ms timer
   promotes it to .done (or cancels on early release). */
```

## React

```jsx
function HoldToConfirm({ onConfirm, ms = 800 }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef(null);

  const start = () => {
    setHolding(true);
    timer.current = setTimeout(() => { setHolding(false); onConfirm(); }, ms);
  };
  const cancel = () => { clearTimeout(timer.current); setHolding(false); };

  return (
    <button
      className={holding ? 'hold-btn holding' : 'hold-btn'}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
    >
      <svg className="ring" viewBox="0 0 72 72">
        <circle className="track" cx="36" cy="36" r="33" />
        <circle className="prog" cx="36" cy="36" r="33" />
      </svg>
      <span>Hold</span>
    </button>
  );
}
```

## Prompt guidance

Build a circular 'hold to confirm' button with an SVG progress ring. On pointerdown animate the ring's stroke-dashoffset from full to 0 over 800ms linear; if held the whole time fire confirm and flash a success state, otherwise cancel and snap the ring back on early release.
