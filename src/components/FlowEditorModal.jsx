import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconButton, UIIcons } from './UIIcons';
import { getLoopItemPreviewVariables, useEditorStore } from '../store/editorStore';
import { isFormContainerType, isFormFieldType, normalizeFormConfig } from '../domain/formModel';
import { createSubmissionNodeConfig, normalizeSubmissionActionConfig, normalizeSubmissionFieldEntries } from '../domain/formSubmissionModel';

const NODE_CARD_WIDTH = 244;
const NODE_CARD_HEIGHT = 96;
const TRIGGER_NODE_WIDTH = 72;
const TRIGGER_NODE_HEIGHT = 26;
const WORKSPACE_WIDTH = 3200;
const WORKSPACE_HEIGHT = 2200;
const WORKSPACE_CENTER_X = WORKSPACE_WIDTH / 2;
const GRAPH_PADDING_X = 104;
const GRAPH_PADDING_Y = 72;
const GRAPH_LEVEL_HEIGHT = 184;
const BRANCH_LANE_GAP = 320;
const BRANCH_STEM_HEIGHT = 36;
const DRAG_REORDER_THRESHOLD = 88;

const NODE_LABELS = {
  trigger: 'Trigger',
  'submission-form': 'Submission Form',
  navigate: 'Navigate',
  'set-variable': 'Set Variable',
  delay: 'Delay',
  condition: 'Conditional Action',
  end: 'Terminate Action',
};

const NODE_TYPE_OPTIONS = [
  { value: 'submission-form', label: 'Submission Form' },
  { value: 'navigate', label: 'Navigate' },
  { value: 'set-variable', label: 'Set Variable' },
  { value: 'delay', label: 'Delay' },
  { value: 'condition', label: 'Condition' },
  { value: 'end', label: 'End' },
];

const NODE_OUTPUT_PORTS = {
  trigger: ['next'],
  'submission-form': ['next'],
  navigate: ['next'],
  'set-variable': ['next'],
  delay: ['next'],
  condition: ['true', 'false'],
  end: [],
};

const SUBMISSION_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'publish', label: 'Publish' },
  { value: 'pending', label: 'Pending Review' },
  { value: 'private', label: 'Private' },
];

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeSubmissionConfigId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSubmissionInspectorConfig(node, legacyActions = null) {
  const config = node?.config && typeof node.config === 'object' ? node.config : {};
  return {
    fields: normalizeSubmissionFieldEntries(config.fields),
    actions: normalizeSubmissionActionConfig(config.actions, legacyActions),
  };
}

function countEnabledSubmissionActions(actions) {
  return ['store', 'email', 'webhook', 'createPost', 'createCategory', 'createProductCategory', 'createProduct']
    .reduce((count, key) => count + (actions?.[key]?.enabled ? 1 : 0), 0);
}

function normalizeSubmissionTargetOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((option) => {
      const source = option && typeof option === 'object' ? option : {};
      const value = typeof source.value === 'string' && source.value
        ? source.value
        : (typeof source.key === 'string' && source.key ? source.key : '');
      const label = typeof source.label === 'string' && source.label
        ? source.label
        : (typeof source.name === 'string' && source.name ? source.name : value);
      if (!value) return null;
      return { value, label };
    })
    .filter(Boolean);
}

function createFlowNode(type) {
  return {
    id: makeId('flow-node'),
    type,
    label: NODE_LABELS[type] || type,
    position: { x: 0, y: 0 },
    config: type === 'delay'
      ? { durationMs: 300 }
      : type === 'submission-form'
        ? createSubmissionNodeConfig()
      : type === 'condition'
        ? {
            subjectSource: 'variable',
            variableScope: 'page',
            variableId: '',
            operator: 'equals',
            compareSource: 'manual',
            compareValue: '',
            compareVariableScope: 'page',
            compareVariableId: '',
            submissionField: '',
            responsePath: '',
          }
        : type === 'set-variable'
          ? { operation: 'set', valueSource: 'manual', value: '', submissionField: '', responsePath: '' }
        : {},
  };
}

function getFormFieldValueType(type) {
  if (type === 'checkbox') return 'boolean';
  if (type === 'file-upload') return 'image';
  return 'string';
}

function getFormFieldOptions(formElement, allElements) {
  if (!formElement?.id) return [];
  const byId = new Map((allElements ?? []).map((entry) => [entry.id, entry]));
  const childIds = Array.isArray(formElement.children) ? formElement.children : [];
  const ordered = childIds
    .map((childId) => byId.get(childId) || null)
    .filter((entry) => entry && isFormFieldType(entry.type));
  const fallback = (allElements ?? []).filter((entry) => entry?.parentId === formElement.id && isFormFieldType(entry.type));
  const fields = ordered.length ? ordered : fallback;
  return fields.map((field) => {
    const base = field?.base && typeof field.base === 'object' ? field.base : {};
    const fieldName = `${base.fieldName || field.name || field.id || ''}`
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || `field_${field.id}`;
    return {
      id: field.id,
      fieldName,
      label: `${base.label || field.name || 'Field'}`.trim() || 'Field',
      type: field.type,
      valueType: getFormFieldValueType(field.type),
      path: `submission.values.${fieldName}`,
    };
  });
}

function getFlowFormElement(flow, element, allElements) {
  const formId = flow?.trigger?.formId;
  if (formId) {
    return (allElements ?? []).find((entry) => entry.id === formId) || null;
  }
  let ancestorId = element?.parentId || null;
  while (ancestorId) {
    const ancestor = (allElements ?? []).find((entry) => entry.id === ancestorId) || null;
    if (!ancestor) return null;
    if (isFormContainerType(ancestor.type)) return ancestor;
    ancestorId = ancestor.parentId || null;
  }
  return null;
}

function getSubmissionFormFields(node, submittedFieldOptions) {
  const fieldLookup = new Map((submittedFieldOptions ?? []).map((field) => [field.fieldName, field]));
  const configuredFields = Array.isArray(node?.config?.fields) ? node.config.fields : [];
  const selected = configuredFields
    .map((entry) => {
      const fieldName = typeof entry === 'string' ? entry : entry?.fieldName;
      if (!fieldName) return null;
      return fieldLookup.get(fieldName) || null;
    })
    .filter(Boolean);
  if (selected.length) return selected;
  return [];
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

function getNavigationVariableOptions(pageVariables, globalVariables, loopItemVariables) {
  return [
    ...getSelectedVariableOptions(pageVariables, globalVariables),
    ...loopItemVariables.map((variable) => ({ ...variable, scope: 'loop-item' })),
  ].filter((variable) => variable.type === 'string');
}

function getVariableOptionLabel(variable) {
  if (!variable) return 'Variable';
  const scopeLabel = variable.scope === 'global' ? 'Global' : (variable.scope === 'loop-item' ? 'Loop Item' : 'Page');
  return `${scopeLabel} / ${variable.name}`;
}

function getNodeOutputPorts(node) {
  return NODE_OUTPUT_PORTS[node?.type] || [];
}

function getPortLabel(port) {
  if (port === 'true') return 'True';
  if (port === 'false') return 'False';
  if (port === 'submitted') return 'Submitted';
  if (port === 'error') return 'Error';
  return 'Next';
}

function getFlowTriggerType(flow) {
  return flow?.trigger?.type || getTriggerNode(flow)?.config?.triggerType || 'custom';
}

function getTriggerSummary(flow, elementName) {
  const triggerType = getFlowTriggerType(flow);
  if (triggerType === 'form-submit') return `When ${elementName || 'selected form'} submits`;
  if (triggerType === 'page-load') return 'When the page loads';
  if (triggerType === 'element-click') return `When ${elementName || 'selected element'} is clicked`;
  return 'Custom trigger';
}

function getNodeOutputPortsForFlow(node, flow) {
  return getNodeOutputPorts(node);
}

function getPrimaryNextEdge(node, outgoing) {
  if (!node) return null;
  if (node.type === 'trigger') {
    return outgoing.get('next') || outgoing.get('submitted') || outgoing.get('error') || null;
  }
  return outgoing.get('next') || null;
}

function getNodeCardDimensions(node) {
  if (node?.type === 'trigger') {
    return { width: TRIGGER_NODE_WIDTH, height: TRIGGER_NODE_HEIGHT };
  }
  return { width: NODE_CARD_WIDTH, height: NODE_CARD_HEIGHT };
}

function getOutputAnchor(node, port) {
  const { width, height } = getNodeCardDimensions(node);
  const x = port === 'true'
    ? node.position.x + width * 0.28
    : port === 'false'
      ? node.position.x + width * 0.72
      : node.position.x + width * 0.5;
  return {
    x,
    y: node.position.y + height,
  };
}

function getInputAnchor(node) {
  const { width } = getNodeCardDimensions(node);
  return {
    x: node.position.x + width * 0.5,
    y: node.position.y,
  };
}

function buildRoundedPolylinePath(points, radius = 14) {
  const cleanPoints = points.filter((point, index) => {
    if (index === 0) return true;
    const previous = points[index - 1];
    return previous.x !== point.x || previous.y !== point.y;
  });
  if (cleanPoints.length < 2) return '';

  let path = `M ${cleanPoints[0].x} ${cleanPoints[0].y}`;
  for (let index = 1; index < cleanPoints.length - 1; index += 1) {
    const previous = cleanPoints[index - 1];
    const current = cleanPoints[index];
    const next = cleanPoints[index + 1];
    const inDx = current.x - previous.x;
    const inDy = current.y - previous.y;
    const outDx = next.x - current.x;
    const outDy = next.y - current.y;
    const inLength = Math.hypot(inDx, inDy);
    const outLength = Math.hypot(outDx, outDy);
    if (!inLength || !outLength) {
      path += ` L ${current.x} ${current.y}`;
      continue;
    }
    const normalizedInX = inDx / inLength;
    const normalizedInY = inDy / inLength;
    const normalizedOutX = outDx / outLength;
    const normalizedOutY = outDy / outLength;
    const isStraight = Math.abs(normalizedInX - normalizedOutX) < 0.001 && Math.abs(normalizedInY - normalizedOutY) < 0.001;
    if (isStraight) {
      path += ` L ${current.x} ${current.y}`;
      continue;
    }
    const cornerRadius = Math.min(radius, inLength / 2, outLength / 2);
    const curveStartX = current.x - normalizedInX * cornerRadius;
    const curveStartY = current.y - normalizedInY * cornerRadius;
    const curveEndX = current.x + normalizedOutX * cornerRadius;
    const curveEndY = current.y + normalizedOutY * cornerRadius;
    path += ` L ${curveStartX} ${curveStartY} Q ${current.x} ${current.y} ${curveEndX} ${curveEndY}`;
  }
  const lastPoint = cleanPoints[cleanPoints.length - 1];
  path += ` L ${lastPoint.x} ${lastPoint.y}`;
  return path;
}

function buildEdgePath(start, end, sourcePort) {
  if (sourcePort === 'next' && Math.abs(start.x - end.x) < 4) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  if (sourcePort !== 'next') {
    const splitY = start.y + BRANCH_STEM_HEIGHT;
    return buildRoundedPolylinePath([
      { x: start.x, y: start.y },
      { x: start.x, y: splitY },
      { x: end.x, y: splitY },
      { x: end.x, y: end.y },
    ]);
  }

  const startElbowY = start.y + 28;
  const endElbowY = Math.max(startElbowY, end.y - 28);

  return buildRoundedPolylinePath([
    { x: start.x, y: start.y },
    { x: start.x, y: startElbowY },
    { x: end.x, y: startElbowY },
    { x: end.x, y: endElbowY },
    { x: end.x, y: end.y },
  ]);
}

function buildReturnFromButtonPath(buttonPoint, rejoinPoint) {
  const startY = buttonPoint.y;
  const elbowY = buttonPoint.y + 28;
  if (Math.abs(buttonPoint.x - rejoinPoint.x) < 4) {
    return buildRoundedPolylinePath([
      { x: buttonPoint.x, y: startY },
      { x: buttonPoint.x, y: rejoinPoint.y },
    ]);
  }
  return buildRoundedPolylinePath([
    { x: buttonPoint.x, y: startY },
    { x: buttonPoint.x, y: elbowY },
    { x: rejoinPoint.x, y: elbowY },
    { x: rejoinPoint.x, y: rejoinPoint.y },
  ]);
}

function buildReturnAfterButtonPath(buttonPoint, rejoinPoint) {
  const startY = buttonPoint.y;
  const elbowY = buttonPoint.y + 28;
  if (Math.abs(buttonPoint.x - rejoinPoint.x) < 4) {
    return buildRoundedPolylinePath([
      { x: buttonPoint.x, y: startY },
      { x: buttonPoint.x, y: rejoinPoint.y },
    ]);
  }
  return buildRoundedPolylinePath([
    { x: buttonPoint.x, y: startY },
    { x: buttonPoint.x, y: elbowY },
    { x: rejoinPoint.x, y: elbowY },
    { x: rejoinPoint.x, y: rejoinPoint.y },
  ]);
}

function getLoosePortButtonPoint(source, port, node) {
  const branchLegMidY = source.y + BRANCH_STEM_HEIGHT + Math.max(28, (GRAPH_LEVEL_HEIGHT - BRANCH_STEM_HEIGHT) * 0.5);
  return {
    x: port === 'true' || port === 'submitted'
      ? source.x - BRANCH_LANE_GAP / 2
      : port === 'false' || port === 'error'
        ? source.x + BRANCH_LANE_GAP / 2
        : source.x,
    y: port === 'next'
      ? source.y + (node?.type === 'trigger' ? 18 : 28)
      : branchLegMidY,
  };
}

function getConditionCompareLabel(node, variableLookup) {
  if (!node?.config) return 'value';
  if (node.config.compareSource === 'variable') {
    const compareKey = `${node.config.compareVariableScope || 'page'}:${node.config.compareVariableId || ''}`;
    return variableLookup.get(compareKey)?.name || 'variable';
  }
  return node.config.compareValue || 'value';
}

function getNodeSummary(node, variableLookup, variableSources) {
  if (!node) return '';
  if (node.type === 'trigger') {
    const triggerType = node.config?.triggerType || 'custom';
    if (triggerType === 'form-submit') return 'Runs after submit result';
    if (triggerType === 'page-load') return 'Runs when the page loads';
    if (triggerType === 'element-click') return 'When this element is clicked';
    return 'Flow starting point';
  }
  if (node.type === 'submission-form') {
    const fieldCount = Array.isArray(node.config?.fields) ? node.config.fields.length : 0;
    const actionCount = countEnabledSubmissionActions(normalizeSubmissionActionConfig(node?.config?.actions));
    if (fieldCount || actionCount) {
      const parts = [];
      if (fieldCount) parts.push(`${fieldCount} field${fieldCount === 1 ? '' : 's'}`);
      if (actionCount) parts.push(`${actionCount} action${actionCount === 1 ? '' : 's'}`);
      return parts.join(' · ');
    }
    return 'Choose fields and submit actions';
  }
  if (node.type === 'navigate') {
    if (node.config?.destinationSource === 'variable' && node.config?.variableId) {
      const variableKey = `${node.config?.variableScope || 'page'}:${node.config?.variableId || ''}`;
      const variableName = variableLookup.get(variableKey)?.name || 'variable';
      return `Navigate to ${variableName}`;
    }
    return node.config?.pageTitle || node.config?.pageUrl || 'Choose destination';
  }
  if (node.type === 'set-variable') {
    const variableKey = `${node.config?.variableScope || 'page'}:${node.config?.variableId || ''}`;
    const variableName = variableLookup.get(variableKey)?.name || 'variable';
    const operation = node.config?.operation || 'set';
    if (operation === 'set' && node.config?.valueSource === 'submitted-field') {
      return `set ${variableName} from ${node.config?.submissionField || 'submitted field'}`;
    }
    if (operation === 'set' && node.config?.valueSource === 'response-path') {
      return `set ${variableName} from ${node.config?.responsePath || 'response path'}`;
    }
    return `${operation} ${variableName}`;
  }
  if (node.type === 'delay') return `${node.config?.durationMs ?? 300} ms delay`;
  if (node.type === 'condition') {
    const compareLabel = getConditionCompareLabel(node, variableLookup);
    if (node.config?.subjectSource === 'submitted-field') {
      return `If ${node.config?.submissionField || 'submitted field'} ${node.config?.operator || 'equals'} ${compareLabel}`;
    }
    if (node.config?.subjectSource === 'response-path') {
      return `If ${node.config?.responsePath || 'response path'} ${node.config?.operator || 'equals'} ${compareLabel}`;
    }
    const variableKey = `${node.config?.variableScope || 'page'}:${node.config?.variableId || ''}`;
    const variableName = variableLookup.get(variableKey)?.name || 'variable';
    return `If ${variableName} ${node.config?.operator || 'equals'} ${compareLabel}`;
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
  if (type === 'submission-form' && (flow.nodes ?? []).some((node) => node.type === 'submission-form')) return flow;
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

function moveNodeUpInFlow(flow, nodeId) {
  if (!flow || !nodeId) return flow;
  const nodeMap = getNodeMap(flow);
  const incomingEdges = getIncomingEdgeMap(flow);
  const edgesBySource = getEdgesBySource(flow);
  const currentNode = nodeMap.get(nodeId) || null;
  if (!currentNode || currentNode.type === 'trigger' || currentNode.type === 'condition') return flow;

  const incomingEdge = incomingEdges.get(nodeId) || null;
  const previousNode = incomingEdge ? nodeMap.get(incomingEdge.source) || null : null;
  if (!incomingEdge || !previousNode || previousNode.type === 'trigger' || previousNode.type === 'condition') return flow;

  const previousIncomingEdge = incomingEdges.get(previousNode.id) || null;
  if (!previousIncomingEdge) return flow;

  const nextEdge = edgesBySource.get(nodeId)?.get('next') || null;
  const removeIds = new Set([previousIncomingEdge.id, incomingEdge.id]);
  if (nextEdge) removeIds.add(nextEdge.id);

  const nextEdges = (flow.edges ?? []).filter((edge) => !removeIds.has(edge.id));
  nextEdges.push({
    id: makeId('flow-edge'),
    source: previousIncomingEdge.source,
    sourcePort: previousIncomingEdge.sourcePort || 'next',
    target: currentNode.id,
    targetPort: 'in',
  });
  nextEdges.push({
    id: makeId('flow-edge'),
    source: currentNode.id,
    sourcePort: 'next',
    target: previousNode.id,
    targetPort: 'in',
  });
  if (nextEdge) {
    nextEdges.push({
      id: makeId('flow-edge'),
      source: previousNode.id,
      sourcePort: 'next',
      target: nextEdge.target,
      targetPort: nextEdge.targetPort || 'in',
    });
  }

  return {
    ...flow,
    edges: nextEdges,
  };
}

function moveNodeDownInFlow(flow, nodeId) {
  if (!flow || !nodeId) return flow;
  const edgesBySource = getEdgesBySource(flow);
  const nextEdge = edgesBySource.get(nodeId)?.get('next') || null;
  if (!nextEdge) return flow;
  return moveNodeUpInFlow(flow, nextEdge.target);
}

function getReorderAvailability(flow, nodeId) {
  if (!flow || !nodeId) return { canMoveUp: false, canMoveDown: false };
  const nodeMap = getNodeMap(flow);
  const incomingEdges = getIncomingEdgeMap(flow);
  const edgesBySource = getEdgesBySource(flow);
  const node = nodeMap.get(nodeId) || null;
  if (!node || node.type === 'trigger' || node.type === 'condition') {
    return { canMoveUp: false, canMoveDown: false };
  }
  const incomingEdge = incomingEdges.get(nodeId) || null;
  const previousNode = incomingEdge ? nodeMap.get(incomingEdge.source) || null : null;
  const nextEdge = edgesBySource.get(nodeId)?.get('next') || null;
  const nextNode = nextEdge ? nodeMap.get(nextEdge.target) || null : null;
  return {
    canMoveUp: Boolean(previousNode && previousNode.type !== 'trigger' && previousNode.type !== 'condition' && incomingEdges.get(previousNode.id)),
    canMoveDown: Boolean(nextNode && nextNode.type !== 'condition'),
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

function getOrderedBranchPorts(node, flow, outgoing) {
  if (node?.type === 'trigger') return [];
  const ports = getNodeOutputPortsForFlow(node, flow).filter((port) => outgoing.get(port));
  if (ports.includes('true') || ports.includes('false')) {
    return ['true', 'false'].filter((port) => outgoing.get(port));
  }
  if (ports.includes('submitted') || ports.includes('error')) {
    return ['submitted', 'error'].filter((port) => outgoing.get(port));
  }
  return ports.filter((port) => port !== 'next');
}

function buildGraphLayout(flow) {
  if (!flow) return null;

  const nodeMap = getNodeMap(flow);
  const triggerNode = getTriggerNode(flow);
  const edgesBySource = getEdgesBySource(flow);
  const positions = new Map();
  let maxBottom = 0;
  let minLeft = Number.POSITIVE_INFINITY;
  let maxRight = 0;

  const getConditionBranchPorts = () => ['true', 'false'];
  const getLaneCenterForPort = (centerX, port) => {
    if (port === 'true') return centerX - BRANCH_LANE_GAP / 2;
    if (port === 'false') return centerX + BRANCH_LANE_GAP / 2;
    return centerX;
  };

  const getLinearBranchTail = (startNodeId) => {
    const visited = new Set();
    let currentId = startNodeId;
    let lastNode = null;
    while (currentId && nodeMap.has(currentId) && !visited.has(currentId)) {
      visited.add(currentId);
      const currentNode = nodeMap.get(currentId);
      lastNode = currentNode;
      if (!currentNode || currentNode.type === 'end' || currentNode.type === 'condition') break;
      const outgoing = edgesBySource.get(currentId) || new Map();
      const nextEdge = outgoing.get('next') || null;
      if (!nextEdge) break;
      currentId = nextEdge.target;
    }
    return lastNode;
  };

  const assign = (nodeId, centerX, topY, visiting = new Set()) => {
    if (!nodeId || !nodeMap.has(nodeId) || visiting.has(nodeId)) return topY;
    const node = nodeMap.get(nodeId);
    const { width, height } = getNodeCardDimensions(node);
    positions.set(nodeId, {
      x: centerX - width / 2,
      y: topY,
    });
    minLeft = Math.min(minLeft, centerX - width / 2);
    maxRight = Math.max(maxRight, centerX + width / 2);
    maxBottom = Math.max(maxBottom, topY + height);

    const nextVisiting = new Set(visiting);
    nextVisiting.add(nodeId);
    const outgoing = edgesBySource.get(nodeId) || new Map();
    if (node.type === 'condition') {
      const branchBottoms = getConditionBranchPorts().map((port) => {
        const edge = outgoing.get(port);
        if (!edge) return topY + height;
        return assign(edge.target, getLaneCenterForPort(centerX, port), topY + height + GRAPH_LEVEL_HEIGHT, nextVisiting);
      });
      const continuationEdge = outgoing.get('next') || null;
      if (continuationEdge) {
        const continuationTop = Math.max(topY + height, ...branchBottoms) + GRAPH_LEVEL_HEIGHT;
        return assign(continuationEdge.target, centerX, continuationTop, nextVisiting);
      }
      return Math.max(topY + height, ...branchBottoms);
    }

    const branchPorts = getOrderedBranchPorts(node, flow, outgoing);
    const nextEdge = getPrimaryNextEdge(node, outgoing) || outgoing.get(branchPorts[0]) || null;
    if (nextEdge) {
      return assign(nextEdge.target, centerX, topY + height + GRAPH_LEVEL_HEIGHT, nextVisiting);
    }
    return topY + height;
  };

  if (triggerNode) assign(triggerNode.id, WORKSPACE_CENTER_X, GRAPH_PADDING_Y);

  const positionedNodes = (flow.nodes ?? []).map((node, index) => {
    const position = positions.get(node.id) || {
      x: WORKSPACE_CENTER_X - NODE_CARD_WIDTH / 2,
      y: GRAPH_PADDING_Y + index * GRAPH_LEVEL_HEIGHT,
    };
    return { ...node, position };
  });

  const triggerOutgoing = triggerNode ? (edgesBySource.get(triggerNode.id) || new Map()) : new Map();
  const triggerNextEdge = triggerNode ? getPrimaryNextEdge(triggerNode, triggerOutgoing) : null;
  const triggerTarget = triggerNextEdge ? positionedNodes.find((node) => node.id === triggerNextEdge.target) || null : null;
  const triggerAlignedNodes = positionedNodes.map((node) => {
    if (node.type !== 'trigger') return node;
    const targetCenterX = triggerTarget
      ? triggerTarget.position.x + getNodeCardDimensions(triggerTarget).width / 2
      : WORKSPACE_CENTER_X;
    return {
      ...node,
      position: {
        ...node.position,
        x: Math.round(targetCenterX - getNodeCardDimensions(node).width / 2),
      },
    };
  });

  const positionedNodeMap = new Map(triggerAlignedNodes.map((node) => [node.id, node]));
  const renderedEdges = (flow.edges ?? []).map((edge) => {
    const sourceNode = positionedNodeMap.get(edge.source);
    const targetNode = positionedNodeMap.get(edge.target);
    if (!sourceNode || !targetNode) return null;
    const visualSourcePort = sourceNode.type === 'trigger' ? 'next' : (edge.sourcePort || 'next');
    const start = getOutputAnchor(sourceNode, visualSourcePort);
    const end = getInputAnchor(targetNode);
    return {
      ...edge,
      start,
      end,
      label: '',
      labelX: start.x + (end.x - start.x) * 0.5,
      labelY: start.y + 34,
      path: buildEdgePath(start, end, visualSourcePort),
    };
  }).filter(Boolean);

  const implicitEdges = [];
  const implicitGuides = [];
  const implicitAddButtons = [];
  const addButtons = [];
  const guides = [];
  const branchLabels = [];

  (flow.nodes ?? []).forEach((node) => {
    if (node?.type !== 'condition') return;
    const outgoing = edgesBySource.get(node.id) || new Map();
    const conditionNode = positionedNodeMap.get(node.id) || null;
    if (!conditionNode) return;
    const continuationEdge = outgoing.get('next') || null;
    const continuationTarget = continuationEdge ? (positionedNodeMap.get(continuationEdge.target) || null) : null;
    const branchBottoms = getConditionBranchPorts().map((port) => {
      const branchEdge = outgoing.get(port) || null;
      if (!branchEdge) return conditionNode.position.y + getNodeCardDimensions(conditionNode).height;
      const tailNode = getLinearBranchTail(branchEdge.target);
      const positionedTail = tailNode ? positionedNodeMap.get(tailNode.id) || null : null;
      if (!positionedTail) return conditionNode.position.y + getNodeCardDimensions(conditionNode).height;
      return positionedTail.position.y + getNodeCardDimensions(positionedTail).height;
    });
    const rejoinPoint = continuationTarget
      ? getInputAnchor(continuationTarget)
      : {
          x: getInputAnchor(conditionNode).x,
          y: Math.max(conditionNode.position.y + getNodeCardDimensions(conditionNode).height, ...branchBottoms) + GRAPH_LEVEL_HEIGHT,
        };

    if (!continuationTarget) {
      implicitAddButtons.push({
        key: `${node.id}:next-rejoin`,
        sourceId: node.id,
        sourcePort: 'next',
        x: rejoinPoint.x,
        y: rejoinPoint.y,
        label: getPortLabel('next'),
      });
    }

    getConditionBranchPorts().forEach((port) => {
      const branchEdge = outgoing.get(port) || null;
      if (!branchEdge) {
        const buttonPoint = getLoosePortButtonPoint(getOutputAnchor(conditionNode, port), port, conditionNode);
        implicitGuides.push({
          key: `${node.id}:${port}:rejoin-guide`,
          path: buildReturnFromButtonPath(buttonPoint, rejoinPoint),
        });
        return;
      }

      const tailNode = getLinearBranchTail(branchEdge.target);
      if (!tailNode || tailNode.type === 'end' || tailNode.type === 'condition') return;
      const positionedTail = positionedNodeMap.get(tailNode.id) || null;
      const tailOutgoing = edgesBySource.get(tailNode.id) || new Map();
      if (!positionedTail || tailOutgoing.get('next')) return;
      const start = getOutputAnchor(positionedTail, 'next');
      const buttonPoint = {
        x: start.x,
        y: start.y + 28,
      };
      const path = buildReturnAfterButtonPath(buttonPoint, rejoinPoint);
      if (continuationTarget) {
        implicitEdges.push({
          id: `${tailNode.id}:rejoin:${continuationTarget.id}`,
          start,
          end: rejoinPoint,
          sourcePort: 'next',
          path,
          isImplicit: true,
        });
      } else {
        implicitGuides.push({
          key: `${tailNode.id}:rejoin-guide`,
          path,
        });
      }
    });
  });

  triggerAlignedNodes.forEach((node) => {
    const outgoing = edgesBySource.get(node.id) || new Map();
    getNodeOutputPortsForFlow(node, flow).forEach((port) => {
      const source = getOutputAnchor(node, port);
      const edge = port === 'next' ? getPrimaryNextEdge(node, outgoing) : (outgoing.get(port) || null);
      if (edge) {
        const targetNode = positionedNodeMap.get(edge.target);
        if (!targetNode) return;
        const target = getInputAnchor(targetNode);
        const isVertical = Math.abs(source.x - target.x) < 4;
        const splitY = source.y + BRANCH_STEM_HEIGHT;
        if (port !== 'next') {
          branchLabels.push({
            key: `${edge.id}:label`,
            label: getPortLabel(port),
            x: source.x + (target.x - source.x) * 0.5,
            y: splitY - 12,
          });
        }
        addButtons.push({
          key: `${node.id}:${port}`,
          sourceId: node.id,
          sourcePort: port,
          x: isVertical ? source.x : target.x,
          y: isVertical
            ? source.y + (target.y - source.y) * 0.5
            : splitY + Math.max(24, (target.y - splitY) * 0.5),
          label: getPortLabel(port),
        });
        return;
      }

      const button = getLoosePortButtonPoint(source, port, node);
      addButtons.push({
        key: `${node.id}:${port}`,
        sourceId: node.id,
        sourcePort: port,
        x: button.x,
        y: button.y,
        label: getPortLabel(port),
      });
      if (port !== 'next') {
        branchLabels.push({
          key: `${node.id}:${port}:label`,
          label: getPortLabel(port),
          x: source.x + (button.x - source.x) * 0.5,
          y: source.y + BRANCH_STEM_HEIGHT - 12,
        });
      }
      guides.push({
        key: `${node.id}:${port}:guide`,
        path: buildEdgePath(source, button, port),
      });
    });
  });

  const maxX = triggerAlignedNodes.reduce((value, node) => {
    const { width } = getNodeCardDimensions(node);
    return Math.max(value, node.position.x + width);
  }, 0);
  const maxY = triggerAlignedNodes.reduce((value, node) => {
    const { height } = getNodeCardDimensions(node);
    return Math.max(value, node.position.y + height);
  }, 0);
  const buttonMaxX = addButtons.reduce((value, entry) => Math.max(value, entry.x + 22), 0);
  const buttonMaxY = addButtons.reduce((value, entry) => Math.max(value, entry.y + 22), 0);
  const contentWidth = Number.isFinite(minLeft) ? Math.max(0, maxRight - minLeft) : NODE_CARD_WIDTH;
  const contentCenterX = Number.isFinite(minLeft) ? minLeft + contentWidth / 2 : WORKSPACE_CENTER_X;

  return {
    nodes: triggerAlignedNodes,
    edges: [...renderedEdges, ...implicitEdges],
    guides: [...guides, ...implicitGuides],
    branchLabels,
    addButtons: [...addButtons, ...implicitAddButtons],
    placeholders: [],
    width: Math.max(WORKSPACE_WIDTH, maxX + GRAPH_PADDING_X * 2, buttonMaxX + GRAPH_PADDING_X * 2),
    height: Math.max(WORKSPACE_HEIGHT, maxY + GRAPH_PADDING_Y * 2, buttonMaxY + GRAPH_PADDING_Y * 2),
    contentCenterX,
    contentCenterY: Math.max(GRAPH_PADDING_Y, (maxBottom + GRAPH_PADDING_Y) / 2),
  };
}

function getAvailableNodeTypes(flow, submittedFieldOptions) {
  return NODE_TYPE_OPTIONS.filter((option) => {
    if (option.value !== 'submission-form') return true;
    return submittedFieldOptions.length > 0
      && !(flow?.nodes ?? []).some((node) => node.type === 'submission-form');
  });
}

function NodeTypeMenu({ flow, submittedFieldOptions, onAdd }) {
  const options = getAvailableNodeTypes(flow, submittedFieldOptions);
  return (
    <div className="fb-flow-graph__menu-list">
      {options.map((option) => (
        <button key={option.value} type="button" className="fb-secondary-btn fb-btn--sm" onClick={() => onAdd(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function getFlowOutlineNodes(graph) {
  if (!Array.isArray(graph?.nodes)) return [];
  return [...graph.nodes].sort((left, right) => {
    if (left.type === 'trigger' && right.type !== 'trigger') return -1;
    if (right.type === 'trigger' && left.type !== 'trigger') return 1;
    if (left.position.y !== right.position.y) return left.position.y - right.position.y;
    return left.position.x - right.position.x;
  });
}

function getActionStepNumber(graph, nodeId) {
  const orderedNodes = getFlowOutlineNodes(graph).filter((node) => node.type !== 'trigger');
  const index = orderedNodes.findIndex((node) => node.id === nodeId);
  return index >= 0 ? index + 1 : 0;
}

function FlowOutlineSidebar({ flow, graph, selectedNode, triggerSummary, variableLookup, variableSources, onSelectNode, onDeleteFlow }) {
  const orderedNodes = getFlowOutlineNodes(graph);
  const actionNodes = orderedNodes.filter((node) => node.type !== 'trigger');

  return (
    <aside className="fb-flow-editor__sidebar fb-flow-editor__sidebar--graph">
      <div className="fb-flow-editor__sidebar-head">
        <div>
          <div className="fb-flow-editor__sidebar-kicker">Trigger</div>
          <strong>{flow?.name || 'Interaction flow'}</strong>
        </div>
        {flow ? <button type="button" className="fb-secondary-btn fb-btn--sm" onClick={onDeleteFlow}>Delete</button> : null}
      </div>

      <div className="fb-flow-editor__summary-card">
        <strong>{triggerSummary}</strong>
        <small>{actionNodes.length ? `${actionNodes.length} action${actionNodes.length === 1 ? '' : 's'} in sequence` : 'No actions added yet.'}</small>
      </div>

      <div className="fb-flow-editor__flow-list">
        <div className="fb-flow-editor__sidebar-kicker">Action Outline</div>
        {orderedNodes.map((node, index) => (
          <button
            key={node.id}
            type="button"
            className={`fb-flow-editor__flow-item${selectedNode?.id === node.id ? ' is-active' : ''}`}
            onClick={() => onSelectNode(node.id)}
          >
            <span className="fb-flow-editor__flow-step">{node.type === 'trigger' ? 'Start' : `Step ${index}`}</span>
            <strong>{node.label || NODE_LABELS[node.type] || node.type}</strong>
            <small>{getNodeSummary(node, variableLookup, variableSources)}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

function FlowNodeCard({ node, summary, stepNumber, isSelected, isDragging = false, onSelect, onDelete, onContextMenu, onStartDrag }) {
  const isTrigger = node.type === 'trigger';
  const kicker = isTrigger ? 'Trigger' : `Action ${stepNumber || 1}`;
  const visibleSummary = !isTrigger && summary && summary !== 'Flow starting point' ? summary : '';
  const dimensions = getNodeCardDimensions(node);
  return (
    <div
      className={`fb-flow-graph__node${isSelected ? ' is-active' : ''}${isDragging ? ' is-dragging' : ''}${node.type === 'trigger' ? ' is-trigger' : ''}${node.type === 'condition' ? ' is-condition' : ''}${node.type === 'submission-form' ? ' is-form' : ''}`}
      data-node-type={node.type}
      style={{ left: node.position.x, top: node.position.y, width: dimensions.width, height: dimensions.height, minHeight: dimensions.height }}
      onContextMenu={(event) => onContextMenu?.(event, node.id)}
    >
      {!isTrigger ? (
        <div className="fb-flow-graph__node-controls">
          <button
            type="button"
            className="fb-flow-graph__node-handle"
            title="Drag to reorder"
            onPointerDown={(event) => onStartDrag?.(event, node.id)}
          >
            {UIIcons.dragHandle}
          </button>
          <button
            type="button"
            className="fb-flow-graph__node-trash"
            title="Delete action"
            onClick={(event) => {
              event.stopPropagation();
              onDelete?.(node.id);
            }}
          >
            {UIIcons.trash}
          </button>
        </div>
      ) : null}
      <button type="button" className="fb-flow-graph__node-main" onClick={onSelect}>
        {!isTrigger ? <span className="fb-flow-graph__node-kicker">{kicker}</span> : null}
        <strong>{isTrigger ? 'Trigger' : (node.label || NODE_LABELS[node.type] || node.type)}</strong>
        {visibleSummary ? <small>{visibleSummary}</small> : null}
      </button>
    </div>
  );
}

function SubmissionActionToggle({ label, checked, disabled = false, onChange, note = '' }) {
  return (
    <div className="fb-flow-editor__action-toggle-row">
      <div className="fb-flow-editor__action-toggle-copy">
        <span className="fb-variable-field__label">{label}</span>
        {note ? <span className="fb-artboard-bp-note">{note}</span> : null}
      </div>
      <button
        type="button"
        className="fb-toggle"
        onClick={() => {
          if (disabled) return;
          onChange(!checked);
        }}
        aria-pressed={checked}
        disabled={disabled}
      >
        <div className={`fb-toggle__track${checked ? ' fb-toggle__track--on' : ''}`}>
          <div className="fb-toggle__thumb" />
        </div>
      </button>
    </div>
  );
}

function SubmissionMappingList({ label, listLabel, keyName, keyOptions, fieldOptions, mappings, onChange, emptyLabel }) {
  const normalizedKeyOptions = normalizeSubmissionTargetOptions(keyOptions);
  const selectedKeys = new Set((mappings ?? []).map((entry) => entry[keyName]));
  const remainingKeys = normalizedKeyOptions.filter((option) => !selectedKeys.has(option.value));

  const appendMapping = () => {
    const nextKey = remainingKeys[0]?.value;
    const nextField = fieldOptions[0]?.fieldName;
    if (!nextKey || !nextField) return;
    onChange([...(mappings ?? []), { id: makeSubmissionConfigId(keyName), [keyName]: nextKey, fieldName: nextField }]);
  };

  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      <div className="fb-artboard-bp-note">{label}</div>
      {(mappings ?? []).length ? (mappings ?? []).map((entry) => {
        const availableKeyOptions = normalizedKeyOptions.filter((option) => option.value === entry[keyName] || !selectedKeys.has(option.value));
        return (
          <div key={entry.id} style={{ display: 'grid', gap: 6, padding: 10, border: '1px solid var(--panel-border, #3c434a)', borderRadius: 8 }}>
            <label className="fb-variable-field">
              <span className="fb-variable-field__label">{listLabel}</span>
              <select
                className="fb-prop-input"
                value={entry[keyName]}
                onChange={(event) => onChange((mappings ?? []).map((mapping) => (
                  mapping.id === entry.id ? { ...mapping, [keyName]: event.target.value } : mapping
                )))}
              >
                {availableKeyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="fb-variable-field">
              <span className="fb-variable-field__label">Form Field</span>
              <select
                className="fb-prop-input"
                value={entry.fieldName}
                onChange={(event) => onChange((mappings ?? []).map((mapping) => (
                  mapping.id === entry.id ? { ...mapping, fieldName: event.target.value } : mapping
                )))}
              >
                {fieldOptions.map((option) => <option key={option.id} value={option.fieldName}>{option.label}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="fb-secondary-btn fb-btn--sm"
              onClick={() => onChange((mappings ?? []).filter((mapping) => mapping.id !== entry.id))}
            >
              Remove Mapping
            </button>
          </div>
        );
      }) : <div className="fb-artboard-bp-note">{emptyLabel}</div>}
      <button type="button" className="fb-secondary-btn fb-btn--sm" disabled={!remainingKeys.length || !fieldOptions.length} onClick={appendMapping}>
        Add Mapping
      </button>
    </div>
  );
}

function SubmissionActionPanel({ title, enabled, onToggle, children }) {
  return (
    <div className="fb-flow-editor__action-panel">
      <SubmissionActionToggle label={title} checked={enabled} onChange={onToggle} />
      {enabled ? <div className="fb-flow-editor__action-panel-body">{children}</div> : null}
    </div>
  );
}

function SubmissionFormInspector({ selectedNode, submittedFieldOptions, actionTargets, legacyFormConfig, onNodeChange }) {
  const [pendingField, setPendingField] = useState('');
  const inspectorConfig = getSubmissionInspectorConfig(selectedNode, legacyFormConfig?.actions);
  const configuredFields = getSubmissionFormFields({ ...selectedNode, config: { ...selectedNode.config, fields: inspectorConfig.fields } }, submittedFieldOptions);
  const selectedFieldNames = new Set(configuredFields.map((field) => field.fieldName));
  const remainingFields = submittedFieldOptions.filter((field) => !selectedFieldNames.has(field.fieldName));

  useEffect(() => {
    if (!remainingFields.length) {
      setPendingField('');
      return;
    }
    if (!pendingField || !remainingFields.some((field) => field.fieldName === pendingField)) {
      setPendingField(remainingFields[0].fieldName);
    }
  }, [pendingField, remainingFields]);

  const updateSubmissionNode = (patch) => onNodeChange({
    ...selectedNode,
    config: {
      ...selectedNode.config,
      fields: inspectorConfig.fields,
      actions: inspectorConfig.actions,
      ...patch,
    },
  });

  const updateFields = (nextFields) => updateSubmissionNode({
    fields: nextFields.map((field) => ({
      id: field.id,
      fieldName: field.fieldName,
      label: field.label,
      type: field.type,
      valueType: field.valueType,
      path: field.path,
    })),
  });

  const updateNamedAction = (actionKey, patch) => updateSubmissionNode({
    actions: {
      ...inspectorConfig.actions,
      [actionKey]: {
        ...inspectorConfig.actions[actionKey],
        ...patch,
      },
    },
  });

  const postTarget = actionTargets?.post ?? {};
  const categoryTarget = actionTargets?.category ?? {};
  const productCategoryTarget = actionTargets?.productCategory ?? {};
  const productTarget = actionTargets?.product ?? {};

  return (
    <>
      <div className="fb-artboard-bp-note">Controls which fields are included in the submission payload, and in what order.</div>
      <div className="fb-flow-editor__submission-list">
        {configuredFields.map((field, index) => (
          <div
            key={field.id}
            className="fb-flow-editor__submission-item"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', String(index));
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(event) => {
              event.preventDefault();
              const fromIndex = parseInt(event.dataTransfer.getData('text/plain'), 10);
              if (!Number.isInteger(fromIndex) || fromIndex === index || fromIndex < 0 || fromIndex >= configuredFields.length) return;
              const nextFields = [...configuredFields];
              const [movedField] = nextFields.splice(fromIndex, 1);
              nextFields.splice(index, 0, movedField);
              updateFields(nextFields);
            }}
          >
            <button type="button" className="fb-flow-editor__submission-handle" title="Reorder field">
              {UIIcons.dragHandle}
            </button>
            <div className="fb-flow-editor__submission-copy">
              <strong>{field.label}</strong>
              <small>{field.fieldName}</small>
            </div>
            <IconButton
              icon={UIIcons.trash}
              title="Remove field"
              className="fb-flow-editor__submission-remove"
              onClick={() => updateFields(configuredFields.filter((entry) => entry.fieldName !== field.fieldName))}
            />
          </div>
        ))}
      </div>
      <div className="fb-flow-editor__submission-add-row">
        <select className="fb-prop-input" value={pendingField} onChange={(event) => setPendingField(event.target.value)} disabled={!remainingFields.length}>
          {remainingFields.length ? null : <option value="">All form fields are included</option>}
          {remainingFields.map((field) => <option key={field.id} value={field.fieldName}>{field.label}</option>)}
        </select>
        <button
          type="button"
          className="fb-secondary-btn fb-btn--sm"
          disabled={!pendingField}
          onClick={() => {
            const nextField = remainingFields.find((field) => field.fieldName === pendingField) || null;
            if (!nextField) return;
            updateFields([...configuredFields, nextField]);
          }}
        >
          Add Field
        </button>
      </div>

      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <SubmissionActionPanel title="Store Submission" enabled={inspectorConfig.actions.store.enabled !== false} onToggle={(checked) => updateNamedAction('store', { enabled: checked })}>
          <div className="fb-artboard-bp-note">Stores each submission in WordPress for the Form Submissions admin screen.</div>
        </SubmissionActionPanel>

        <SubmissionActionPanel title="Send Email" enabled={inspectorConfig.actions.email.enabled === true} onToggle={(checked) => updateNamedAction('email', { enabled: checked })}>
          <label className="fb-variable-field">
            <span className="fb-variable-field__label">Email To</span>
            <input className="fb-prop-input" type="email" value={inspectorConfig.actions.email.to} onChange={(event) => updateNamedAction('email', { to: event.target.value })} placeholder="hello@example.com" />
          </label>
          <label className="fb-variable-field">
            <span className="fb-variable-field__label">Subject</span>
            <input className="fb-prop-input" type="text" value={inspectorConfig.actions.email.subject} onChange={(event) => updateNamedAction('email', { subject: event.target.value })} placeholder="New form submission" />
          </label>
        </SubmissionActionPanel>

        <SubmissionActionPanel title="Send Webhook" enabled={inspectorConfig.actions.webhook.enabled === true} onToggle={(checked) => updateNamedAction('webhook', { enabled: checked })}>
          <label className="fb-variable-field">
            <span className="fb-variable-field__label">Webhook URL</span>
            <input className="fb-prop-input" type="url" value={inspectorConfig.actions.webhook.url} onChange={(event) => updateNamedAction('webhook', { url: event.target.value })} placeholder="https://example.com/webhook" />
          </label>
        </SubmissionActionPanel>

        <SubmissionActionPanel title="Create Post" enabled={inspectorConfig.actions.createPost.enabled === true} onToggle={(checked) => updateNamedAction('createPost', { enabled: checked })}>
          <label className="fb-variable-field">
            <span className="fb-variable-field__label">Post Status</span>
            <select className="fb-prop-input" value={inspectorConfig.actions.createPost.status || 'draft'} onChange={(event) => updateNamedAction('createPost', { status: event.target.value })}>
              {(postTarget.statuses ?? SUBMISSION_STATUS_OPTIONS).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="fb-artboard-bp-note">Map a file upload field to Featured Image when you want the created post to include media.</div>
          <SubmissionMappingList label="Map submitted form fields to WordPress post fields." listLabel="Post Field" keyName="targetKey" keyOptions={postTarget.fields ?? []} fieldOptions={submittedFieldOptions} mappings={inspectorConfig.actions.createPost.fieldMappings} onChange={(nextList) => updateNamedAction('createPost', { fieldMappings: nextList })} emptyLabel="No post fields mapped yet." />
          {(postTarget.acfFields ?? []).length ? <SubmissionMappingList label="Optional ACF field mapping for the created post." listLabel="ACF Field" keyName="fieldKey" keyOptions={(postTarget.acfFields ?? []).map((field) => ({ value: field.key, label: field.label }))} fieldOptions={submittedFieldOptions} mappings={inspectorConfig.actions.createPost.acfMappings} onChange={(nextList) => updateNamedAction('createPost', { acfMappings: nextList })} emptyLabel="No post ACF fields mapped yet." /> : null}
        </SubmissionActionPanel>

        <SubmissionActionPanel title="Create Category" enabled={inspectorConfig.actions.createCategory.enabled === true} onToggle={(checked) => updateNamedAction('createCategory', { enabled: checked })}>
          <div className="fb-artboard-bp-note">Category Image accepts an uploaded file and stores its attachment on the created term.</div>
          <SubmissionMappingList label="Map form fields to WordPress category fields." listLabel="Category Field" keyName="targetKey" keyOptions={categoryTarget.fields ?? []} fieldOptions={submittedFieldOptions} mappings={inspectorConfig.actions.createCategory.fieldMappings} onChange={(nextList) => updateNamedAction('createCategory', { fieldMappings: nextList })} emptyLabel="No category fields mapped yet." />
          {(categoryTarget.acfFields ?? []).length ? <SubmissionMappingList label="Optional ACF field mapping for the created category term." listLabel="ACF Field" keyName="fieldKey" keyOptions={(categoryTarget.acfFields ?? []).map((field) => ({ value: field.key, label: field.label }))} fieldOptions={submittedFieldOptions} mappings={inspectorConfig.actions.createCategory.acfMappings} onChange={(nextList) => updateNamedAction('createCategory', { acfMappings: nextList })} emptyLabel="No category ACF fields mapped yet." /> : null}
        </SubmissionActionPanel>

        <SubmissionActionPanel title="Create Product Category" enabled={inspectorConfig.actions.createProductCategory.enabled === true} onToggle={(checked) => updateNamedAction('createProductCategory', { enabled: checked })}>
          {!productCategoryTarget.enabled ? <div className="fb-artboard-bp-note">WooCommerce product categories are not available on this site.</div> : null}
          {productCategoryTarget.enabled ? (
            <>
              <div className="fb-artboard-bp-note">Category Image uses the uploaded file as the WooCommerce term thumbnail.</div>
              <SubmissionMappingList label="Map form fields to WooCommerce product category fields." listLabel="Product Category Field" keyName="targetKey" keyOptions={productCategoryTarget.fields ?? []} fieldOptions={submittedFieldOptions} mappings={inspectorConfig.actions.createProductCategory.fieldMappings} onChange={(nextList) => updateNamedAction('createProductCategory', { fieldMappings: nextList })} emptyLabel="No product category fields mapped yet." />
              {(productCategoryTarget.acfFields ?? []).length ? <SubmissionMappingList label="Optional ACF field mapping for the created product category term." listLabel="ACF Field" keyName="fieldKey" keyOptions={(productCategoryTarget.acfFields ?? []).map((field) => ({ value: field.key, label: field.label }))} fieldOptions={submittedFieldOptions} mappings={inspectorConfig.actions.createProductCategory.acfMappings} onChange={(nextList) => updateNamedAction('createProductCategory', { acfMappings: nextList })} emptyLabel="No product category ACF fields mapped yet." /> : null}
            </>
          ) : null}
        </SubmissionActionPanel>

        <SubmissionActionPanel title="Create Product" enabled={inspectorConfig.actions.createProduct.enabled === true} onToggle={(checked) => updateNamedAction('createProduct', { enabled: checked })}>
          {!productTarget.enabled ? <div className="fb-artboard-bp-note">WooCommerce products are not available on this site.</div> : null}
          {productTarget.enabled ? (
            <>
              <label className="fb-variable-field">
                <span className="fb-variable-field__label">Product Status</span>
                <select className="fb-prop-input" value={inspectorConfig.actions.createProduct.status || 'draft'} onChange={(event) => updateNamedAction('createProduct', { status: event.target.value })}>
                  {(productTarget.statuses ?? SUBMISSION_STATUS_OPTIONS).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <div className="fb-artboard-bp-note">Product Image uses the first uploaded file. Product Gallery accepts one or many uploaded files.</div>
              <SubmissionMappingList label="Map form fields to WooCommerce product fields." listLabel="Product Field" keyName="targetKey" keyOptions={productTarget.fields ?? []} fieldOptions={submittedFieldOptions} mappings={inspectorConfig.actions.createProduct.fieldMappings} onChange={(nextList) => updateNamedAction('createProduct', { fieldMappings: nextList })} emptyLabel="No product fields mapped yet." />
              {(productTarget.acfFields ?? []).length ? <SubmissionMappingList label="Optional ACF field mapping for the created product." listLabel="ACF Field" keyName="fieldKey" keyOptions={(productTarget.acfFields ?? []).map((field) => ({ value: field.key, label: field.label }))} fieldOptions={submittedFieldOptions} mappings={inspectorConfig.actions.createProduct.acfMappings} onChange={(nextList) => updateNamedAction('createProduct', { acfMappings: nextList })} emptyLabel="No product ACF fields mapped yet." /> : null}
            </>
          ) : null}
        </SubmissionActionPanel>
      </div>
    </>
  );
}

function FlowInspector({ flow, selectedNode, onFlowChange, onNodeChange, onDeleteNode, pageVariables, globalVariables, loopItemVariables, variableSources, elementName, submittedFieldOptions, legacyFormConfig }) {
  const variableOptions = getSelectedVariableOptions(pageVariables, globalVariables);
  const navigationVariableOptions = getNavigationVariableOptions(pageVariables, globalVariables, loopItemVariables);
  const triggerSummary = getTriggerSummary(flow, elementName);
  const supportsSubmissionData = getFlowTriggerType(flow) === 'form-submit';

  if (!flow) return <div className="fb-empty-state__text">No flow selected.</div>;
  if (!selectedNode || selectedNode.type === 'trigger') {
    return (
      <div className="fb-flow-editor__inspector-group">
        <label className="fb-variable-field">
          <span className="fb-variable-field__label">Flow Name</span>
          <input className="fb-prop-input" type="text" value={flow.name || ''} onChange={(event) => onFlowChange({ ...flow, name: event.target.value })} />
        </label>
        <div className="fb-artboard-bp-note">Trigger: {triggerSummary}</div>
      </div>
    );
  }

  return (
    <div className="fb-flow-editor__inspector-group">
      <div className="fb-flow-editor__inspector-head">
        <strong>{selectedNode.label || NODE_LABELS[selectedNode.type] || selectedNode.type}</strong>
        {selectedNode.type !== 'trigger' ? <button type="button" className="fb-secondary-btn fb-btn--sm" onClick={() => onDeleteNode?.(selectedNode.id)}>Delete</button> : null}
      </div>

      {selectedNode.type === 'navigate' ? (
        <>
          <label className="fb-variable-field">
            <span className="fb-variable-field__label">Destination Source</span>
            <select
              className="fb-prop-input"
              value={selectedNode.config?.destinationSource === 'variable' ? 'variable' : 'page'}
              onChange={(event) => {
                const destinationSource = event.target.value === 'variable' ? 'variable' : 'page';
                onNodeChange({
                  ...selectedNode,
                  config: {
                    ...selectedNode.config,
                    destinationSource,
                  },
                });
              }}
            >
              <option value="page">Page</option>
              <option value="variable">Variable</option>
            </select>
          </label>
          {selectedNode.config?.destinationSource === 'variable' ? (
            <label className="fb-variable-field">
              <span className="fb-variable-field__label">Destination Variable</span>
              <select
                className="fb-prop-input"
                value={`${selectedNode.config?.variableScope || 'page'}:${selectedNode.config?.variableId || ''}`}
                onChange={(event) => {
                  const [variableScope, variableId] = event.target.value.split(':');
                  const variable = navigationVariableOptions.find((entry) => entry.scope === variableScope && entry.id === variableId) || null;
                  onNodeChange({
                    ...selectedNode,
                    config: {
                      ...selectedNode.config,
                      destinationSource: 'variable',
                      variableScope,
                      variableId,
                      variableType: variable?.type || 'string',
                    },
                  });
                }}
              >
                <option value="page:">Select variable…</option>
                {navigationVariableOptions.map((variable) => (
                  <option key={`${variable.scope}:${variable.id}`} value={`${variable.scope}:${variable.id}`}>
                    {getVariableOptionLabel(variable)}
                  </option>
                ))}
              </select>
              <div className="fb-artboard-bp-note">Use Item URL to navigate each loop card to its own post or product.</div>
            </label>
          ) : (
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
                      destinationSource: 'page',
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
          )}
        </>
      ) : null}

      {selectedNode.type === 'submission-form' ? (
        <SubmissionFormInspector
          selectedNode={selectedNode}
          submittedFieldOptions={submittedFieldOptions}
          actionTargets={variableSources.formTargets ?? {}}
          legacyFormConfig={legacyFormConfig}
          onNodeChange={onNodeChange}
        />
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
          {(selectedNode.config?.operation || 'set') === 'set' ? (
            <>
              <label className="fb-variable-field">
                <span className="fb-variable-field__label">Value Source</span>
                <select
                  className="fb-prop-input"
                  value={selectedNode.config?.valueSource || 'manual'}
                  onChange={(event) => onNodeChange({
                    ...selectedNode,
                    config: {
                      ...selectedNode.config,
                      valueSource: event.target.value,
                    },
                  })}
                >
                  <option value="manual">Manual value</option>
                  {supportsSubmissionData ? <option value="submitted-field">Submitted field</option> : null}
                  {supportsSubmissionData ? <option value="response-path">Custom response path</option> : null}
                </select>
              </label>
              {selectedNode.config?.valueSource === 'submitted-field' ? (
                <label className="fb-variable-field">
                  <span className="fb-variable-field__label">Submitted Field</span>
                  <select
                    className="fb-prop-input"
                    value={selectedNode.config?.submissionField || ''}
                    onChange={(event) => onNodeChange({
                      ...selectedNode,
                      config: {
                        ...selectedNode.config,
                        submissionField: event.target.value,
                        responsePath: event.target.value ? `submission.values.${event.target.value}` : '',
                      },
                    })}
                  >
                    <option value="">Select field…</option>
                    {submittedFieldOptions.map((field) => (
                      <option key={field.id} value={field.fieldName}>{field.label}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {selectedNode.config?.valueSource === 'response-path' ? (
                <label className="fb-variable-field">
                  <span className="fb-variable-field__label">Response Path</span>
                  <input
                    className="fb-prop-input"
                    type="text"
                    value={selectedNode.config?.responsePath ?? ''}
                    onChange={(event) => onNodeChange({
                      ...selectedNode,
                      config: {
                        ...selectedNode.config,
                        responsePath: event.target.value,
                      },
                    })}
                    placeholder="submission.values.email"
                  />
                </label>
              ) : null}
              {(selectedNode.config?.valueSource || 'manual') === 'manual' ? (
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
              ) : null}
            </>
          ) : (
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
          )}
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
            <span className="fb-variable-field__label">Subject Source</span>
            <select
              className="fb-prop-input"
              value={selectedNode.config?.subjectSource || 'variable'}
              onChange={(event) => onNodeChange({
                ...selectedNode,
                config: { ...selectedNode.config, subjectSource: event.target.value },
              })}
            >
              <option value="variable">Variable</option>
              {supportsSubmissionData ? <option value="submitted-field">Submitted field</option> : null}
              {supportsSubmissionData ? <option value="response-path">Custom response path</option> : null}
            </select>
          </label>
          {(selectedNode.config?.subjectSource || 'variable') === 'variable' ? (
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
          ) : null}
          {selectedNode.config?.subjectSource === 'submitted-field' ? (
            <label className="fb-variable-field">
              <span className="fb-variable-field__label">Submitted Field</span>
              <select
                className="fb-prop-input"
                value={selectedNode.config?.submissionField || ''}
                onChange={(event) => onNodeChange({
                  ...selectedNode,
                  config: {
                    ...selectedNode.config,
                    submissionField: event.target.value,
                    responsePath: event.target.value ? `submission.values.${event.target.value}` : '',
                  },
                })}
              >
                <option value="">Select field…</option>
                {submittedFieldOptions.map((field) => (
                  <option key={field.id} value={field.fieldName}>{field.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          {selectedNode.config?.subjectSource === 'response-path' ? (
            <label className="fb-variable-field">
              <span className="fb-variable-field__label">Response Path</span>
              <input
                className="fb-prop-input"
                type="text"
                value={selectedNode.config?.responsePath ?? ''}
                onChange={(event) => onNodeChange({
                  ...selectedNode,
                  config: { ...selectedNode.config, responsePath: event.target.value },
                })}
                placeholder="submission.values.email"
              />
            </label>
          ) : null}
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
            <span className="fb-variable-field__label">Compare Against</span>
            <select
              className="fb-prop-input"
              value={selectedNode.config?.compareSource || 'manual'}
              onChange={(event) => onNodeChange({
                ...selectedNode,
                config: { ...selectedNode.config, compareSource: event.target.value },
              })}
            >
              <option value="manual">Manual value</option>
              <option value="variable">Variable</option>
            </select>
          </label>
          {(selectedNode.config?.compareSource || 'manual') === 'variable' ? (
            <label className="fb-variable-field">
              <span className="fb-variable-field__label">Compare Variable</span>
              <select
                className="fb-prop-input"
                value={`${selectedNode.config?.compareVariableScope || 'page'}:${selectedNode.config?.compareVariableId || ''}`}
                onChange={(event) => {
                  const [scope, variableId] = event.target.value.split(':');
                  onNodeChange({
                    ...selectedNode,
                    config: { ...selectedNode.config, compareVariableScope: scope, compareVariableId: variableId },
                  });
                }}
              >
                <option value="page:">Select variable…</option>
                {variableOptions.map((variable) => (
                  <option key={`compare:${variable.scope}:${variable.id}`} value={`${variable.scope}:${variable.id}`}>
                    {variable.scope === 'global' ? 'Global' : 'Page'} / {variable.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
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
          )}
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
  const getCurrentPageFlows = useEditorStore((state) => state.getCurrentPageFlows);
  const getCurrentPageVariables = useEditorStore((state) => state.getCurrentPageVariables);
  const globalVariables = useEditorStore((state) => state.globalVariables);
  const variableSources = useEditorStore((state) => state.variableSources);
  const allElements = useEditorStore((state) => state.getAllElements());

  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [menuState, setMenuState] = useState(null);
  const [contextMenuState, setContextMenuState] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState('');
  const canvasWrapRef = useRef(null);
  const panStateRef = useRef(null);
  const dragStateRef = useRef(null);
  const centeredFlowIdRef = useRef('');

  const flows = getCurrentPageFlows({ includeLegacy: false });
  const pageVariables = getCurrentPageVariables();
  const element = flowEditorState.elementId ? allElements.find((entry) => entry.id === flowEditorState.elementId) || null : null;
  const loopItemVariables = useMemo(() => getLoopItemPreviewVariables(element, allElements, variableSources, pageVariables, globalVariables), [allElements, element, globalVariables, pageVariables, variableSources]);
  const selectedTriggerType = isFormContainerType(element?.type) ? 'form-submit' : 'element-click';
  const variableOptions = useMemo(() => getSelectedVariableOptions(pageVariables, globalVariables), [pageVariables, globalVariables]);
  const navigationVariableOptions = useMemo(() => getNavigationVariableOptions(pageVariables, globalVariables, loopItemVariables), [globalVariables, loopItemVariables, pageVariables]);
  const variableLookup = useMemo(() => new Map([...variableOptions, ...navigationVariableOptions].map((variable) => [`${variable.scope}:${variable.id}`, variable])), [navigationVariableOptions, variableOptions]);

  const activeFlow = useMemo(() => {
    const requestedFlow = flowEditorState.flowId
      ? flows.find((flow) => flow.id === flowEditorState.flowId) || null
      : null;
    if (requestedFlow && (selectedTriggerType !== 'form-submit' || requestedFlow.trigger?.type === 'form-submit')) return requestedFlow;
    if (flowEditorState.elementId) {
      const matchedFlow = flows.find((flow) => (
        selectedTriggerType === 'form-submit'
          ? flow.trigger?.type === 'form-submit' && flow.trigger?.formId === flowEditorState.elementId
          : flow.trigger?.type === 'element-click' && flow.trigger?.elementId === flowEditorState.elementId
      )) || null;
      if (matchedFlow) return matchedFlow;
    }
    return selectedTriggerType === 'form-submit' ? null : (flows[0] || null);
  }, [flowEditorState.elementId, flowEditorState.flowId, flows, selectedTriggerType]);

  const graph = useMemo(() => buildGraphLayout(activeFlow), [activeFlow]);
  const flowFormElement = useMemo(() => getFlowFormElement(activeFlow, element, allElements), [activeFlow, allElements, element]);
  const legacyFormConfig = useMemo(() => normalizeFormConfig(flowFormElement?.base?.formConfig), [flowFormElement]);
  const submittedFieldOptions = useMemo(() => getFormFieldOptions(flowFormElement, allElements), [allElements, flowFormElement]);

  const triggerSummary = getTriggerSummary(activeFlow, element?.name || 'Selected element');

  useEffect(() => {
    if (!activeFlow) {
      setSelectedNodeId('');
      setMenuState(null);
      setContextMenuState(null);
      return;
    }
    const triggerNode = getTriggerNode(activeFlow);
    const fallbackNode = (activeFlow.nodes ?? []).find((node) => node.type !== 'trigger') || triggerNode || null;
    if (!selectedNodeId || !(activeFlow.nodes ?? []).some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(fallbackNode?.id || '');
    }
  }, [activeFlow, selectedNodeId]);

  const selectedNode = selectedNodeId
    ? (activeFlow?.nodes ?? []).find((node) => node.id === selectedNodeId) || null
    : getTriggerNode(activeFlow);

  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap || !activeFlow || !graph) return;
    if (centeredFlowIdRef.current === activeFlow.id) return;

    centeredFlowIdRef.current = activeFlow.id;
    const targetLeft = Math.max(0, graph.contentCenterX - wrap.clientWidth / 2);
    const targetTop = Math.max(0, graph.contentCenterY - wrap.clientHeight / 2);
    wrap.scrollTo({ left: targetLeft, top: targetTop, behavior: 'auto' });
  }, [activeFlow, graph]);

  const saveFlow = (nextFlow) => {
    if (!nextFlow) return;
    upsertPageFlow(nextFlow);
  };

  const handleAddNode = (type) => {
    if (!activeFlow || !menuState?.sourceId || !menuState?.sourcePort) return;
    let nextFlow = insertNodeOnPort(activeFlow, menuState.sourceId, menuState.sourcePort, type);
    if (type === 'submission-form') {
      const newNode = (nextFlow.nodes ?? []).find((node) => !(activeFlow.nodes ?? []).some((entry) => entry.id === node.id)) || null;
      if (newNode) {
        nextFlow = updateNode(nextFlow, newNode.id, {
          ...newNode,
          config: createSubmissionNodeConfig(submittedFieldOptions, newNode.config?.actions),
        });
      }
    }
    const newNode = (nextFlow.nodes ?? []).find((node) => !(activeFlow.nodes ?? []).some((entry) => entry.id === node.id)) || null;
    saveFlow(nextFlow);
    setSelectedNodeId(newNode?.id || '');
    setMenuState(null);
    setContextMenuState(null);
  };

  const handleDeleteNode = (nodeId) => {
    if (!activeFlow) return;
    const nextFlow = deleteNodeFromFlow(activeFlow, nodeId);
    saveFlow(nextFlow);
    setSelectedNodeId(getTriggerNode(nextFlow)?.id || '');
    setMenuState(null);
    setContextMenuState(null);
  };

  const handleMoveNodeUp = (nodeId) => {
    if (!activeFlow) return;
    const nextFlow = moveNodeUpInFlow(activeFlow, nodeId);
    if (nextFlow === activeFlow) return;
    saveFlow(nextFlow);
    setSelectedNodeId(nodeId);
    setMenuState(null);
    setContextMenuState(null);
  };

  const handleMoveNodeDown = (nodeId) => {
    if (!activeFlow) return;
    const nextFlow = moveNodeDownInFlow(activeFlow, nodeId);
    if (nextFlow === activeFlow) return;
    saveFlow(nextFlow);
    setSelectedNodeId(nodeId);
    setMenuState(null);
    setContextMenuState(null);
  };

  const handleCardContextMenu = (event, nodeId) => {
    const node = (activeFlow?.nodes ?? []).find((entry) => entry.id === nodeId) || null;
    if (!node || node.type === 'trigger') return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedNodeId(nodeId);
    setMenuState(null);
    setContextMenuState({ nodeId, x: event.clientX, y: event.clientY });
  };

  const handleStartDragNode = (event, nodeId) => {
    event.stopPropagation();
    event.preventDefault();
    dragStateRef.current = {
      nodeId,
      lastClientY: event.clientY,
    };
    setDraggingNodeId(nodeId);
  };

  useEffect(() => {
    const handlePointerMove = (event) => {
      const panState = panStateRef.current;
      const wrap = canvasWrapRef.current;
      if (panState && wrap) {
        wrap.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX);
        wrap.scrollTop = panState.scrollTop - (event.clientY - panState.startY);
        return;
      }

      const dragState = dragStateRef.current;
      if (!dragState || !activeFlow) return;
      const deltaY = event.clientY - dragState.lastClientY;
      if (Math.abs(deltaY) < DRAG_REORDER_THRESHOLD) return;

      const nextFlow = deltaY > 0
        ? moveNodeDownInFlow(activeFlow, dragState.nodeId)
        : moveNodeUpInFlow(activeFlow, dragState.nodeId);
      if (nextFlow !== activeFlow) {
        saveFlow(nextFlow);
        setSelectedNodeId(dragState.nodeId);
      }
      dragStateRef.current = {
        ...dragState,
        lastClientY: event.clientY,
      };
    };

    const stopInteractions = () => {
      if (panStateRef.current) {
        panStateRef.current = null;
        setIsPanning(false);
      }
      if (dragStateRef.current) {
        dragStateRef.current = null;
        setDraggingNodeId('');
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopInteractions);
    window.addEventListener('pointercancel', stopInteractions);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopInteractions);
      window.removeEventListener('pointercancel', stopInteractions);
    };
  }, [activeFlow]);

  useEffect(() => {
    const handleOutsideMenus = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('.fb-flow-graph__menu, .fb-flow-graph__context-menu')) return;
      setMenuState(null);
      setContextMenuState(null);
    };

    window.addEventListener('pointerdown', handleOutsideMenus, true);
    return () => {
      window.removeEventListener('pointerdown', handleOutsideMenus, true);
    };
  }, []);

  return (
    <div className="fb-overlay-modal" onMouseDown={closeFlowEditor}>
      <div className="fb-overlay-modal__card fb-flow-editor-modal fb-flow-editor-modal--graph" onMouseDown={(event) => event.stopPropagation()}>
        <div className="fb-overlay-modal__head fb-flow-editor-modal__head">
          <div className="fb-flow-editor-modal__head-copy">
            <div className="fb-flow-editor-modal__eyebrow">Interaction Flow</div>
            <div className="fb-flow-editor-modal__title">{activeFlow?.name || `${element?.name || 'Element'} interaction`}</div>
          </div>
          <IconButton icon={UIIcons.close} title="Close flow editor" className="fb-flow-editor-modal__close-btn" onClick={closeFlowEditor}>
            <span className="fb-flow-editor-modal__close-label">Close</span>
          </IconButton>
        </div>
        <div className="fb-overlay-modal__body fb-flow-editor-modal__body fb-flow-editor-modal__body--graph">
          <div
            ref={canvasWrapRef}
            className={`fb-flow-graph__viewport${isPanning ? ' is-panning' : ''}`}
            onMouseDown={() => {
              setMenuState(null);
              setContextMenuState(null);
            }}
            onPointerDown={(event) => {
              const target = event.target;
              if (!(target instanceof HTMLElement)) return;
              if (target.closest('button, input, select, textarea, .fb-flow-graph__node, .fb-flow-graph__menu, .fb-flow-graph__context-menu, .fb-flow-editor__inspector, .fb-flow-editor__sidebar')) return;
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
            <div className="fb-flow-graph__stage">
              <div className="fb-flow-graph__canvas" style={{ width: graph?.width || WORKSPACE_WIDTH, minWidth: graph?.width || WORKSPACE_WIDTH, minHeight: graph?.height || WORKSPACE_HEIGHT }}>
                <div className="fb-flow-graph__spine" aria-hidden="true" style={{ left: graph?.contentCenterX || WORKSPACE_CENTER_X }} />

                <svg className="fb-flow-graph__edges" aria-hidden="true">
                  {(graph?.guides ?? []).map((guide) => (
                    <path key={guide.key} d={guide.path} className="fb-flow-graph__guide" />
                  ))}
                  {(graph?.edges ?? []).map((edge) => (
                    <path key={edge.id} d={edge.path} />
                  ))}
                </svg>

                {(graph?.branchLabels ?? []).map((entry) => (
                  <span key={entry.key} className="fb-flow-graph__branch-label" style={{ left: entry.x, top: entry.y }}>
                    {entry.label}
                  </span>
                ))}

                {(graph?.nodes ?? []).map((node) => (
                  <FlowNodeCard
                    key={node.id}
                    node={node}
                    summary={getNodeSummary(node, variableLookup, variableSources)}
                    stepNumber={getActionStepNumber(graph, node.id)}
                    isSelected={selectedNode?.id === node.id}
                    isDragging={draggingNodeId === node.id}
                    onSelect={() => setSelectedNodeId(node.id)}
                    onDelete={handleDeleteNode}
                    onContextMenu={handleCardContextMenu}
                    onStartDrag={handleStartDragNode}
                  />
                ))}

                {(graph?.addButtons ?? []).map((button) => (
                  <button
                    key={button.key}
                    type="button"
                    className="fb-flow-graph__add-button"
                    style={{ left: button.x - 14, top: button.y - 14 }}
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
                  <div className="fb-flow-graph__menu" style={{ left: menuState.x + 22, top: menuState.y - 8 }} onMouseDown={(event) => event.stopPropagation()}>
                    <div className="fb-flow-graph__menu-head">Add {menuState.label} action</div>
                    <NodeTypeMenu flow={activeFlow} submittedFieldOptions={submittedFieldOptions} onAdd={handleAddNode} />
                  </div>
                ) : null}

                {contextMenuState ? (
                  <div
                    className="fb-flow-graph__context-menu"
                    style={{ left: contextMenuState.x + 8, top: contextMenuState.y - 8 }}
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="fb-flow-graph__context-menu-item is-danger"
                      onClick={() => handleDeleteNode(contextMenuState.nodeId)}
                    >
                      {UIIcons.trash}
                      <span>Delete</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <aside className="fb-flow-editor__inspector fb-flow-editor__inspector--graph">
            <div className="fb-flow-editor__inspector-head">
              <div>
                <div className="fb-flow-editor__sidebar-kicker">Setup</div>
                <strong>{selectedNode?.type === 'trigger' ? 'Flow Settings' : 'Node Settings'}</strong>
              </div>
            </div>
            <FlowInspector
              flow={activeFlow}
              selectedNode={selectedNode}
              onFlowChange={saveFlow}
              onNodeChange={(nextNode) => saveFlow(updateNode(activeFlow, nextNode.id, nextNode))}
              onDeleteNode={handleDeleteNode}
              pageVariables={pageVariables}
              globalVariables={globalVariables}
              loopItemVariables={loopItemVariables}
              variableSources={variableSources}
              elementName={element?.name || 'Selected element'}
              submittedFieldOptions={submittedFieldOptions}
              legacyFormConfig={legacyFormConfig}
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
