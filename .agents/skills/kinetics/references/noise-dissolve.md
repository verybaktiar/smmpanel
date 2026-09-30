# Noise Dissolve

Film grain peels back to uncover a colour field

Keywords: noise, film grain, dissolve, reveal, texture, grain, hover reveal, glitch grain, turbulence, overlay, transition, cinematic

## CSS

```css
.panel::after {
  background-image: url("data:image/svg+xml,...feTurbulence...");
  animation: noise .35s steps(3) infinite;
  mix-blend-mode: overlay;
}
.panel:hover::before { opacity: 1; /* colour field */ }
.panel:hover::after { opacity: .12; }
```

## Prompt guidance

Create a noise-dissolve reveal panel. Idle state shows restless film grain over a dark surface; on hover the grain softens while a warm gradient blooms underneath, with a monospaced REVEAL label sitting in difference blend so it stays legible through the transition.
