# Star Rating

Hover previews a value, click locks it with a pop

Keywords: review, feedback, score, rank, stars, rate, evaluation, survey, product, five star, hover preview, vote

## CSS

```css
.star {
  color: #2A2A2E;
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
              color 0.15s ease;
}
.star.on { color: #FF8A00; }
.star.pop { transform: scale(1.3); }
/* JS toggles .on for stars up to the hovered/selected
   index, and flashes .pop on the one just clicked. */
```

## React

```jsx
function StarRating({ count = 5 }) {
  const [value, setValue] = useState(0);
  const [hover, setHover] = useState(0);

  return (
    <div onMouseLeave={() => setHover(0)}>
      {Array.from({ length: count }).map((_, i) => {
        const n = i + 1;
        const lit = (hover || value) >= n;
        return (
          <button
            key={n}
            onMouseEnter={() => setHover(n)}
            onClick={() => setValue(n)}
            style={{ color: lit ? '#FF8A00' : '#2A2A2E' }}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}
```

## Prompt guidance

Build a five-star rating control. On hover, light every star up to the hovered index in the accent color as a live preview; on click, lock that value and briefly pop the clicked star with a spring scale. On mouse leave, fall back to showing the locked value.
