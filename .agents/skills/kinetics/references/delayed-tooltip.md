# Delayed Tooltip

Appears after a pause, disappears instantly on exit

Keywords: tooltip delay, hover, hint, help, dwell, patience, info, popover, wait, ux, label, show

## CSS

```css
.tooltip-bubble {
  opacity: 0;
  transform: translateX(-50%) scale(0.85);
  transition: opacity 0.15s, transform 0.15s;
}
.tooltip-zone:hover .tooltip-bubble {
  opacity: 1;
  transform: translateX(-50%) scale(1);
  /* delay only on the way IN */
  transition: opacity 0.15s 0.4s, transform 0.15s 0.4s;
}
```

## React

```jsx
function DelayedTooltip({ label, children }) {
  const [show, setShow] = useState(false);
  const timer = useRef(null);

  const onEnter = () => { timer.current = setTimeout(() => setShow(true), 400); };
  const onLeave = () => { clearTimeout(timer.current); setShow(false); };

  return (
    <div onMouseEnter={onEnter} onMouseLeave={onLeave} style={{ position: 'relative' }}>
      {children}
      <div style={{
        opacity: show ? 1 : 0,
        transform: `translateX(-50%) scale(${show ? 1 : 0.85})`,
        transition: show ? 'opacity .15s, transform .15s' : 'opacity .1s, transform .1s',
      }}>
        {label}
      </div>
    </div>
  );
}
```

## Prompt guidance

Build a tooltip that appears only after a short hover delay but disappears instantly. On hover transition opacity and scale in with a ~0.4s delay (springy transform); on leave drop the delay so it vanishes immediately. CSS-only works by putting the delay only on the :hover rule.
