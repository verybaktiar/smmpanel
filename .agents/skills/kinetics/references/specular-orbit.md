# Specular Orbit

A soft highlight circles a brushed dark surface

Keywords: specular, highlight, product surface, light orbit, premium, brushed metal, sheen, 3d light, material, showcase, reflection, glow

## CSS

```css
.surface::before {
  width: 86px; height: 86px; border-radius: 50%;
  background: radial-gradient(circle, rgba(255,255,255,.45), transparent 70%);
  animation: orbit 4.2s linear infinite;
}
@keyframes orbit {
  to { transform: rotate(360deg) translateX(46px) rotate(-360deg); }
}
```

## Prompt guidance

Design a premium product surface with a slowly orbiting specular highlight. Use a dark brushed panel, a soft radial light that circles with rotate+translate, and a quiet label. Speed up slightly on hover so it feels like the light is responding to attention.
