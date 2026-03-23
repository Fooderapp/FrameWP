function toFiniteRotation(value) {
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

export function getElementRotationState(source = {}) {
  return {
    rotation: toFiniteRotation(source.rotation),
    rotationX: toFiniteRotation(source.rotationX),
    rotationY: toFiniteRotation(source.rotationY),
  };
}

export function hasElement3DRotation(source = {}) {
  const { rotationX, rotationY } = getElementRotationState(source);
  return Math.abs(rotationX) > 0.01 || Math.abs(rotationY) > 0.01;
}

export function hasAnyElementRotation(source = {}) {
  const { rotation, rotationX, rotationY } = getElementRotationState(source);
  return Math.abs(rotation) > 0.01 || Math.abs(rotationX) > 0.01 || Math.abs(rotationY) > 0.01;
}

export function buildElementRotationTransform(source = {}, options = {}) {
  const { includePerspective = true, perspective = 1000 } = options;
  const { rotation, rotationX, rotationY } = getElementRotationState(source);
  const transforms = [];
  const has3D = Math.abs(rotationX) > 0.01 || Math.abs(rotationY) > 0.01;

  if (has3D && includePerspective) transforms.push(`perspective(${perspective}px)`);
  if (Math.abs(rotationX) > 0.01) transforms.push(`rotateX(${rotationX}deg)`);
  if (Math.abs(rotationY) > 0.01) transforms.push(`rotateY(${rotationY}deg)`);
  if (Math.abs(rotation) > 0.01) transforms.push(`${has3D ? 'rotateZ' : 'rotate'}(${rotation}deg)`);

  return transforms.join(' ');
}