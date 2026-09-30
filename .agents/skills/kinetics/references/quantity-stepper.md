# Quantity Stepper

Value pops on each change; clamps at zero

Keywords: cart, ecommerce, plus minus, amount, count, checkout, increment, decrement, spinner, number input, order, items

## CSS

```css
.step-val {
  display: inline-block;
  min-width: 2ch; text-align: center;
  font-variant-numeric: tabular-nums;
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.step-val.bump { transform: scale(1.3); }
.step-btn:active { transform: scale(0.9); }
```

## React

```jsx
function Stepper({ min = 0 }) {
  const [n, setN] = useState(1);
  const [bump, setBump] = useState(false);

  const change = (d) => {
    setN((v) => Math.max(min, v + d));
    setBump(true);
    setTimeout(() => setBump(false), 350);
  };

  return (
    <div className="stepper">
      <button className="step-btn" onClick={() => change(-1)}>−</button>
      <span className={bump ? 'step-val bump' : 'step-val'}>{n}</span>
      <button className="step-btn" onClick={() => change(1)}>+</button>
    </div>
  );
}
```

## Prompt guidance

Build a quantity stepper with − and + buttons around a number. On each change update the value (clamped at a minimum) and briefly pop it with a spring scale(1.3) that settles via cubic-bezier(0.34,1.56,0.64,1); dip the pressed button with a quick scale(0.9) on :active. Use tabular-nums so the digits don't shift.
