# Speed-Dial FAB

Actions fan out on a staggered spring

Keywords: floating action button, menu, actions, fan out, material, mobile, quick actions, plus button, radial menu, compose, shortcut, expand

## CSS

```css
.item {
  opacity: 0;
  transform: scale(0.4);
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s;
}
:checked ~ .item:nth-of-type(1) { transform: translate(-54px, -58px); transition-delay: 0.02s; }
:checked ~ .item:nth-of-type(2) { transform: translate(0, -80px);     transition-delay: 0.07s; }
:checked ~ .item:nth-of-type(3) { transform: translate(54px, -58px);  transition-delay: 0.12s; }
:checked ~ .item { opacity: 1; }
```

## React

```jsx
function SpeedDial({ actions }) {
  const [open, setOpen] = useState(false);
  const fan = [[-54, -58], [0, -80], [54, -58]];
  return (
    <div>
      {actions.map((a, i) => (
        <button
          key={i}
          style={{
            transform: open
              ? `translate(${fan[i][0]}px, ${fan[i][1]}px)`
              : 'scale(0.4)',
            opacity: open ? 1 : 0,
            transitionDelay: `${i * 0.05}s`,
          }}
        >
          {a.icon}
        </button>
      ))}
      <button onClick={() => setOpen(!open)}>+</button>
    </div>
  );
}
```

## Prompt guidance

Build a floating action button that fans out 3 mini action buttons when toggled. Drive the open state from a hidden checkbox (label as the +) so it needs no JS. When checked, translate each item to a fanned position (upper-left, top, upper-right) and scale it from 0.4 to 1 using a spring cubic-bezier(0.34, 1.56, 0.64, 1), staggering transition-delay by ~50ms. Rotate the + icon to a × at the same time.
