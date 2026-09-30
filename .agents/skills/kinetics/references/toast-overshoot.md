# Toast Overshoot

Slides past rest position before settling

Keywords: notification, alert, message, snackbar, popup, banner, feedback, confirmation, slide in, bounce, spring, status

## CSS

```css
.toast {
  transform: translate(-50%, 140%) scale(0.9);
  opacity: 0;
  transition: transform 0.55s cubic-bezier(0.18, 1.25, 0.4, 1),
              opacity 0.3s;
}
.toast.show {
  transform: translate(-50%, 0) scale(1);
  opacity: 1;
}
```

## React

```jsx
function Toast({ message, show }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        transform: show
          ? 'translate(-50%, 0) scale(1)'
          : 'translate(-50%, 140%) scale(0.9)',
        opacity: show ? 1 : 0,
        transition:
          'transform .55s cubic-bezier(.18,1.25,.4,1), opacity .3s',
      }}
    >
      {message}
    </div>
  );
}
```

## Prompt guidance

Build a toast that slides up from the bottom, overshoots its rest position, then settles. Transition transform from translateY(140%) scale(0.9) to translateY(0) scale(1) with cubic-bezier(0.18,1.25,0.4,1) over ~0.55s while opacity fades in. Auto-hide after a couple seconds.
