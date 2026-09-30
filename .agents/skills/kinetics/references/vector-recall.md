# Vector Recall

Nearest embeddings drift in as a query ring sweeps the space

Keywords: vector search, embedding, semantic search, rag, similarity, cosine, nearest neighbor, top k, retrieval, ai search, match, index, knn, query

## CSS

```css
.vector i {
  translate: var(--x) var(--y);
  transition: translate .6s cubic-bezier(.16,1,.3,1);
}
.vector i.hit { animation: recall 5.6s cubic-bezier(.16,1,.3,1) infinite; }
@keyframes recall {
  0%, 30%  { translate: var(--x) var(--y); opacity: .35; }
  52%, 78% { translate: calc(var(--x) * .34) calc(var(--y) * .34); opacity: 1; }
  100%     { translate: var(--x) var(--y); opacity: .35; }
}
```

## Prompt guidance

Illustrate semantic search over an embedding space. Scatter faint points around a bright query node, then expand a thin ring outward; the three nearest points brighten and drift a third of the way toward the query while the rest stay dim and still. Cross-fade a status readout from "querying" to a cosine score at the moment the matches land. Positions come from custom properties so the same rule animates every point.
