# Countdown Ring

Drains a circular ring as the seconds tick down

Keywords: timer, countdown, seconds, deadline, otp expiry, pomodoro, ring, clock, expire, urgency, time left, date

## CSS

```css
.countdown .prog {
  stroke-dasharray: 213.6;
  stroke-dashoffset: 0;
  transition: stroke-dashoffset 1s linear, stroke 0.3s ease;
}
.countdown.done .prog { stroke: #4CD08A; }
```

## React

```jsx
function Countdown({ seconds = 5 }) {
  const [n, setN] = useState(seconds);
  const [running, setRunning] = useState(false);
  const C = 2 * Math.PI * 34;

  useEffect(() => {
    if (!running) return;
    if (n <= 0) { setRunning(false); return; }
    const t = setTimeout(() => setN(n - 1), 1000);
    return () => clearTimeout(t);
  }, [n, running]);

  const pct = n / seconds;
  return (
    <div onClick={() => { if (!running) { setN(seconds); setRunning(true); } }}>
      <svg viewBox="0 0 80 80">
        <circle className="track" cx="40" cy="40" r="34" />
        <circle className="prog" cx="40" cy="40" r="34"
          style={{
            strokeDashoffset: C * (1 - pct),
            transition: 'stroke-dashoffset 1s linear',
          }} />
      </svg>
      <span>{n}</span>
    </div>
  );
}
```

## Prompt guidance

Build a circular countdown timer. An SVG ring with stroke-dasharray equal to its circumference starts fully drawn; each second the stroke-dashoffset increases by one segment over a 1s linear transition so the ring drains. Show the remaining seconds in the center. On tap, reset to the start value and begin ticking; when it reaches zero, switch the ring color to a success green.
