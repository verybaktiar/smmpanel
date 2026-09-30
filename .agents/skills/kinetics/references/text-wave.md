# Text Wave

A crest of motion travels across the letters

Keywords: wave text, letters, ripple, undulate, crest, typography, motion, baseline, bounce, sequence, water, flow

## CSS

```css
.wave span {
  display: inline-block;
  animation: bob 1.5s ease-in-out infinite;
}
/* phase each letter with a negative delay so the crest travels */
@keyframes bob {
  0%, 100% { transform: translateY(0); }
  28%      { transform: translateY(-13px); color: #ff8a00; }
}
```

## React

```jsx
function TextWave({ text }) {
  return (
    <span className="wave">
      {[...text].map((ch, i) => (
        <span key={i} style={{ animationDelay: `${-i * 0.09}s` }}>
          {ch}
        </span>
      ))}
    </span>
  );
}
```

## Prompt guidance

Animate a word so a wave of motion travels across its letters. Wrap each character in an inline-block span running the same ~1.5s ease-in-out loop that lifts it ~13px (and tints it the accent colour) at the crest, resting otherwise. Offset each letter with a negative animation-delay stepping by ~0.09s so the peak ripples smoothly left-to-right and never stops.
