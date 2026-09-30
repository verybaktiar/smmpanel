# Status Pill

Morphs idle → loading → success with icon and colour

Keywords: state, badge, loading success, async, submit, morphing, indicator, chip, label, progress, workflow, transition

## CSS

```css
.pill { transition: background 0.35s, border-color 0.35s, color 0.35s; }
.pill[data-state="loading"] { color: #5B8DEF; }
.pill[data-state="loading"] .icon::before {
  content: ''; width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid rgba(91,141,239,0.3); border-top-color: #5B8DEF;
  animation: spin 0.7s linear infinite;
}
.pill[data-state="success"] { background: #4CD08A; color: #0E0E10; }
@keyframes spin { to { transform: rotate(1turn); } }
```

## React

```jsx
function StatusPill() {
  const [state, setState] = useState('idle');
  const labels = { idle: 'Deploy', loading: 'Deploying…', success: 'Deployed' };

  const run = () => {
    if (state === 'success') return setState('idle');
    setState('loading');
    setTimeout(() => setState('success'), 1500);
  };

  return (
    <button className="pill" data-state={state} onClick={run}>
      <span className="icon">{state === 'success' ? <Check /> : null}</span>
      <span>{labels[state]}</span>
    </button>
  );
}
```

## Prompt guidance

Build a button that morphs through idle → loading → success. On click switch to a loading state with a spinning ring and 'Deploying…' label, then after ~1.5s to a green success state with an animated check; clicking again resets. Crossfade background, border and text colors over ~0.35s.
