# Notification Slide-in

Banner drops from the top edge and settles with a spring

Keywords: banner, alert, toast, message, drop down, announcement, push notification, top bar, in app, spring, notify, slide

## CSS

```css
.notify {
  transform: translate(-50%, -160%);
  opacity: 0;
  transition: transform 0.55s cubic-bezier(0.18, 1.25, 0.4, 1),
              opacity 0.3s;
}
.notify.show {
  transform: translate(-50%, 0);
  opacity: 1;
}
/* JS adds .show on trigger, removes it after ~2.2s. */
```

## React

```jsx
function Notification({ message, show }) {
  return (
    <div
      style={{
        position: 'absolute', left: '50%', top: 12,
        transform: show
          ? 'translate(-50%, 0)'
          : 'translate(-50%, -160%)',
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

Build a notification banner that drops in from the top edge. Transition transform from translateY(-160%) to translateY(0) with cubic-bezier(0.18,1.25,0.4,1) over ~0.55s while opacity fades in, so it overshoots slightly and settles; auto-dismiss after a couple seconds.
