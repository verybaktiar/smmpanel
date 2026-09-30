# Clip Wipe

Overlay unmasks left-to-right with clip-path

Keywords: reveal, wipe, clip path, transition, unmask, curtain, slide reveal, image reveal, overlay, left to right, disclosure, swipe

## CSS

```css
.over {
  clip-path: inset(0 100% 0 0);
  transition: clip-path 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.wipe:hover .over {
  clip-path: inset(0 0 0 0);
}
```

## React

```jsx
function ClipWipe({ base, reveal }) {
  const [on, setOn] = useState(false);
  return (
    <div
      onMouseEnter={() => setOn(true)}
      onMouseLeave={() => setOn(false)}
      style={{ position: 'relative' }}
    >
      <div>{base}</div>
      <div
        style={{
          position: 'absolute', inset: 0,
          clipPath: on ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)',
          transition: 'clip-path 0.5s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {reveal}
      </div>
    </div>
  );
}
```

## Prompt guidance

Stack two layers in a box: a base label and an accent-coloured overlay. Clip the overlay to nothing with clip-path: inset(0 100% 0 0) so only the base shows. On hover, transition the overlay's clip-path to inset(0 0 0 0) over ~0.5s with a glide cubic-bezier(0.16, 1, 0.3, 1) so it wipes in left-to-right. Keep the box overflow hidden.
