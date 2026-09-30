# Volumetric Shaft

Light rakes through a slot and pools in drifting dust

Keywords: god rays, volumetric, light shaft, sunbeam, atmosphere, dust, haze, cinematic, window light, glow, ambience, hero background, fog, rays

## CSS

```css
.volumetric span {
  background: repeating-linear-gradient(97deg,
    transparent 0 12px, rgba(255,180,90,.16) 13px 22px);
  -webkit-mask: radial-gradient(60% 90% at 50% 0%, #000, transparent 72%);
  filter: blur(1.5px);
  animation: shaft-rake 9s ease-in-out infinite alternate;
}
@keyframes shaft-rake {
  from { transform: skewX(-9deg) translateX(-14px); opacity: .55; }
  to   { transform: skewX(3deg)  translateX(14px);  opacity: 1; }
}
```

## Prompt guidance

Render god rays falling through an unseen window into a dark room. Build the shafts from a repeating angled gradient, soften them with a small blur, and mask them so they fade out before they reach the floor. Slowly rake the whole bundle back and forth as if the sun were moving, drift a few dust motes across at a different speed, and let a warm pool brighten on the floor exactly where the shafts land.
