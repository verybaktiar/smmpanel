# Packet Trace

Data pulses choose a route through a tiny network

Keywords: network, data flow, routing, pulse, nodes, graph, packets, infrastructure, topology, transfer, path, animation

## CSS

```css
.packet-map i { stroke-dasharray: 7 8; animation: packet 1.8s linear infinite; }
@keyframes packet { to { stroke-dashoffset: -45; } }
```

## Prompt guidance

Build a tiny network-status visualization: three endpoint dots are connected by two angled routes, with a bright segmented packet stream moving along them. Keep the topology quiet and let only the travelling packets and destination glow communicate activity.
