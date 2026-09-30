# LiDAR Sweep

A scan plane lights a point field into a depth map

Keywords: lidar, point cloud, depth map, scan, apple roomplan, mesh, spatial, 3d scan, plane, terrain, sensor, mapping

## CSS

```css
.lidar-plane { animation: lidar-plane 6s cubic-bezier(.65,0,.35,1) infinite; }
.lidar-field i { animation: lidar-hit 6s cubic-bezier(.16,1,.3,1) infinite; }
.lidar-field i:nth-child(n+6)  { animation-delay: .42s; }
.lidar-field i:nth-child(n+11) { animation-delay: .84s; }
@keyframes lidar-hit {
  0%, 12% { opacity: .18; transform: translateY(0) scale(.7); }
  22%, 70%{ opacity: 1;   transform: translateY(var(--lift, -6px)) scale(1); }
  88%,100%{ opacity: .18; transform: none; }
}
```

## Prompt guidance

Render a LiDAR sweep over a 5 by 4 point field. A thin cool scan plane travels top to bottom. Each row of points ignites as the plane crosses it — they lift a few pixels to imply depth, glow, then dim after the plane has passed. Vary the lift per column so the field reads as terrain, not a flat grid. This is a depth scan, not a radar ping.
