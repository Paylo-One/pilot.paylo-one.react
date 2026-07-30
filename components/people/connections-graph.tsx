"use client";

/**
 * components/people/connections-graph.tsx
 *
 * The Connections tab — the relationship network as a picture. People and
 * companies are nodes; confirmed relationships are lines whose thickness maps
 * to confidence. The graph reveals progressively: it opens on you (or the
 * best-connected people) and expands as you click, instead of rendering the
 * whole network at once. Select a node to highlight its direct connections,
 * open its profile, and — with a member role — add, re-classify, or remove
 * relationships right here. Changes land in `entity_links`, so profiles and
 * the graph always agree.
 *
 * The layout is a small deterministic Fruchterman–Reingold force pass over the
 * visible subgraph only (dozens of nodes, not the full network), so no graph
 * library is needed and server/client render identically.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  IMPORTANCE_LABELS,
  RELATIONSHIP_KIND_LABELS,
  relationshipKindLabel,
  type EntityType,
  type PersonImportanceLevel,
  type RelationshipKind,
} from "@/modules/people/people.types";
import type { NetworkEdge, NetworkNode, PeopleNetwork } from "@/modules/people/relationships";
import { createLinkAction, updateLinkAction, deleteLinkAction } from "@/app/(app)/people/actions";

const WIDTH = 920;
const HEIGHT = 560;
/** Nodes shown before any interaction — keep the first paint calm. */
const INITIAL_NODE_CAP = 30;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;

// --- Deterministic force layout ----------------------------------------------

/** Stable pseudo-random in [0,1) from a node key (keeps layout deterministic). */
function hash01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Fruchterman–Reingold over the visible subgraph. Deterministic. */
function computeLayout(
  keys: readonly string[],
  edges: readonly { a: string; b: string }[],
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const n = keys.length;
  if (n === 0) return pos;

  // Initial ring placement seeded by key hash so reloads look identical.
  for (const key of keys) {
    const angle = hash01(key) * Math.PI * 2;
    const radius = 120 + hash01(`${key}#r`) * 140;
    pos.set(key, {
      x: WIDTH / 2 + Math.cos(angle) * radius,
      y: HEIGHT / 2 + Math.sin(angle) * radius,
    });
  }
  if (n === 1) return pos;

  const k = Math.sqrt((WIDTH * HEIGHT) / n) * 0.72;
  const iterations = 220;
  let temperature = WIDTH / 8;
  const cooling = temperature / (iterations + 1);

  for (let it = 0; it < iterations; it += 1) {
    const disp = new Map<string, { x: number; y: number }>();
    for (const key of keys) disp.set(key, { x: 0, y: 0 });

    // Repulsion between every pair (visible subgraph stays small).
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = pos.get(keys[i]!)!;
        const b = pos.get(keys[j]!)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.01) {
          dx = hash01(`${keys[i]}${it}`) - 0.5;
          dy = hash01(`${keys[j]}${it}`) - 0.5;
          d = 0.7;
        }
        const force = (k * k) / d;
        const da = disp.get(keys[i]!)!;
        const db = disp.get(keys[j]!)!;
        da.x += (dx / d) * force;
        da.y += (dy / d) * force;
        db.x -= (dx / d) * force;
        db.y -= (dy / d) * force;
      }
    }

    // Attraction along edges.
    for (const e of edges) {
      const a = pos.get(e.a);
      const b = pos.get(e.b);
      if (!a || !b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const force = (d * d) / k;
      const da = disp.get(e.a)!;
      const db = disp.get(e.b)!;
      da.x -= (dx / d) * force;
      da.y -= (dy / d) * force;
      db.x += (dx / d) * force;
      db.y += (dy / d) * force;
    }

    for (const key of keys) {
      const p = pos.get(key)!;
      const d = disp.get(key)!;
      const len = Math.max(Math.sqrt(d.x * d.x + d.y * d.y), 0.01);
      p.x += (d.x / len) * Math.min(len, temperature);
      p.y += (d.y / len) * Math.min(len, temperature);
      // Mild gravity keeps disconnected clusters on canvas.
      p.x += (WIDTH / 2 - p.x) * 0.02;
      p.y += (HEIGHT / 2 - p.y) * 0.02;
      p.x = Math.min(WIDTH - 40, Math.max(40, p.x));
      p.y = Math.min(HEIGHT - 32, Math.max(32, p.y));
    }
    temperature -= cooling;
  }
  return pos;
}

// --- Component ----------------------------------------------------------------

const IMPORTANCE_RANK: Record<string, number> = { critical: 3, high: 2, normal: 1, low: 0 };

export function ConnectionsGraph({
  network,
  canManage,
}: {
  network: PeopleNetwork;
  canManage: boolean;
}) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const nodesByKey = useMemo(() => {
    const m = new Map<string, NetworkNode>();
    for (const node of network.nodes) m.set(node.key, node);
    return m;
  }, [network.nodes]);

  const adjacency = useMemo(() => {
    const m = new Map<string, NetworkEdge[]>();
    for (const e of network.edges) {
      for (const key of [e.sourceKey, e.targetKey]) {
        const list = m.get(key) ?? [];
        list.push(e);
        m.set(key, list);
      }
    }
    return m;
  }, [network.edges]);

  const kindsInGraph = useMemo(
    () => [...new Set(network.edges.map((e) => e.relationshipType))].sort(),
    [network.edges],
  );

  /** Opening view: you (if marked) plus your circle, else the best-connected. */
  const initialKeys = useMemo(() => {
    const connected = network.nodes.filter((node) => node.degree > 0);
    const seeds = connected.filter((node) => node.isSelf);
    if (seeds.length === 0) {
      seeds.push(...[...connected].sort((a, b) => b.degree - a.degree).slice(0, 5));
    }
    const visible = new Set<string>(seeds.map((s) => s.key));
    for (const seed of seeds) {
      for (const e of adjacency.get(seed.key) ?? []) {
        if (visible.size >= INITIAL_NODE_CAP) break;
        visible.add(e.sourceKey === seed.key ? e.targetKey : e.sourceKey);
      }
    }
    return visible;
  }, [network.nodes, adjacency]);

  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(initialKeys);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState("");
  const [showCompanies, setShowCompanies] = useState(true);
  const [query, setQuery] = useState("");
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });

  // A refresh may remove nodes (archived elsewhere); drop stale keys lazily.
  const shownKeys = useMemo(() => {
    const keys = [...visibleKeys].filter((key) => {
      const node = nodesByKey.get(key);
      if (!node) return false;
      if (!showCompanies && node.type === "company") return false;
      return true;
    });
    return keys;
  }, [visibleKeys, nodesByKey, showCompanies]);

  const shownEdges = useMemo(() => {
    const shown = new Set(shownKeys);
    return network.edges.filter(
      (e) =>
        shown.has(e.sourceKey) &&
        shown.has(e.targetKey) &&
        (!kindFilter || e.relationshipType === kindFilter),
    );
  }, [network.edges, shownKeys, kindFilter]);

  const layout = useMemo(
    () => computeLayout(shownKeys, shownEdges.map((e) => ({ a: e.sourceKey, b: e.targetKey }))),
    [shownKeys, shownEdges],
  );

  const selected = selectedKey ? nodesByKey.get(selectedKey) ?? null : null;
  const neighbourKeys = useMemo(() => {
    if (!selectedKey) return new Set<string>();
    const set = new Set<string>();
    for (const e of adjacency.get(selectedKey) ?? []) {
      set.add(e.sourceKey === selectedKey ? e.targetKey : e.sourceKey);
    }
    return set;
  }, [selectedKey, adjacency]);

  function revealNeighbours(key: string) {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      for (const e of adjacency.get(key) ?? []) {
        next.add(e.sourceKey === key ? e.targetKey : e.sourceKey);
      }
      return next;
    });
  }

  function selectNode(key: string) {
    setSelectedKey((current) => (current === key ? null : key));
    revealNeighbours(key);
  }

  // Wheel zoom needs a non-passive listener (React's root wheel handler is passive).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setTransform((t) => {
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * Math.exp(-e.deltaY * 0.0012)));
        return { ...t, k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const pan = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if ((e.target as Element).closest("[data-node]")) return; // node clicks select, not pan
    pan.current = { startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!pan.current) return;
    setTransform((t) => ({
      ...t,
      x: pan.current!.originX + (e.clientX - pan.current!.startX),
      y: pan.current!.originY + (e.clientY - pan.current!.startY),
    }));
  }
  function onPointerUp() {
    pan.current = null;
  }

  const searchMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return network.nodes
      .filter((node) => node.label.toLowerCase().includes(q))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 6);
  }, [query, network.nodes]);

  const connectedTotal = useMemo(
    () => network.nodes.filter((node) => node.degree > 0).length,
    [network.nodes],
  );

  if (network.edges.length === 0) {
    return (
      <div className="people-empty">
        <p className="people-empty__title">No confirmed connections yet</p>
        <p className="people-empty__body">
          The network draws itself from confirmed relationships. Link a person to
          their company, confirm a suggestion from the Suggestions tab, or add a
          connection on a profile — it appears here immediately.
        </p>
      </div>
    );
  }

  return (
    <div className="connections">
      <div className="connections__toolbar">
        <div className="connections__search">
          <input
            type="search"
            className="input"
            placeholder="Find a person or company"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the network"
          />
          {searchMatches.length > 0 ? (
            <ul className="connections__search-results">
              {searchMatches.map((node) => (
                <li key={node.key}>
                  <button
                    type="button"
                    onClick={() => {
                      selectNode(node.key);
                      setQuery("");
                    }}
                  >
                    {node.label}
                    <span className="mono"> · {node.type === "person" ? "Person" : "Company"}{node.degree > 0 ? ` · ${node.degree} link${node.degree === 1 ? "" : "s"}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <select
          className="input"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          aria-label="Filter by relationship kind"
        >
          <option value="">All relationship kinds</option>
          {kindsInGraph.map((kind) => (
            <option key={kind} value={kind}>
              {relationshipKindLabel(kind)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`filter-chip${showCompanies ? " filter-chip--active" : ""}`}
          aria-pressed={showCompanies}
          onClick={() => setShowCompanies((v) => !v)}
        >
          Companies
        </button>
        <div className="connections__zoom" role="group" aria-label="Zoom">
          <button type="button" className="btn btn--ghost btn--sm" aria-label="Zoom out" onClick={() => setTransform((t) => ({ ...t, k: Math.max(MIN_ZOOM, t.k / 1.25) }))}>−</button>
          <button type="button" className="btn btn--ghost btn--sm" aria-label="Zoom in" onClick={() => setTransform((t) => ({ ...t, k: Math.min(MAX_ZOOM, t.k * 1.25) }))}>+</button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setTransform({ x: 0, y: 0, k: 1 });
              setVisibleKeys(new Set(initialKeys));
              setSelectedKey(null);
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="connections__body">
        <div className="connections__canvas card">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="application"
            aria-label="Relationship network. Click a node to highlight its connections."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
              {shownEdges.map((e) => {
                const a = layout.get(e.sourceKey);
                const b = layout.get(e.targetKey);
                if (!a || !b) return null;
                const incident = selectedKey !== null && (e.sourceKey === selectedKey || e.targetKey === selectedKey);
                const dimmed = selectedKey !== null && !incident;
                return (
                  <g key={e.id} className={`cg-edge${incident ? " cg-edge--active" : ""}${dimmed ? " cg-edge--dim" : ""}`}>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      strokeWidth={1 + e.confidence * 2.4}
                      strokeDasharray={e.origin === "system" ? "5 4" : undefined}
                    >
                      <title>
                        {`${nodesByKey.get(e.sourceKey)?.label} — ${e.relationshipLabel} — ${nodesByKey.get(e.targetKey)?.label} (${Math.round(e.confidence * 100)}%)`}
                      </title>
                    </line>
                    {incident ? (
                      <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} className="cg-edge__label">
                        {e.relationshipLabel}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {shownKeys.map((key) => {
                const node = nodesByKey.get(key);
                const p = layout.get(key);
                if (!node || !p) return null;
                const isSelected = key === selectedKey;
                const isNeighbour = neighbourKeys.has(key);
                const dimmed = selectedKey !== null && !isSelected && !isNeighbour;
                const radius = 9 + Math.min(node.degree, 8) * 1.4 + (IMPORTANCE_RANK[node.importance] ?? 1);
                return (
                  <g
                    key={key}
                    data-node
                    className={`cg-node cg-node--${node.type}${node.isSelf ? " cg-node--self" : ""}${isSelected ? " cg-node--selected" : ""}${dimmed ? " cg-node--dim" : ""}`}
                    transform={`translate(${p.x} ${p.y})`}
                    tabIndex={0}
                    role="button"
                    aria-label={`${node.label}, ${node.type}, ${node.degree} connections`}
                    onClick={() => selectNode(key)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectNode(key);
                      }
                    }}
                  >
                    {node.type === "company" ? (
                      <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} rx={4} />
                    ) : (
                      <circle r={radius} />
                    )}
                    <text y={radius + 12} textAnchor="middle" className="cg-node__label">
                      {node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="connections__legend">
            <span><i className="cg-swatch cg-swatch--person" /> Person</span>
            <span><i className="cg-swatch cg-swatch--company" /> Company</span>
            <span><i className="cg-swatch cg-swatch--line" /> Thicker = stronger</span>
            <span><i className="cg-swatch cg-swatch--dashed" /> Dashed = found by Pilot</span>
          </div>
          <p className="connections__count mono">
            Showing {shownKeys.length} of {connectedTotal} connected records · click a node to expand its circle
          </p>
        </div>

        <NodePanel
          node={selected}
          edges={selected ? adjacency.get(selected.key) ?? [] : []}
          nodesByKey={nodesByKey}
          allNodes={network.nodes}
          canManage={canManage}
          onSelect={selectNode}
          onChanged={() => router.refresh()}
        />
      </div>
    </div>
  );
}

// --- Selected-node side panel ---------------------------------------------------

function NodePanel({
  node,
  edges,
  nodesByKey,
  allNodes,
  canManage,
  onSelect,
  onChanged,
}: {
  node: NetworkNode | null;
  edges: readonly NetworkEdge[];
  nodesByKey: Map<string, NetworkNode>;
  allNodes: readonly NetworkNode[];
  canManage: boolean;
  onSelect: (key: string) => void;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [targetQuery, setTargetQuery] = useState("");
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<string>("collaborates_with");

  if (!node) {
    return (
      <aside className="connections__panel card">
        <p className="eyebrow">Network</p>
        <p className="people-empty-note">
          Select a person or company to see who they connect to, why, and — as a
          member — to add, re-classify, or remove relationships. Drag to pan,
          scroll or use the buttons to zoom.
        </p>
      </aside>
    );
  }

  function run(fn: () => Promise<{ ok: boolean; error: string | null }>, okText: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setFeedback({ tone: "ok", text: okText });
        onChanged();
      } else {
        setFeedback({ tone: "error", text: res.error ?? "Something went wrong." });
      }
    });
  }

  const [nodeType, nodeId] = [node.type, node.id];
  const profile = nodeType === "person" ? `/people/${nodeId}` : `/companies/${nodeId}`;

  const targetMatches = targetQuery.trim()
    ? allNodes
        .filter((n) => n.key !== node.key && n.label.toLowerCase().includes(targetQuery.trim().toLowerCase()))
        .slice(0, 6)
    : [];
  const chosenTarget = targetKey ? nodesByKey.get(targetKey) ?? null : null;

  return (
    <aside className="connections__panel card">
      <div className="card-head">
        <div>
          <p className="eyebrow">{node.type === "person" ? (node.isSelf ? "You" : "Person") : "Company"}</p>
          <h2 className="card__title">{node.label}</h2>
          <p className="repo-row__meta mono">
            {IMPORTANCE_LABELS[node.importance as PersonImportanceLevel] ?? node.importance} importance ·{" "}
            {node.degree} connection{node.degree === 1 ? "" : "s"}
          </p>
        </div>
        <Link href={profile} className="btn btn--secondary btn--sm">
          Open profile
        </Link>
      </div>

      {feedback ? (
        <p className={`form-message${feedback.tone === "error" ? " form-message--error" : " form-message--success"}`} role="status">
          {feedback.text}
        </p>
      ) : null}

      <div className="connections__panel-edges stack gap-xs">
        {edges.length === 0 ? (
          <p className="people-empty-note">No confirmed connections yet.</p>
        ) : (
          edges.map((e) => {
            const otherKey = e.sourceKey === node.key ? e.targetKey : e.sourceKey;
            const other = nodesByKey.get(otherKey);
            if (!other) return null;
            return (
              <div key={e.id} className="connections__edge-row">
                <div className="connections__edge-main">
                  {canManage ? (
                    <select
                      className="input input--compact"
                      value={e.relationshipType}
                      disabled={pending}
                      aria-label={`Relationship with ${other.label}`}
                      onChange={(ev) =>
                        run(
                          () => updateLinkAction({ linkId: e.id, relationshipType: ev.target.value }),
                          "Relationship updated.",
                        )
                      }
                    >
                      {!(e.relationshipType in RELATIONSHIP_KIND_LABELS) ? (
                        <option value={e.relationshipType}>{e.relationshipLabel}</option>
                      ) : null}
                      {(Object.keys(RELATIONSHIP_KIND_LABELS) as RelationshipKind[]).map((k) => (
                        <option key={k} value={k}>
                          {RELATIONSHIP_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="relationship-list__kind">{e.relationshipLabel}</span>
                  )}
                  <button type="button" className="relationship-list__link" onClick={() => onSelect(otherKey)}>
                    {other.label}
                  </button>
                  <span className="repo-row__meta mono">{Math.round(e.confidence * 100)}%</span>
                </div>
                {canManage ? (
                  confirmRemove === e.id ? (
                    <span className="confirm-inline">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm btn--danger"
                        disabled={pending}
                        onClick={() => {
                          setConfirmRemove(null);
                          run(() => deleteLinkAction({ linkId: e.id }), "Relationship removed.");
                        }}
                      >
                        Remove
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmRemove(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      aria-label={`Remove relationship with ${other.label}`}
                      disabled={pending}
                      onClick={() => setConfirmRemove(e.id)}
                    >
                      ×
                    </button>
                  )
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {canManage ? (
        <div className="connections__add">
          <p className="inbox__group-title">Add a connection</p>
          {chosenTarget ? (
            <div className="connections__add-chosen">
              <span className="chip">{chosenTarget.label}</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setTargetKey(null)}>
                Change
              </button>
            </div>
          ) : (
            <div className="connections__search">
              <input
                type="search"
                className="input"
                placeholder="Search people & companies"
                value={targetQuery}
                disabled={pending}
                onChange={(e) => setTargetQuery(e.target.value)}
                aria-label="Search for a record to connect"
              />
              {targetMatches.length > 0 ? (
                <ul className="connections__search-results">
                  {targetMatches.map((n) => (
                    <li key={n.key}>
                      <button
                        type="button"
                        onClick={() => {
                          setTargetKey(n.key);
                          setTargetQuery("");
                        }}
                      >
                        {n.label}
                        <span className="mono"> · {n.type === "person" ? "Person" : "Company"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          <div className="connections__add-row">
            <select
              className="input"
              value={newKind}
              disabled={pending}
              onChange={(e) => setNewKind(e.target.value)}
              aria-label="Relationship kind"
            >
              {(Object.keys(RELATIONSHIP_KIND_LABELS) as RelationshipKind[]).map((k) => (
                <option key={k} value={k}>
                  {RELATIONSHIP_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={pending || !chosenTarget}
              onClick={() => {
                if (!chosenTarget) return;
                run(
                  () =>
                    createLinkAction({
                      sourceType: node.type as EntityType,
                      sourceId: node.id,
                      targetType: chosenTarget.type as EntityType,
                      targetId: chosenTarget.id,
                      relationshipType: newKind,
                    }),
                  `Connected to ${chosenTarget.label}.`,
                );
                setTargetKey(null);
              }}
            >
              {pending ? "Saving…" : "Connect"}
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
