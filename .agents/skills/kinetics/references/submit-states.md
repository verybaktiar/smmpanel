# Submit States

Label to bouncing dots to a settled checkmark

Keywords: button states, loading button, form submit, async button, spinner, dots, success, save, pending, cta, feedback, transition

## CSS

```css
.dots i {
  animation: bounce 0.6s ease-in-out infinite;
}
.dots i:nth-child(2) { animation-delay: 0.12s; }
.dots i:nth-child(3) { animation-delay: 0.24s; }
@keyframes bounce { 50% { transform: translateY(-6px); } }
.check path {
  stroke-dasharray: 30;
  stroke-dashoffset: 30;
  transition: stroke-dashoffset 0.4s var(--spring);
}
.done .check path { stroke-dashoffset: 0; }
```

## React

```jsx
function SubmitButton() {
  const [state, setState] = useState('idle'); // idle | loading | done
  const submit = () => {
    setState('loading');
    setTimeout(() => setState('done'), 1400);
  };
  return (
    <button data-state={state} onClick={submit}>
      {state === 'idle' && <span>Save</span>}
      {state === 'loading' && <span className="dots">•••</span>}
      {state === 'done' && <span>✓</span>}
    </button>
  );
}
```

## Prompt guidance

Build a submit button that cycles through three states: label, loading, done. On click swap the label for three dots that bounce on a staggered ease-in-out loop (translateY keyframes, delays 0/0.12/0.24s). After ~1.4s switch to a checkmark drawn in via stroke-dashoffset animated to 0 with a spring easing. Crossfade between the three states so only one is visible at a time.
