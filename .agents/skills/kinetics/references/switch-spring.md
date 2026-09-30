# Switch Spring

Knob overshoots its track position on toggle

Keywords: toggle, on off, setting, checkbox, ios switch, preferences, enable disable, knob, boolean, dark mode, flip, control

## CSS

```css
.switch-knob {
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
              background 0.3s;
}
.switch.on .switch-knob {
  transform: translateX(22px);
}
```

## React

```jsx
function SpringSwitch() {
  const [on, setOn] = useState(false);
  return (
    <div
      onClick={() => setOn(!on)}
      style={{
        width: 52, height: 30, borderRadius: 100, padding: 3,
        background: on ? '#B36200' : '#1A1A1D',
        transition: 'background .3s',
      }}
    >
      <div style={{
        width: 22, height: 22, borderRadius: '50%',
        background: on ? '#FF8A00' : '#A8A6A0',
        transform: on ? 'translateX(22px)' : 'translateX(0)',
        transition: 'transform .4s cubic-bezier(.34,1.56,.64,1), background .3s',
      }} />
    </div>
  );
}
```

## Prompt guidance

Build a toggle switch whose knob overshoots as it slides. Translate the knob across the track with cubic-bezier(0.34,1.56,0.64,1) over ~0.4s while crossfading track and knob colors. Toggle an .on class.
