# Inertial Dial

A weighted needle catches up after the ring turns

Keywords: dial, lag, needle, gauge, weighted, physics, rotation, meter, analog, speedometer, drag, momentum

## CSS

```css
.dial:hover { transform: rotate(72deg); }
.dial:hover .needle { transform: rotate(-42deg); }
/* counter-rotate the needle with a delayed spring for inertia */
```

## Prompt guidance

Make a precision dial with a conic-gradient tick ring, central readout, and a needle that visibly lags behind the rotating housing. On hover rotate the outer dial, then counter-rotate the needle with a longer delayed spring transition so it feels like a real weighted instrument.
