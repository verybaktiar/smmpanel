# Battery Charge

Fill climbs as the bolt pulses

Keywords: charging, battery, power, energy, fill, level, bolt, device, status, indicator, percent, juice

## CSS

```css
.fill {
  background: linear-gradient(90deg, #4cd08a, #74e2aa);
  animation: charge 3.6s ease-in-out infinite;
}
@keyframes charge {
  0%        { width: 14%; }
  85%, 100% { width: 100%; }
}
```

## React

```jsx
function Battery({ level }) {
  return (
    <div className="battery">
      <div
        className="fill"
        style={{ width: `${level}%`, transition: 'width 0.4s ease' }}
      />
      <BoltIcon className="bolt" />
    </div>
  );
}
```

## Prompt guidance

Build a charging battery indicator: a rounded battery body with a small terminal nub on the right. Inside, a green gradient fill grows its width from ~14% to 100% on an infinite 3.6s ease-in-out loop, holding full briefly before looping. Centre a lightning bolt icon over it that gently pulses scale and opacity, and show a "Charging…" label below.
