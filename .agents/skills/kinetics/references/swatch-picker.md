# Swatch Picker

Selected colour springs up with a check

Keywords: color picker, palette, theme, customize, swatches, design, variant, product options, chooser, paint, style, color

## CSS

```css
.swatch span {
  box-shadow: 0 0 0 2px #0e0e10;
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s;
}
.swatch input:checked + span {
  transform: scale(1.2);
  box-shadow: 0 0 0 2px #0e0e10, 0 0 0 4px var(--c);
}
.swatch input:checked + span::after { content: "✓"; opacity: 1; }
```

## React

```jsx
function Swatches({ colors }) {
  const [active, setActive] = useState(colors[0]);
  return colors.map((c) => (
    <button
      key={c}
      onClick={() => setActive(c)}
      style={{
        background: c,
        transform: active === c ? 'scale(1.2)' : 'scale(1)',
        boxShadow:
          active === c ? `0 0 0 2px #0e0e10, 0 0 0 4px ${c}` : 'none',
        transition: 'transform 0.5s cubic-bezier(0.34,1.56,0.64,1)',
      }}
    />
  ));
}
```

## Prompt guidance

Build a colour swatch picker: a row of circular swatches backed by hidden radio inputs. When one is checked, scale it to 1.2 with a spring cubic-bezier(0.34, 1.56, 0.64, 1), draw a ring around it using a double box-shadow in the swatch's own colour, and fade-pop a ✓ glyph in the centre. Pure CSS via :checked + span, only one selected at a time.
