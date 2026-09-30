# Elastic Progress

Bar overshoots target width slightly before settling

Keywords: progress bar, loading, upload, percent, overshoot, download, completion, meter, bar, status, bounce, fill

## CSS

```css
.progress-fill {
  height: 100%;
  transition: width 0.9s cubic-bezier(0.16, 1, 0.3, 1);
}
/* The cubic-bezier overshoot curve (1, 0.16) gives a
   slight bounce as width settles past its target. */
```

## React

```jsx
function ElasticProgress({ value }) {
  return (
    <div style={{ height: 8, background: '#232326', borderRadius: 100, overflow: 'hidden' }}>
      <div style={{
        height: '100%',
        width: `${value}%`,
        background: 'linear-gradient(90deg, #B36200, #FF8A00)',
        transition: 'width .9s cubic-bezier(.16,1,.3,1)',
      }} />
    </div>
  );
}
```

## Prompt guidance

Build a progress bar whose gradient fill eases toward its target with a smooth settle. Animate width with cubic-bezier(0.16,1,0.3,1) over ~0.9s so it decelerates gently into place.
