# Indeterminate Bar

Looping sweep for unknown-length work

Keywords: loading, unknown progress, sweep, bar, busy, waiting, fetch, indefinite, scanner, activity, stripe, processing

## CSS

```css
.bar { position: relative; overflow: hidden; }
.bar::after {
  content: "";
  position: absolute;
  inset: 0;
  width: 40%;
  background: #ff8a00;
  animation: slide 1.4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}
@keyframes slide {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(320%); }
}
```

## React

```jsx
function IndeterminateBar() {
  return (
    <div className="bar" role="progressbar">
      <span />
    </div>
  );
  // .bar span animates translateX(-100% -> 320%)
  // on a 1.4s glide loop; width is fixed at 40%.
}
```

## Prompt guidance

Build an indeterminate progress bar: a thin rounded track with a 40%-wide accent segment that sweeps across it on an infinite 1.4s loop using a glide cubic-bezier(0.16, 1, 0.3, 1). Animate translateX from -100% to 320% so the segment fully enters and exits. Keep overflow hidden and the track a muted inset colour.
