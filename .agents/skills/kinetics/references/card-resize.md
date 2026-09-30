# Card Resize

Height spring with no JS layout thrash

Keywords: expand, collapse, expandable, grow, height, reveal, details, disclosure, tap, panel, show more, read more

## CSS

```css
.card {
  height: 64px;
  overflow: hidden;
  transition: height 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.card.expanded {
  height: 120px;
}
```

## React

```jsx
function SpringCard() {
  const [open, setOpen] = useState(false);
  return (
    <div
      onClick={() => setOpen(!open)}
      style={{
        height: open ? 120 : 64,
        overflow: 'hidden',
        transition: 'height 0.5s cubic-bezier(0.34,1.56,0.64,1)',
      }}
    >
      <p>Tap to expand</p>
    </div>
  );
}
```

## Prompt guidance

Build a card that expands and collapses its height when clicked. Animate only the height with a single spring-like cubic-bezier(0.34, 1.56, 0.64, 1) over ~0.5s so it gently overshoots before settling, and fade in secondary text with a small delay once expanded. Pure CSS transitions — no JS height measurement, no max-height hacks.
