# Odometer Count-up

Eases from zero to its target when scrolled into view

Keywords: statistics, counters, numbers, stats section, metrics, kpi, dashboard, revenue, dollar amount, currency, money, users count, scroll trigger, landing page, count up

## CSS

```css
/* The motion is JS (requestAnimationFrame easing), the type
   treatment keeps digits from shifting width as they change. */
.odometer {
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
```

## React

```jsx
function CountUp({ target, duration = 1400 }) {
  const ref = useRef(null);
  const [n, setN] = useState(0);

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      const t0 = performance.now();
      const step = (t) => {
        const p = Math.min((t - t0) / duration, 1);
        setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, { threshold: 0.5 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [target]);

  return <div ref={ref}>{n.toLocaleString()}</div>;
}
```

## Prompt guidance

Build a large number that counts up from zero to a target when it scrolls into view. Trigger with an IntersectionObserver, then over ~1.4s use requestAnimationFrame with an ease-out cubic (1 - (1-p)^3) to interpolate the value, formatting with thousands separators and tabular-nums.
