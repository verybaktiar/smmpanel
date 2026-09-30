# Breathing Orb

A glowing orb scales and softens on an endless breath — pure
                  CSS

Keywords: breathe, meditation, calm, orb, pulse, glow, ambient, sphere, zen, relax, rhythm, mindfulness

## CSS

```css
.breathe {
  border-radius: 50%;
  background: radial-gradient(circle at 50% 45%, #FF8A00, #B36200);
  animation: breathe 5s ease-in-out infinite;
}
@keyframes breathe {
  0%, 100% {
    transform: scale(0.9);
    box-shadow: 0 0 20px 0 rgba(255,138,0,0.35);
  }
  50% {
    transform: scale(1.08);
    box-shadow: 0 0 48px 8px rgba(255,138,0,0.55);
  }
}
```

## React

```jsx
function BreathingOrb({ children }) {
  // Pure CSS: a radial-gradient circle scales between 0.9 and
  // 1.08 while its glow box-shadow grows and shrinks in sync.
  return (
    <div className="breathe">
      {children}
    </div>
  );
}
/* pair with the .breathe @keyframes in the CSS tab */
```

## Prompt guidance

Build a glowing orb that breathes forever, pure CSS. Use a radial-gradient circle and an ease-in-out infinite keyframe (~5s) that scales it between 0.9 and 1.08 while growing and shrinking a colored glow box-shadow in sync, so it gently inflates and relaxes.
