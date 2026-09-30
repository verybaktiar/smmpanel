# Agent Handoff

One agent hands the live context to the next along a trace

Keywords: agent, ai, multi agent, handoff, orchestration, pipeline, workflow, delegate, context transfer, llm, node graph, baton, trace, automation

## CSS

```css
.handoff-wire b { animation: baton 5.2s cubic-bezier(.65,0,.35,1) infinite; }
.handoff-node:first-child i { animation: node-hot 5.2s ease-in-out infinite; }
.handoff-node:last-child  i { animation: node-hot 5.2s ease-in-out infinite 2.1s; }
@keyframes baton {
  0%, 14%  { offset-distance: 0%;   transform: scale(.4); opacity: 0; }
  22%      { transform: scale(1);   opacity: 1; }
  62%      { offset-distance: 100%; opacity: 1; }
  74%, 100%{ offset-distance: 100%; transform: scale(.4); opacity: 0; }
}
```

## Prompt guidance

Visualise a multi-agent handoff: two labelled nodes joined by a thin trace. A context packet detaches from the first node, accelerates along the wire with an in-out curve, and lands in the second, which only heats up on arrival while the sender cools. Light the trace behind the packet like a charge and keep a monospaced context-size label that ticks over at the moment of transfer. One continuous loop, no spinners.
