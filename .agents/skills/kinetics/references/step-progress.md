# Step Progress

Connector fills and the next node pops active

Keywords: wizard, stepper, checkout steps, onboarding, multi step form, progress, milestones, flow, stages, breadcrumb, sequence, journey

## CSS

```css
.track i {
  transform: scaleX(0); transform-origin: left;
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.steps[data-step="2"] .track i { transform: scaleX(0.33); }
.steps[data-step="3"] .track i { transform: scaleX(0.66); }
.steps[data-step="4"] .track i { transform: scaleX(1); }
.step.active {
  transform: scale(1.18);
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

## React

```jsx
function StepProgress({ count = 4 }) {
  const [step, setStep] = useState(1);
  const next = () => setStep((s) => (s % count) + 1);
  return (
    <div>
      <div className="steps" data-step={step}>
        {Array.from({ length: count }).map((_, i) => (
          <span
            key={i}
            className={i + 1 <= step ? 'step active' : 'step'}
          >
            {i + 1}
          </span>
        ))}
        <span className="track">
          <i style={{ transform: `scaleX(${(step - 1) / (count - 1)})` }} />
        </span>
      </div>
      <button onClick={next}>Next</button>
    </div>
  );
}
```

## Prompt guidance

Build a horizontal step progress indicator: numbered nodes joined by a connector line. Track the current step in state; render a fill bar over the connector and scale it on the x-axis to (step - 1) / (count - 1) with a spring cubic-bezier(0.34, 1.56, 0.64, 1) over ~0.5s. Mark every node up to the current step active with an accent fill and a small spring scale pop. A Next button advances and wraps back to the start.
