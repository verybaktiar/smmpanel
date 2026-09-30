# Glitch Text

RGB-split copies clip and jitter on hover — pure CSS

Keywords: glitch, rgb split, distortion, cyberpunk, vhs, error, hacker, noise, jitter, retro, chromatic, digital

## CSS

```css
.glitch::before, .glitch::after {
  content: attr(data-text);
  position: absolute; left: 0; top: 0; opacity: 0;
}
.glitch::before { color: #FF5C5C; }
.glitch::after  { color: #5B8DEF; }
.glitch:hover::before { opacity: .85; animation: g-a 0.4s steps(2) infinite; }
.glitch:hover::after  { opacity: .85; animation: g-b 0.4s steps(2) infinite; }
@keyframes g-a { 0%{clip-path:inset(0 0 72% 0);transform:translate(-2px,-1px)}
  50%{clip-path:inset(42% 0 20% 0);transform:translate(2px,1px)}
  100%{clip-path:inset(70% 0 0 0);transform:translate(-1px,1px)} }
/* g-b mirrors g-a with opposite offsets */
```

## React

```jsx
function GlitchText({ children }) {
  // The effect is CSS-only; React just supplies data-text
  // so the pseudo-elements can echo the same string.
  return (
    <span className="glitch" data-text={children}>
      {children}
    </span>
  );
}
/* pair with the .glitch ::before / ::after rules in the CSS tab */
```

## Prompt guidance

Build text with an RGB-split glitch on hover, pure CSS. Render two ::before/::after copies via content: attr(data-text) in red and blue; on hover animate each with clip-path inset slices and tiny translate offsets on a fast steps() loop so the layers tear and jitter.
