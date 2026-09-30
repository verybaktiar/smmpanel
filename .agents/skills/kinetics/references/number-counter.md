# Number Counter

Digit bumps and overshoots on every increment

Keywords: count, increment, digits, numeric, stats, dollar amount, price, currency, money, tally, score, metric, total, likes

## CSS

```css
.digit {
  display: inline-block;
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.digit.bump {
  transform: scale(1.25) translateY(-6px);
}
```

## React

```jsx
function ElasticCounter() {
  const [val, setVal] = useState(12);
  const [bump, setBump] = useState(false);

  const increment = () => {
    setVal(v => v + 1);
    setBump(true);
    setTimeout(() => setBump(false), 400);
  };

  return (
    <span
      onClick={increment}
      style={{
        display: 'inline-block',
        transform: bump ? 'scale(1.25) translateY(-6px)' : 'none',
        transition: 'transform 0.4s cubic-bezier(.34,1.56,.64,1)',
      }}
    >
      {val}
    </span>
  );
}
```

## Prompt guidance

Build a number that increments on click and bumps elastically each time. On each increment briefly apply scale(1.22) translateY(-6px), then settle back with a spring cubic-bezier(0.34,1.56,0.64,1) over ~0.4s. Restart the animation cleanly on rapid clicks by forcing a reflow.
