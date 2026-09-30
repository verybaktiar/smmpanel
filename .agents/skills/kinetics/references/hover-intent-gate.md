# Hover Intent Gate

A deliberate hover quietly unlocks the action

Keywords: hover delay, intent, deliberate, unlock, guard, accidental, menu, dropdown, dwell, patience, timer, gate

## CSS

```css
.gate:hover i { transform: scaleX(1); transition: transform .7s linear; }
.gate:hover span { animation: unlock .01s .7s forwards; }
```

## Prompt guidance

Create a hover-intent action that only arms after the pointer rests for 700ms. A hairline charge travels under the label; once complete, the label flips from STAY to ENTER. Leaving early instantly resets it.
