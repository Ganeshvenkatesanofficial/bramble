'use client'

import '@xyflow/react/dist/style.css'
import { memo, useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { Laptop, Server, Waypoints } from 'lucide-react'
import { cn } from 'cn'
import type { NetworkNode, NetworkView } from '../lib/network'
import { admissionText, pathText } from './network-labels'

type FlowData = { node: NetworkNode; selected: boolean }
type FlowNode = Node<FlowData, 'peer'>

const NODE_W = 184
const NODE_H = 60

function tone(node: NetworkNode) {
  if (node.kind !== 'device') return 'bg-success'
  if (node.admission === 'authorized') return 'bg-success'
  if (node.admission === 'not_authorized') return 'bg-destructive'
  return 'bg-muted-foreground'
}

const PeerNode = memo(function PeerNode({ data }: NodeProps<FlowNode>) {
  const { node, selected } = data
  const Icon = node.kind === 'gateway' ? Server : node.kind === 'relay' ? Waypoints : Laptop
  const title = node.kind === 'gateway' ? 'Gateway' : node.label.split('.')[0]
  const sub =
    node.kind === 'device'
      ? `${admissionText[node.admission]} · ${pathText[node.path]}`
      : node.kind === 'relay'
        ? 'Relay'
        : node.label
  const hidden = { top: '50%', left: '50%', opacity: 0, pointerEvents: 'none' } as const
  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-card px-3 shadow-sm transition-shadow',
        selected ? 'border-foreground ring-2 ring-foreground/15' : 'border-divider hover:shadow-md',
        node.admission === 'not_authorized' && node.kind === 'device' && 'border-dashed border-destructive/60'
      )}
    >
      <Handle type="target" position={Position.Top} style={hidden} isConnectable={false} />
      <Handle type="source" position={Position.Top} style={hidden} isConnectable={false} />
      <span className="relative grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-foreground">
        <Icon className="size-4" aria-hidden="true" />
        <span
          className={cn('absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-card', tone(node))}
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="mono block truncate text-[13px] font-semibold" title={node.label}>
          {title}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground" title={sub}>
          {sub}
        </span>
      </span>
    </div>
  )
})

const nodeTypes = { peer: PeerNode }

function layout(nodes: NetworkNode[]) {
  const gateway = nodes.find((n) => n.kind === 'gateway')
  const relays = nodes.filter((n) => n.kind === 'relay')
  const devices = nodes.filter((n) => n.kind === 'device')
  const points = new Map<string, { x: number; y: number }>()
  // Tiers read top to bottom: relays, the gateway, then devices in rows of up to four.
  const GAP_X = NODE_W + 36
  const row = (items: NetworkNode[], y: number) =>
    items.forEach((n, i) => points.set(n.id, { x: (i - (items.length - 1) / 2) * GAP_X, y }))
  let y = 0
  if (relays.length) {
    row(relays, y)
    y += 150
  }
  if (gateway) {
    points.set(gateway.id, { x: 0, y })
    y += 170
  }
  const PER_ROW = 4
  for (let i = 0; i < devices.length; i += PER_ROW) {
    row(devices.slice(i, i + PER_ROW), y)
    y += 110
  }
  return points
}

function edgeStyle(path: string) {
  if (path === 'direct') return { stroke: 'var(--foreground)', strokeWidth: 2 }
  if (path === 'relayed') return { stroke: 'var(--muted-foreground)', strokeWidth: 2, strokeDasharray: '7 5' }
  return {
    stroke: 'var(--muted-foreground)',
    strokeWidth: 1.5,
    strokeDasharray: '2 6',
    strokeLinecap: 'round' as const,
  }
}

export function NetworkGraph({
  view,
  selectedId,
  onSelect,
}: {
  view: NetworkView
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const nodes = useMemo<FlowNode[]>(() => {
    const points = layout(view.nodes)
    return view.nodes.map((node) => {
      const p = points.get(node.id) ?? { x: 0, y: 0 }
      return {
        id: node.id,
        type: 'peer',
        position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
        data: { node, selected: node.id === selectedId },
        draggable: false,
        ariaLabel: `${node.label}, ${node.kind}`,
      }
    })
  }, [view.nodes, selectedId])
  const edges = useMemo<Edge[]>(() => {
    const ids = new Set(view.nodes.map((n) => n.id))
    return view.links
      .filter((l) => ids.has(l.from) && ids.has(l.to))
      .map((l) => ({
        id: `${l.from}:${l.to}`,
        source: l.from,
        target: l.to,
        type: 'straight',
        animated: l.path === 'relayed',
        style: edgeStyle(l.path),
        selectable: false,
        focusable: false,
      }))
  }, [view.links, view.nodes])
  const key = view.nodes
    .map((n) => n.id)
    .sort()
    .join('|')
  return (
    <ReactFlow
      key={key}
      className="bramble-flow"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
      minZoom={0.3}
      maxZoom={1.6}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      onNodeClick={(_, node) => onSelect(node.id)}
      aria-label="Observed tailnet connections"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
      <Controls showInteractive={false} position="top-right" />
      <Panel position="bottom-left" className="!m-3">
        <ul
          aria-label="Connection legend"
          className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 rounded-lg border border-divider bg-card/95 px-3 py-2 text-xs text-muted-foreground shadow-sm"
        >
          {[
            ['Direct', 'solid', 2],
            ['Relayed', 'dashed', 2],
            ['Unknown or unavailable', 'dotted', 2],
          ].map(([label, style]) => (
            <li key={label} className="flex items-center gap-2">
              <span
                className="inline-block w-6 border-t-2 border-foreground"
                style={{ borderTopStyle: style as 'solid' | 'dashed' | 'dotted', opacity: style === 'solid' ? 1 : 0.6 }}
                aria-hidden="true"
              />
              {label}
            </li>
          ))}
        </ul>
      </Panel>
    </ReactFlow>
  )
}
