# Checkbox Draw

The tick is drawn with an animated SVG stroke

Keywords: check, tick, todo, task, complete, svg stroke, form, done, animated check, list, selection, mark

## CSS

```css
.tick {
  stroke-dasharray: 24;
  stroke-dashoffset: 24;            /* hidden */
  transition: stroke-dashoffset 0.32s cubic-bezier(0.16, 1, 0.3, 1) 0.05s;
}
.check.checked .tick { stroke-dashoffset: 0; }   /* draws on */
.check.checked .box  { background: #FF8A00; border-color: #FF8A00; }
```

## React

```jsx
function DrawCheckbox({ label }) {
  const [on, setOn] = useState(false);
  return (
    <label className={on ? 'check checked' : 'check'} onClick={() => setOn(!on)}>
      <span className="box">
        <svg viewBox="0 0 24 24">
          <path className="tick" d="M5 12.5 L10 17.5 L19 7" />
        </svg>
      </span>
      <span className="label">{label}</span>
    </label>
  );
}
```

## Prompt guidance

Build a checkbox whose tick is drawn on with an animated SVG stroke. Set the check path's stroke-dasharray to its length and animate stroke-dashoffset from full to 0 with cubic-bezier(0.16,1,0.3,1) over ~0.32s when checked; fill the box with the accent color and strike through the label.
