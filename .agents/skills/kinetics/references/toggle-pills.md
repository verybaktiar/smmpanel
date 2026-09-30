# Toggle Pills

Selected pill pops with a spring scale

Keywords: switch, options, selector, segmented, single select, mode, filter, choice, radio, tabs, on off, setting

## CSS

```css
.pill input { position: absolute; opacity: 0; }
.pill span {
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
    background 0.25s ease, color 0.25s ease;
}
.pill input:checked + span {
  background: #ff8a00;
  color: #0e0e10;
  transform: scale(1.06);
}
```

## React

```jsx
function TogglePills({ options }) {
  const [active, setActive] = useState(options[0]);
  return options.map((opt) => (
    <button
      key={opt}
      onClick={() => setActive(opt)}
      style={{
        transform: active === opt ? 'scale(1.06)' : 'scale(1)',
        background: active === opt ? '#ff8a00' : '#232326',
        transition: 'transform 0.5s cubic-bezier(0.34,1.56,0.64,1)',
      }}
    >
      {opt}
    </button>
  ));
}
```

## Prompt guidance

Build a row of rounded pill options backed by hidden radio inputs so only one is selected at a time. When a pill becomes checked, fill it with the accent colour and pop it to scale(1.06) using a spring cubic-bezier(0.34, 1.56, 0.64, 1) over ~0.5s while colour/background ease over 0.25s. Use :checked + span so it works with zero JS.
