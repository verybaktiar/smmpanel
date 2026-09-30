# Squish Button

Compresses on press, springs back on release

Keywords: press, scale, tactile, bounce, spring, tap, feedback, jelly, playful, cta, click, squeeze

## CSS

```css
.btn {
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.btn:active {
  transform: scale(0.88);
  transition: transform 0.08s ease-out;
}
```

## React

```jsx
function SquishButton({ children }) {
  return (
    <button
      style={{ transition: 'transform 0.5s cubic-bezier(0.34,1.56,0.64,1)' }}
      onPointerDown={(e) => {
        e.currentTarget.style.transition = 'transform 0.08s ease-out';
        e.currentTarget.style.transform = 'scale(0.88)';
      }}
      onPointerUp={(e) => {
        e.currentTarget.style.transition =
          'transform 0.5s cubic-bezier(0.34,1.56,0.64,1)';
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {children}
    </button>
  );
}
```

## Prompt guidance

Make a button that squishes down to ~88% scale the instant it is pressed (fast 0.08s ease-out) and springs back to full size on release with an overshooting cubic-bezier(0.34, 1.56, 0.64, 1) over ~0.5s. The asymmetric timing — quick down, bouncy up — is what makes it feel physical. Drive it from :active.
