# Bookmark Toggle

Ribbon fills and drops in on save

Keywords: save, bookmark, favorite, ribbon, read later, collection, toggle, library, saved items, flag, pin, archive

## CSS

```css
.mark svg { fill: transparent; stroke: #a8a6a0; transition: fill 0.3s, stroke 0.3s; }
.mark input:checked + svg {
  fill: #ff8a00; stroke: #ff8a00;
  animation: drop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes drop {
  0%   { transform: translateY(-9px) scale(0.9); }
  55%  { transform: translateY(3px)  scale(1.14); }
  100% { transform: translateY(0)    scale(1); }
}
```

## React

```jsx
function Bookmark() {
  const [saved, setSaved] = useState(false);
  return (
    <button
      onClick={() => setSaved(!saved)}
      className={saved ? 'mark on' : 'mark'}
      aria-pressed={saved}
    >
      <RibbonIcon />
    </button>
  );
}
```

## Prompt guidance

Build a bookmark/ribbon save toggle backed by a hidden checkbox. When unchecked the ribbon is just an outline; when checked it fills with the accent colour and plays a one-shot "drop in" keyframe — start slightly above and small, overshoot down and large, then settle — using a spring cubic-bezier(0.34, 1.56, 0.64, 1). Tint the "Save" label to match. Pure CSS via :checked.
