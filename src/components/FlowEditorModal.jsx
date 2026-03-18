import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconButton, UIIcons } from './UIIcons';
import { useEditorStore } from '../store/editorStore';

const NODE_CARD_WIDTH = 224;
const NODE_CARD_HEIGHT = 104;
const PLACEHOLDER_WIDTH = 168;
const PLACEHOLDER_HEIGHT = 78;
const GRAPH_PADDING_X = 88;
const GRAPH_PADDING_Y = 48;
const GRAPH_LANE_WIDTH = 292;
const GRAPH_LEVEL_HEIGHT = 176;

const NODE_LABELS = {
  trigger: 'Trigger',
  navigate: 'Navigate',
  'set-variable': 'Set Variable',
  delay: 'Delay',
  condition: 'Conditional Action',
  end: 'Terminate Action',
};

const NODE_TYPE_OPTIONS = [
  { value: 'navigate', label: 'Navigate' },
  { value: 'set-variable', label: 'Set Variable' },
  { value: 'delay', label: 'Delay' },
  { value: 'condition', label: 'Condition' },
  { value: 'end', label: 'End' },
];

const NODE_OUTPUT_PORTS = {
  trigger: ['next'],
  navigate: ['next'],
  'set-variable': ['next'],
  delay: ['next'],
  condition: ['true', 'false'],
  end: [],
};

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createFlowNode(type) {
  return {
    id: makeId('flow-node'),
    type,
    label: NODE_LABELS[type] || type,
    position: { x: 0, y: 0 },
    config: type === 'delay'
      ? { durationMs: 300 }
      : type === 'condition'
        ? { variableScope: 'page', variableId: '', operator: 'equals', compareValue: '' }
        : {},
  };
}

function getNodeMap(flow) {
  return new Map((flow?.nodes ?? []).map((node) => [node.id, node]));
}

function getTriggerNode(flow) {
  return (flow?.nodes ?? []).find((node) => node.type === 'trigger') || null;
}

function getEdgesBySource(flow) {
  const edgesBySource = new Map();
  (flow?.edges ?? []).forEach((edge) => {
    const port = edge.sourcePort || 'next';
    const entry = edgesBySource.get(edge.source) || new Map();
    entry.set(port, edge);
    edgesBySource.set(edge.source, entry);
  });
  return edgesBySource;
}

function getIncomingEdgeMap(flow) {
  return new Map((flow?.edges ?? []).map((edge) => [edge.target, edge]));
}

function getSelectedVariableOptions(pageVariables, globalVariables) {
  return [
    ...pageVariables.map((variable) => ({ ...variable, scope: 'page' })),
    ...globalVariables.map((variable) => ({ ...variable, scope: 'global' })),
  ];
}

function getNodeOutputPorts(node) {
  return NODE_OUTPUT_PORTS[node?.type] || [];
}

function getPortLabel(port) {
  if (port === 'true') return 'True';
  if (port === 'false') return 'False';
  return 'Next';
}

function getOutputAnchor(node, port) {
  const x = port === 'true'
    ? node.position.x + NODE_CARD_WIDTH * 0.28
    : port === 'false'
      ? node.position.x + NODE_CARD_WIDTH * 0.72
      : node.position.x + NODE_CARD_WIDTH * 0.5;
  return {
    x,
    y: node.position.y + NODE_CARD_HEIGHT,
  };
}

function getInputAnchor(node) {
  return {
    x: node.position.x + NODE_CARD_WIDTH * 0.5,
    y: node.position.y,
  };
}

function getNodeSummary(node, variableLookup, variableSources) {
  if (!node) return '';
  if (node.type === 'trigger') return 'When this element is clicked';
  if (node.type === 'navigate') return node.config?.pageTitle || node.config?.pageUrl || 'Choose destination';
  if (node.type === 'set-variable') {
    const variableKey = `${node.config?.variableScope || 'page'}:${node.config?.variableId || ''}`;
    const variableName = variableLookup.get(variableKey)?.name || 'variable';
    const operation = node.config?.operation || 'set';
    return `${operation} ${variableName}`;
  }
  if (node.type === 'delay') return `${node.config?.durationMs ?? 300} ms delay`;
  if (node.type === 'condition') {
    const variableKey = `${node.config?.variableScope || 'page'}:${node.config?.variableId || ''}`;
    const variableName = variableLookup.get(variableKey)?.name || 'variable';
    return `If ${variableName} ${node.config?.operator || 'equals'} ${node.config?.compareValue || 'value'}`;
  }
  if (node.type === 'end') return 'Stop executing this branch';
  return variableSources.pages?.length ? 'Configured action' : '';
}

function updateNode(flow, nodeId, nextNode) {
  return {
    ...flow,
    nodes: (flow?.nodes ?? []).map((node) => (node.id === nodeId ? nextNode : node)),
  };
}

function insertNodeOnPort(flow, sourceId, sourcePort, type) {
  if (!flow || !sourceId || !sourcePort) return flow;
  const node = createFlowNode(type);
  const edgesBySource = getEdgesBySource(flow);
  const existingEdge = edgesBySource.get(sourceId)?.get(sourcePort) || null;
  const nextEdges = (flow.edges ?? []).filter((edge) => edge.id !== existingEdge?.id);
  nextEdges.push({
    id: makeId('flow-edge'),
    source: sourceId,
    target: node.id,
    sourcePort,
    targetPort: 'in',
  });
  if (existingEdge) {
    nextEdges.push({
      id: makeId('flow-edge'),
      source: node.id,
      target: existingEdge.target,
      sourcePort: 'next',
      targetPort: existingEdge.targetPort || 'in',
    });
  }
  return {
    ...flow,
    nodes: [...(flow.nodes ?? []), node],
    edges: nextEdges,
  };
}

function collectReachableNodeIds(flow, startId, collected = new Set()) {
  const edgesBySource = getEdgesBySource(flow);
  const visit = (nodeId) => {
    if (!nodeId || collected.has(nodeId)) return;
    collected.add(nodeId);
    const outgoing = edgesBySource.get(nodeId);
    if (!outgoing) return;
    outgoing.forEach((edge) => visit(edge.target));
  };
  visit(startId);
  return collected;
}

function deleteNodeFromFlow(flow, nodeId) {
  if (!flow || !nodeId) return flow;
  const nodeMap = getNodeMap(flow);
  const targetNode = nodeMap.get(nodeId) || null;
  if (!targetNode || targetNode.type === 'trigger') return flow;

  const incomingEdges = getIncomingEdgeMap(flow);
  const edgesBySource = getEdgesBySource(flow);
  const incomingEdge = incomingEdges.get(nodeId) || null;

  if (targetNode.type !== 'condition') {
    const nextEdge = edgesBySource.get(nodeId)?.get('next') || null;
    let edges = (flow.edges ?? []).filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
    if (incomingEdge && nextEdge) {
      edges = edges.filter((edge) => edge.id !== incomingEdge.id && edge.id !== nextEdge.id);
      edges.push({
        id: makeId('flow-edge'),
        source: incomingEdge.source,
        sourcePort: incomingEdge.sourcePort || 'next',
        target: nextEdge.target,
        targetPort: nextEdge.targetPort || 'in',
      });
    }
    return {
      ...flow,
      nodes: (flow.nodes ?? []).filter((node) => node.id !== nodeId),
      edges,
    };
  }

  const removeIds = collectReachableNodeIds(flow, nodeId);
  return {
    ...flow,
    nodes: (flow.nodes ?? []).filter((node) => !removeIds.has(node.id)),
    edges: (flow.edges ?? []).filter((edge) => !removeIds.has(edge.source) && !removeIds.has(edge.target)),
  };
}

function measureSubtree(nodeId, nodeMap, edgesBySource, cache, visiting = new Set()) {
  if (!nodeId || !nodeMap.has(nodeId)) return 1;
  if (cache.has(nodeId)) return cache.get(nodeId);
  if (visiting.has(nodeId)) return 1;

  const nextVisiting = new Set(visiting);
  nextVisiting.add(nodeId);
  const node = nodeMap.get(nodeId);
  const outgoing = edgesBySource.get(nodeId) || new Map();

  let units = 1;
  if (node.type === 'condition') {
    const trueUnits = outgoing.get('true') ? measureSubtree(outgoing.get('true').target, nodeMap, edgesBySource, cache, nextVisiting) : 1;
    const falseUnits = outgoing.get('false') ? measureSubtree(outgoing.get('false').target, nodeMap, edgesBySource, cache, nextVisiting) : 1;
    units = Math.max(2, trueUnits + falseUnits);
  } else if (outgoing.get('next')) {
    units = measureSubtree(outgoing.get('next').target, nodeMap, edgesBySource, cache, nextVisiting);
  }

  cache.set(nodeId, units);
  return units;
}

function buildGraphLayout(flow) {
  if (!flow) return null;

  const nodeMap = getNodeMap(flow);
  const triggerNode = getTriggerNode(flow);
  const edgesBySource = getEdgesBySource(flow);
  const widthCache = new Map();
  const positions = new Map();
  let maxDepth = 0;

  const assign = (nodeId, leftUnits, depth, visiting = new Set()) => {
    if (!nodeId || !nodeMap.has(nodeId) || visiting.has(nodeId)) return;
    const node = nodeMap.get(nodeId);
    const units = measureSubtree(nodeId, nodeMap, edgesBySource, widthCache);
    const centerUnits = leftUnits + units / 2;
    positions.set(nodeId, {
      x: GRAPH_PADDING_X + centerUnits * GRAPH_LANE_WIDTH - NODE_CARD_WIDTH / 2,
      y: GRAPH_PADDING_Y + depth * GRAPH_LEVEL_HEIGHT,
    });
    maxDepth = Math.max(maxDepth, depth);

    const nextVisiting = new Set(visiting);
    nextVisiting.add(nodeId);
    const outgoing = edgesBySource.get(nodeId) || new Map();
    if (node.type === 'condition') {
      const trueEdge = outgoing.get('true') || null;
      const falseEdge = outgoing.get('false') || null;
      const trueUnits = trueEdge ? measureSubtree(trueEdge.target, nodeMap, edgesBySource, widthCache) : 1;
      if (trueEdge) assign(trueEdge.target, leftUnits, depth + 1, nextVisiting);
      if (falseEdge) assign(falseEdge.target, leftUnits + trueUnits, depth + 1, nextVisiting);
      return;
    }
    const nextEdge = outgoing.get('next') || null;
    if (nextEdge) assign(nextEdge.target, leftUnits, depth + 1, nextVisiting);
  };

  if (triggerNode) assign(triggerNode.id, 0, 0);

  const positionedNodes = (flow.nodes ?? []).map((node, index) => {
    const position = positions.get(node.id) || {
      x: GRAPH_PADDING_X + index * (NODE_CARD_WIDTH + 32),
      y: GRAPH_PADDING_Y + (maxDepth + 2) * GRAPH_LEVEL_HEIGHT,
    };
    return { ...node, position };
  });

  const positionedNodeMap = new Map(positionedNodes.map((node) => [node.id, node]));
  const renderedEdges = (flow.edges ?? []).map((edge) => {
    const sourceNode = positionedNodeMap.get(edge.source);
    const targetNode = positionedNodeMap.get(edge.target);
    if (!sourceNode || !targetNode) return null;
    const start = getOutputAnchor(sourceNode, edge.sourcePort || 'next');
    const end = getInputAnchor(targetNode);
    const handle = Math.max(42, Math.abs(end.x - start.x) * 0.4);
    return {
      ...edge,
      start,
      end,
      label: edge.sourcePort === 'true' ? 'True' : edge.sourcePort === 'false' ? 'False' : '',
      labelX: start.x + (end.x - start.x) * 0.35,
      labelY: start.y + 28,
      path: `M ${start.x} ${start.y} C ${start.x} ${start.y + handle}, ${end.x} ${end.y - handle}, ${end.x} ${end.y}`,
    };
  }).filter(Boolean);

  const addButtons = [];
  const placeholders = [];
  positionedNodes.forEach((node) => {
    const outgoing = edgesBySource.get(node.id) || new Map();
    getNodeOutputPorts(node).forEach((port) => {
      const source = getOutputAnchor(node, port);
      const edge = outgoing.get(port) || null;
      if (edge) {
        const targetNode = positionedNodeMap.get(edge.target);
        if (!targetNode) return;
        const target = getInputAnchor(targetNode);
        addButtons.push({
          key: `${node.id}:${port}`,
          sourceId: node.id,
          sourcePort: port,
          x: source.x + (target.x - source.x) * 0.5,
          y: source.y + (target.y - source.y) * 0.5,
          label: getPortLabel(port),
        });
        return;
      }
      placeholders.push({
        key: `${node.id}:${port}`,
        sourceId: node.id,
        sourcePort: port,
        x: source.x - PLACEHOLDER_WIDTH / 2,
        y: source.y + 28,
        buttonX: source.x,
        buttonY: source.y + 28,
        label: port === 'next' ? 'Add next action' : `Add ${getPortLabel(port).toLowerCase()} branch`,
      });
    });
  });

  const maxX = positionedNodes.reduce((value, node) => Math.max(value, node.position.x + NODE_CARD_WIDTH), 0);
  const maxY = positionedNodes.reduce((value, node) => Math.max(value, node.position.y + NODE_CARD_HEIGHT), 0);
  const placeholderMaxX = placeholders.reduce((value, entry) => Math.max(value, entry.x + PLACEHOLDER_WIDTH), 0);
  const placeholderMaxY = placeholders.reduce((value, entry) => Math.max(value, entry.y + PLACEHOLDER_HEIGHT), 0);

  return {
    nodes: positionedNodes,
    edges: renderedEdges,
    addButtons,
    placeholders,
    width: Math.max(980, maxX, placeholderMaxX) + GRAPH_PADDING_X,
    height: Math.max(620, maxY, placeholderMaxY) + GRAPH_PADDING_Y + 72,
  };
}

function NodeTypeMenu({ onAdd }) {
  return (
    <div className="fb-flow-editor__canvas-menu-list">
      {NODE_TYPE_OPTIONS.map((option) => (
        <button key={option.value} type="button" className="fb-secondary-btn fb-btn--sm" onClick={() => onAdd(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function FlowNodeCard({ node, summary, isSelected, onSelect, onDelete }) {
  return (
    <div className={`fb-flow-editor__node${isSelected ? ' is-active' : ''}${node.type === 'trigger' ? ' is-trigger' : ''}${node.type === 'condition' ? ' is-condition' : ''}`} style={{ left: node.position.x, top: node.position.y }}>
      <button type="button" className="fb-flow-editor__node-main" onClick={onSelect}>
        <span className="fb-flow-editor__node-kicker">{node.type === 'trigger' ? 'Trigger' : node.type === 'condition' ? 'Condition' : 'Action'}</span>
        <strong>{node.label || NODE_LABELS[node.type] || node.type}</strong>
        <small>{summary}</small>
      </button>
      {node.type !== 'trigger' ? (
        <IconButton icon={UIIcons.trash} title="Delete node" className="fb-flow-editor__node-delete" onClick={onDelete} />
      ) : null}
    </div>
  );
}

function FlowInspector({ flow, selectedNode, onFlowChange, onNodeChange, pageVariables, globalVariables, variableSources, elementName }) {
  const variableOptions = getSelectedVariableOptions(pageVariables, globalVariables);

  if (!flow) return <div className="fb-empty-state__text">No flow selected.</div>;
  if (!selectedNode || selectedNode.type === 'trigger') {
    return (
      <div className="fb-flow-editor__inspector-group">
        <label className="fb-variable-field">
          <span className="fb-variable-field__label">Flow Name</span>
          <input className="fb-prop-input" type="text" value={flow.name || ''} onChange={(event) => onFlowChange({ ...flow, name: event.target.value })} />
        </label>
        <div className="fb-artboard-bp-note">Trigger: {elementName || 'Selected element'} click</div>
      </div>
    );
  }

  return (
    <div className="fb-flow-editor__inspector-group">
      <div className="fb-flow-editor__inspector-head">
        <strong>{selectedNode.label || NODE_LABELS[selectedNode.type] || selectedNode.type}</strong>
      </div>

      {selectedNode.type === 'navigate' ? (
        <label className="fb-variable-field">
          <span className="fb-variable-field__label">Target Page</span>
          <select
            className="fb-prop-input"
            value={selectedNode.config?.pageId || ''}
            onChange={(event) => {
              const pageId = parseInt(event.target.value, 10) || 0;
              const page = variableSources.pages.find((entry) => entry.id === pageId) || null;
              onNodeChange({
                ...selectedNode,
                config: {
                  ...selectedNode.config,
                  pageId,
                  pageTitle: page?.title || '',
                  pageUrl: page?.url || '',
                },
              });
            }}
          >
            <option value="">Select page…</option>
            {(variableSources.pages ?? []).map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}
          </select>
        </label>
      ) : null}

      {selectedNode.type === 'set-variable' ? (
        <>
          <label className="fb-variable-field">
            <span className="fb-variable-field__label">Variable</span>
            <select
              className="fb-prop-input"
              value={`${selectedNode.config?.variableScope || 'page'}:${selectedNode.config?.variableId || ''}`}
              onChange={(event) => {
                const [scope, variableId] = event.target.value.split(':');
                const variable = variableOptions.find((entry) => entry.scope === scope && entry.id === variableId) || null;
                onNodeChange({
                  ...selectedNode,
                  config: {
                    ...selectedNode.config,
                    variableScope: scope,
                    variableId,
                    variableType: variable?.type || 'string',
                  },
                });
              }}
            >
              <option value="page:">Select variable…</option>
              {variableOptions.map((variable) => (
                <option key={`${variable.scope}:${variable.id}`} value={`${variable.scope}:${variable.id}`}>
                  {variable.scope === 'global' ? 'Global' : 'Page'} / {variable.name}
                </option>
              ))}
            </select>
          </label>
          <label className="fb-variable-field">
            <span className="fb-variable-field__label">Operation</span>
            <select
              className="fb-prop-input"
              value={selectedNode.config?.operation || 'set'}
              onChange={(event) => onNodeChange({
                ...selectedNode,
                config: { ...selectedNode.config, operation: event.target.value },
              })}
            >
              <option value="set">Set</option>
              <option value="toggle">Toggle</option>
              <option value="increment">Increment</option>
              <option value="decrement">Decrement</option>
              <option value="default">Reset to default</option>
            </select>
          </label>
          <label className="fb-variable-field">
            <span className="fb-variable-field__label">Value</span>
            <input
              className="fb-prop-input"
              type={selectedNode.config?.variableType === 'number' ? 'number' : 'text'}
              value={selectedNode.config?.value ?? ''}
              onChange={(event) => onNodeChange({
                ...selectedNode,
                config: {
                  ...selectedNode.config,
                  value: selectedNode.config?.variableType === 'number' ? (parseFloat(event.target.value) || 0) : event.target.value,
                },
              })}
            />
          </label>
        </>
      ) : null}

      {selectedNode.type === 'delay' ? (
        <label className="fb-variable-field">
          <span className="fb-variable-field__label">Duration (ms)</span>
          <input
            className="fb-prop-input"
            type="number"
            min="0"
            step="50"
            value={selectedNode.config?.durationMs ?? 300}
            onChange={(event) => onNodeChange({
              ...selectedNode,
              config: {
                ...selectedNode.config,
                durationMs: Math.max(0, parseInt(event.target.value, 10) || 0),
              },
            })}
          />
        </label>
      ) : null}

      {selectedNode.type === 'condition' ? (
        <>
          <label className="fb-variable-field">
            <span className="fb-variable-field__label">Variable</span>
            <select
              className="fb-prop-input"
              value={`${selectedNode.config?.variableScope || 'page'}:${selectedNode.config?.variableId || ''}`}
              onChange={(event) => {
                const [scope, variableId] = event.target.value.split(':');
                onNodeChange({
                  ...selectedNode,
                  config: { ...selectedNode.config, variableScope: scope, variableId },
                });
              }}
            >
              <option value="page:">Select variable…</option>
              {variableOptions.map((variable) => (
                <option key={`${variable.scope}:${variable.id}`} value={`${variable.scope}:${variable.id}`}>
                  {variable.scope === 'global' ? 'Global' : 'Page'} / {variable.name}
                </option>
              ))}
            </select>
          </label>
          <label className="fb-variable-field">
            <span className="fb-variable-field__label">Operator</span>
            <select
              className="fb-prop-input"
              value={selectedNode.config?.operator || 'equals'}
              onChange={(event) => onNodeChange({
                ...selectedNode,
                config: { ...selectedNode.config, operator: event.target.value },
              })}
            >
              <option value="equals">Equals</option>
              <option value="not-equals">Not equals</option>
              <option value="contains">Contains</option>
              <option value="greater-than">Greater than</option>
              <option value="less-than">Less than</option>
            </select>
          </label>
          <label className="fb-variable-field">
            <span className="fb-variable-field__label">Compare Value</span>
            <input
              className="fb-prop-input"
              type="text"
              value={selectedNode.config?.compareValue ?? ''}
              onChange={(event) => onNodeChange({
                ...selectedNode,
                config: { ...selectedNode.config, compareValue: event.target.value },
              })}
            />
          </label>
          <div className="fb-artboard-bp-note">True and False outputs create separate branches.</div>
        </>
      ) : null}

      {selectedNode.type === 'end' ? <div className="fb-artboard-bp-note">Terminal node. No further configuration.</div> : null}
    </div>
  );
}

export default function FlowEditorModal() {
  const flowEditorState = useEditorStore((state) => state.flowEditorState);
  const closeFlowEditor = useEditorStore((state) => state.closeFlowEditor);
  const upsertPageFlow = useEditorStore((state) => state.upsertPageFlow);
  const removePageFlow = useEditorStore((state) => state.removePageFlow);
  const ensureElementFlow = useEditorStore((state) => state.ensureElementFlow);
  const getCurrentPageFlows = useEditorStore((state) => state.getCurrentPageFlows);
  const getCurrentPageVariables = useEditorStore((state) => state.getCurrentPageVariables);
  const globalVariables = useEditorStore((state) => state.globalVariables);
  const variableSources = useEditorStore((state) => state.variableSources);
  const allElements = useEditorStore((state) => state.getAllElements());

  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [menuState, setMenuState] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const canvasWrapRef = useRef(null);
  const panStateRef = useRef(null);

  const flows = getCurrentPageFlows({ includeLegacy: false });
  const pageVariables = getCurrentPageVariables();
  const element = flowEditorState.elementId ? allElements.find((entry) => entry.id === flowEditorState.elementId) || null : null;
  const variableOptions = useMemo(() => getSelectedVariableOptions(pageVariables, globalVariables), [pageVariables, globalVariables]);
  const variableLookup = useMemo(() => new Map(variableOptions.map((variable) => [`${variable.scope}:${variable.id}`, variable])), [variableOptions]);

  const activeFlow = useMemo(() => {
    const requestedFlow = flowEditorState.flowId
      ? flows.find((flow) => flow.id === flowEditorState.flowId) || null
      : null;
    if (requestedFlow) return requestedFlow;
    if (flowEditorState.elementId) {
      return flows.find((flow) => flow.trigger?.type === 'element-click' && flow.trigger?.elementId === flowEditorState.elementId) || null;
    }
    return flows[0] || null;
  }, [flowEditorState.elementId, flowEditorState.flowId, flows]);

  const graph = useMemo(() => buildGraphLayout(activeFlow), [activeFlow]);

  useEffect(() => {
    if (!flowEditorState.open || !flowEditorState.elementId) return;
    if (activeFlow) return;
    ensureElementFlow(flowEditorState.elementId, { name: `${element?.name || 'Element'} interaction` });
  }, [activeFlow, element?.name, ensureElementFlow, flowEditorState.elementId, flowEditorState.open]);

  useEffect(() => {
    if (!activeFlow) {
      setSelectedNodeId('');
      setMenuState(null);
      return;
    }
    const triggerNode = getTriggerNode(activeFlow);
    const fallbackNode = (activeFlow.nodes ?? []).find((node) => node.type !== 'trigger') || triggerNode || null;
    if (!selectedNodeId || !(activeFlow.nodes ?? []).some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(fallbackNode?.id || '');
    }
  }, [activeFlow, selectedNodeId]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const panState = panStateRef.current;
      const wrap = canvasWrapRef.current;
      if (!panState || !wrap) return;
      wrap.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX);
      wrap.scrollTop = panState.scrollTop - (event.clientY - panState.startY);
    };

    const stopPanning = () => {
      if (!panStateRef.current) return;
      panStateRef.current = null;
      setIsPanning(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopPanning);
    window.addEventListener('pointercancel', stopPanning);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopPanning);
      window.removeEventListener('pointercancel', stopPanning);
    };
  }, []);

  const selectedNode = selectedNodeId
    ? (activeFlow?.nodes ?? []).find((node) => node.id === selectedNodeId) || null
    : getTriggerNode(activeFlow);

  const saveFlow = (nextFlow) => {
    if (!nextFlow) return;
    upsertPageFlow(nextFlow);
  };

  const handleAddNode = (type) => {
    if (!activeFlow || !menuState?.sourceId || !menuState?.sourcePort) return;
    const nextFlow = insertNodeOnPort(activeFlow, menuState.sourceId, menuState.sourcePort, type);
    const newNode = (nextFlow.nodes ?? []).find((node) => !(activeFlow.nodes ?? []).some((entry) => entry.id === node.id)) || null;
    saveFlow(nextFlow);
    setSelectedNodeId(newNode?.id || '');
    setMenuState(null);
  };

  const handleDeleteNode = (nodeId) => {
    if (!activeFlow) return;
    const nextFlow = deleteNodeFromFlow(activeFlow, nodeId);
    saveFlow(nextFlow);
    setSelectedNodeId(getTriggerNode(nextFlow)?.id || '');
    setMenuState(null);
  };

  return (
    <div className="fb-overlay-modal" onMouseDown={closeFlowEditor}>
      <div className="fb-overlay-modal__card fb-flow-editor-modal fb-flow-editor-modal--graph" onMouseDown={(event) => event.stopPropagation()}>
        <div className="fb-overlay-modal__head">Interaction Flow</div>
        <div className="fb-overlay-modal__body fb-flow-editor-modal__body fb-flow-editor-modal__body--graph">
          <div
            ref={canvasWrapRef}
            className={`fb-flow-editor__canvas-wrap fb-flow-editor__canvas-wrap--graph${isPanning ? ' is-panning' : ''}`}
            onMouseDown={() => setMenuState(null)}
            onPointerDown={(event) => {
              const target = event.target;
              if (!(target instanceof HTMLElement)) return;
              if (target.closest('button, input, select, textarea, .fb-flow-editor__node, .fb-flow-editor__canvas-menu, .fb-flow-editor__inspector')) return;
              const wrap = canvasWrapRef.current;
              if (!wrap) return;
              panStateRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                scrollLeft: wrap.scrollLeft,
                scrollTop: wrap.scrollTop,
              };
              setIsPanning(true);
              event.preventDefault();
            }}
          >
            <div className="fb-flow-editor__canvas fb-flow-editor__canvas--graph" style={{ minWidth: graph?.width || 980, minHeight: graph?.height || 620 }}>
              <div className="fb-flow-editor__canvas-header">
                <div>
                  <strong>{activeFlow?.name || `${element?.name || 'Element'} interaction`}</strong>
                  <div className="fb-artboard-bp-note">{element?.name || 'Selected element'} click trigger</div>
                </div>
              </div>

              <svg className="fb-flow-editor__edges" aria-hidden="true">
                {(graph?.edges ?? []).map((edge) => (
                  <g key={edge.id}>
                    <path d={edge.path} />
                    {edge.label ? <text x={edge.labelX} y={edge.labelY} className="fb-flow-editor__edge-label">{edge.label}</text> : null}
                  </g>
                ))}
              </svg>

              {(graph?.nodes ?? []).map((node) => (
                <FlowNodeCard
                  key={node.id}
                  node={node}
                  summary={getNodeSummary(node, variableLookup, variableSources)}
                  isSelected={selectedNode?.id === node.id}
                  onSelect={() => setSelectedNodeId(node.id)}
                  onDelete={(event) => {
                    event?.stopPropagation?.();
                    handleDeleteNode(node.id);
                  }}
                />
              ))}

              {(graph?.placeholders ?? []).map((entry) => (
                <div key={entry.key} className="fb-flow-editor__placeholder" style={{ left: entry.x, top: entry.y }}>
                  <span>{entry.label}</span>
                  <button
                    type="button"
                    className="fb-flow-editor__placeholder-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuState({
                        sourceId: entry.sourceId,
                        sourcePort: entry.sourcePort,
                        x: entry.buttonX,
                        y: entry.buttonY,
                        label: getPortLabel(entry.sourcePort),
                      });
                    }}
                  >
                    {UIIcons.plus}
                    <span>Add Action</span>
                  </button>
                </div>
              ))}

              {(graph?.addButtons ?? []).map((button) => (
                <button
                  key={button.key}
                  type="button"
                  className="fb-flow-editor__add-button"
                  style={{ left: button.x - 18, top: button.y - 18 }}
                  title={`Add ${button.label} action`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuState({ ...button });
                  }}
                >
                  {UIIcons.plus}
                </button>
              ))}

              {menuState ? (
                <div className="fb-flow-editor__canvas-menu" style={{ left: menuState.x + 22, top: menuState.y - 8 }} onMouseDown={(event) => event.stopPropagation()}>
                  <div className="fb-flow-editor__canvas-menu-head">Add {menuState.label} action</div>
                  <NodeTypeMenu onAdd={handleAddNode} />
                </div>
              ) : null}
            </div>
          </div>

          <aside className="fb-flow-editor__inspector fb-flow-editor__inspector--graph">
            <div className="fb-flow-editor__inspector-head">
              <strong>{selectedNode?.type === 'trigger' ? 'Flow Settings' : 'Node Settings'}</strong>
              {activeFlow ? <button type="button" className="fb-secondary-btn fb-btn--sm" onClick={() => { removePageFlow(activeFlow.id); closeFlowEditor(); }}>Delete Flow</button> : null}
            </div>
            <FlowInspector
              flow={activeFlow}
              selectedNode={selectedNode}
              onFlowChange={saveFlow}
              onNodeChange={(nextNode) => saveFlow(updateNode(activeFlow, nextNode.id, nextNode))}
              pageVariables={pageVariables}
              globalVariables={globalVariables}
              variableSources={variableSources}
              elementName={element?.name || 'Selected element'}
            />
          </aside>
        </div>
        <div className="fb-overlay-modal__actions">
          <button type="button" className="fb-primary-btn" onClick={closeFlowEditor}>Close</button>
        </div>
      </div>
    </div>
  );
}
