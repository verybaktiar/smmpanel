# Undo Snackbar

Timed bar drains while you can still undo

Keywords: undo, snackbar, toast, deleted, restore, timer, grace period, action, dismiss, revert, gmail, countdown

## CSS

```css
.snackbar {
  transform: translateY(120%);
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.snackbar.show { transform: translateY(0); }
.snackbar .progress {
  transform-origin: left;
  animation: drain 3s linear forwards;
}
@keyframes drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
```

## React

```jsx
function UndoSnackbar() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setOpen(false), 3000);
    return () => clearTimeout(t);
  }, [open]);
  return (
    <>
      <button onClick={() => setOpen(true)}>Delete item</button>
      <div className={open ? 'snackbar show' : 'snackbar'}>
        <span>Item deleted</span>
        <button onClick={() => setOpen(false)}>Undo</button>
        {open && <span className="progress" />}
      </div>
    </>
  );
}
```

## Prompt guidance

Build an undo snackbar that appears after a destructive action. Slide it up from below with a spring cubic-bezier(0.34, 1.56, 0.64, 1) and run a progress bar that scales from scaleX(1) to scaleX(0) over 3s (drain keyframes, transform-origin left) to show the remaining undo window. Auto-dismiss when the timer ends, or hide immediately if Undo is clicked.
