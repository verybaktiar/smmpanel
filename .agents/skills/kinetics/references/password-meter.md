# Password Meter

Segments fill and shift color as strength climbs

Keywords: strength, security, signup, validation, form, gauge, indicator, weak strong, register, account, requirements, secret

## CSS

```css
.meter span {
  flex: 1; height: 5px; border-radius: 3px;
  background: var(--card-2);
  transform: scaleX(0); transform-origin: left;
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.meter[data-score="1"] span:nth-child(-n+1),
.meter[data-score="2"] span:nth-child(-n+2),
.meter[data-score="3"] span:nth-child(-n+3),
.meter[data-score="4"] span { transform: scaleX(1); }
```

## React

```jsx
function PasswordMeter() {
  const [score, setScore] = useState(0);
  const rate = (v) => {
    let s = 0;
    if (v.length > 4) s++;
    if (v.length > 8) s++;
    if (/[0-9]/.test(v)) s++;
    if (/[^a-zA-Z0-9]/.test(v)) s++;
    return Math.min(s, 4);
  };
  const colors = ['#FF5C5C', '#FF8A00', '#FF8A00', '#4CD08A'];
  return (
    <div>
      <input onChange={(e) => setScore(rate(e.target.value))} />
      <div className="meter">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            style={{
              transform: i < score ? 'scaleX(1)' : 'scaleX(0)',
              background: colors[score - 1],
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

## Prompt guidance

Build a password strength meter of four segment bars under a text field. On every keystroke score the value (length tiers, plus a point each for containing a digit and a symbol), clamp to 0–4, and reveal that many bars by scaling them from scaleX(0) to scaleX(1) with a spring cubic-bezier(0.34, 1.56, 0.64, 1). Tint the filled bars red at weak, amber at medium, green at strong, and show a matching text label.
