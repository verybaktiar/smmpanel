# Choice Chips

Toggle filters that pop as they switch on and off

Keywords: filter, tags, multi select, options, categories, toggle, pills, facets, preferences, selection, chips, checkbox

## CSS

```css
.chip {
  padding: 7px 15px; border-radius: 100px;
  border: 1px solid #2A2A2E; color: #A8A6A0;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
              background 0.2s, color 0.2s, border-color 0.2s;
}
.chip.on {
  background: #FF8A00; color: #0E0E10; border-color: #FF8A00;
}
.chip.pop { transform: scale(1.12); }
```

## React

```jsx
function ChoiceChips({ options }) {
  const [on, setOn] = useState(() => new Set());

  const toggle = (opt) =>
    setOn((prev) => {
      const next = new Set(prev);
      next.has(opt) ? next.delete(opt) : next.add(opt);
      return next;
    });

  return (
    <div>
      {options.map((opt) => (
        <button
          key={opt}
          className={on.has(opt) ? 'chip on' : 'chip'}
          onClick={() => toggle(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
```

## Prompt guidance

Build a row of selectable filter chips. Clicking a chip toggles an .on state that fills it with the accent color and flips the text to the dark background color, with a brief spring pop (scale ~1.12) on each toggle. Multiple chips can be active at once.
