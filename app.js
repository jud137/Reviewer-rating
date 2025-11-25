// app.js

// Utility: read a local JSON file from <input type="file">
function readJsonFile(input) {
  return new Promise((resolve, reject) => {
    const file = input.files[0];
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = e => {
      try { resolve(JSON.parse(e.target.result)); }
      catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// Normalize and index entities
function indexById(arr) {
  const map = {};
  (arr || []).forEach(x => { if (x.id) map[x.id] = x; });
  return map;
}

// Extract corner positions map
function getCornerPositions(data) {
  const corners = data?.corners || [];
  const map = {};
  corners.forEach(c => { map[c.id] = { x: c.x, y: c.y }; });
  return map;
}

// Build wall segments from corners’ wallStarts/wallEnds
function buildWallSegments(data) {
  const corners = data?.corners || [];
  const positions = getCornerPositions(data);
  const segments = [];
  corners.forEach(c => {
    const start = positions[c.id];
    (c.wallStarts || []).forEach(ws => {
      const end = positions[ws.id]; // note: in your JSON, wallStarts store wall objects; we use id if present
      if (!end && ws?.id && positions[ws.id]) {
        segments.push({ from: start, to: positions[ws.id], id: ws.id });
      } else if (end) {
        segments.push({ from: start, to: end, id: ws.id });
      }
    });
    (c.wallEnds || []).forEach(we => {
      const end = positions[we.id];
      if (!end && we?.id && positions[we.id]) {
        segments.push({ from: start, to: positions[we.id], id: we.id });
      } else if (end) {
        segments.push({ from: start, to: end, id: we.id });
      }
    });
  });

  // Fallback: draw walls as points only (if starts/ends aren’t directly resolvable)
  // Many walls may not have corner ids baked in; we’ll rely on rooms’ interiorCorners to render outlines too.
  const rooms = data?.rooms || [];
  rooms.forEach(r => {
    (r.interiorCorners || []).forEach((ic, idx) => {
      const next = r.interiorCorners[(idx + 1) % r.interiorCorners.length];
      if (next) segments.push({ from: { x: ic.x, y: ic.y }, to: { x: next.x, y: next.y }, id: `${r.roomName}:${idx}` });
    });
  });

  return segments;
}

// Render a set of segments and corners into a Plotly div
function renderPlot(divId, data, colors = { walls: 'white', corners: 'red' }) {
  const segments = buildWallSegments(data);
  const corners = data?.corners || [];

  const wallTraces = segments.map(seg => ({
    x: [seg.from.x, seg.to.x],
    y: [seg.from.y, seg.to.y],
    mode: 'lines',
    line: { color: colors.walls, width: 2 },
    type: 'scatter',
    hoverinfo: 'skip'
  }));

  const cornerTrace = {
    x: corners.map(c => c.x),
    y: corners.map(c => c.y),
    mode: 'markers',
    type: 'scatter',
    marker: { color: colors.corners, size: 6 },
    name: 'Corners'
  };

  const layout = {
    paper_bgcolor: '#111827',
    plot_bgcolor: '#111827',
    xaxis: { showgrid: false, zeroline: false, scaleanchor: 'y', color: '#e2e8f0' },
    yaxis: { showgrid: false, zeroline: false, color: '#e2e8f0' },
    margin: { l: 30, r: 30, t: 20, b: 30 },
    showlegend: false
  };

  Plotly.newPlot(divId, [...wallTraces, cornerTrace], layout, { displayModeBar: false });
}

// Simple geometric helpers
function distance(a, b) {
  if (!a || !b) return Infinity;
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx*dx + dy*dy);
}
function segmentLength(seg) {
  return distance(seg.from, seg.to);
}

// Compare entities
function diffLists(beforeList, afterList, key = 'id', eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)) {
  const bMap = indexById(beforeList || []);
  const aMap = indexById(afterList || []);
  const added = [], removed = [], changed = [];

  const allIds = new Set([...Object.keys(bMap), ...Object.keys(aMap)]);
  allIds.forEach(id => {
    const b = bMap[id], a = aMap[id];
    if (b && !a) removed.push(b);
    else if (!b && a) added.push(a);
    else if (b && a && !eq(b, a)) changed.push({ before: b, after: a });
  });
  return { added, removed, changed };
}

// Build segments keyed by endpoints (for approximate matching)
function keyedSegments(data) {
  const segs = buildWallSegments(data);
  return segs.map(s => ({
    key: `${Math.round(s.from.x)}:${Math.round(s.from.y)}-${Math.round(s.to.x)}:${Math.round(s.to.y)}`,
    seg: s
  }));
}

function diffSegments(beforeData, afterData) {
  const B = keyedSegments(beforeData);
  const A = keyedSegments(afterData);
  const bKeys = new Set(B.map(x => x.key));
  const aKeys = new Set(A.map(x => x.key));

  const added = A.filter(x => !bKeys.has(x.key)).map(x => x.seg);
  const removed = B.filter(x => !aKeys.has(x.key)).map(x => x.seg);

  // Changed: same endpoints but different length (rare if endpoints match); we skip unless needed
  const changed = [];
  return { added, removed, changed };
}

// Auto-correction score
function computeScore(beforeData, afterData) {
  // Metrics:
  // - Walls: added/removed counts and total length change
  // - Corners: avg movement
  // - Doors/windows: added/removed counts
  const segBefore = buildWallSegments(beforeData);
  const segAfter = buildWallSegments(afterData);
  const wallsDiff = diffSegments(beforeData, afterData);

  const totalLenBefore = segBefore.reduce((s, x) => s + segmentLength(x), 0);
  const totalLenAfter = segAfter.reduce((s, x) => s + segmentLength(x), 0);
  const lenChange = Math.abs(totalLenAfter - totalLenBefore);

  const cornersBefore = beforeData?.corners || [];
  const cornersAfter = afterData?.corners || [];
  const cMapB = indexById(cornersBefore);
  const cMapA = indexById(cornersAfter);
  const sharedCornerIds = Object.keys(cMapB).filter(id => cMapA[id]);
  const avgCornerMove = sharedCornerIds.length
    ? sharedCornerIds.reduce((s, id) => s + distance(cMapB[id], cMapA[id]), 0) / sharedCornerIds.length
    : 0;

  const doorsDiff = diffLists(beforeData?.doors || [], afterData?.doors || []);
  const windowsDiff = diffLists(beforeData?.windows || [], afterData?.windows || []);

  // Scoring heuristic (tune as needed):
  // Start from 100 and subtract penalties; clamp to [0, 100].
  let score = 100;

  // Penalize wall additions/removals
  score -= Math.min(40, (wallsDiff.added.length + wallsDiff.removed.length) * 4);

  // Penalize large geometry changes by total wall length delta
  score -= Math.min(25, lenChange / 100); // scale to your drawing units

  // Penalize corner movement
  score -= Math.min(20, avgCornerMove / 20);

  // Doors/windows adjustment (less severe)
  score -= Math.min(10, (doorsDiff.added.length + doorsDiff.removed.length) * 1.5);
  score -= Math.min(5, (windowsDiff.added.length + windowsDiff.removed.length) * 1.0);

  score = Math.max(0, Math.min(100, score));

  const summary = `Walls +${wallsDiff.added.length}/-${wallsDiff.removed.length}, len Δ=${lenChange.toFixed(1)}; `
                + `Corners avg move=${avgCornerMove.toFixed(1)}; `
                + `Doors +${doorsDiff.added.length}/-${doorsDiff.removed.length}, `
                + `Windows +${windowsDiff.added.length}/-${windowsDiff.removed.length}`;

  return { score, summary, wallsDiff, doorsDiff, windowsDiff };
}

// Populate differences lists
function renderDiffLists(diff, containerIds) {
  const { wallsDiff, doorsDiff, windowsDiff } = diff;

  function setList(id, items, type) {
    const ul = document.getElementById(id);
    ul.innerHTML = '';
    items.added.forEach(x => {
      const li = document.createElement('li'); li.className = 'added';
      li.textContent = `+ ${type} ${x.id || ''}`;
      ul.appendChild(li);
    });
    items.removed.forEach(x => {
      const li = document.createElement('li'); li.className = 'removed';
      li.textContent = `- ${type} ${x.id || ''}`;
      ul.appendChild(li);
    });
    items.changed?.forEach(x => {
      const li = document.createElement('li'); li.className = 'changed';
      li.textContent = `~ ${type} ${x.before.id || ''}`;
      ul.appendChild(li);
    });
  }

  // Walls: we only have added/removed segments (no IDs); show counts and sample endpoints
  const ulWalls = document.getElementById(containerIds.walls);
  ulWalls.innerHTML = '';
  wallsDiff.added.slice(0, 50).forEach(s => {
    const li = document.createElement('li'); li.className = 'added';
    li.textContent = `+ wall (${Math.round(s.from.x)},${Math.round(s.from.y)})→(${Math.round(s.to.x)},${Math.round(s.to.y)})`;
    ulWalls.appendChild(li);
  });
  wallsDiff.removed.slice(0, 50).forEach(s => {
    const li = document.createElement('li'); li.className = 'removed';
    li.textContent = `- wall (${Math.round(s.from.x)},${Math.round(s.from.y)})→(${Math.round(s.to.x)},${Math.round(s.to.y)})`;
    ulWalls.appendChild(li);
  });

  setList(containerIds.doors, doorsDiff, 'door');
  setList(containerIds.windows, windowsDiff, 'window');

  // Corners: show moved corners exceeding a threshold
  const ulCorners = document.getElementById(containerIds.corners);
  ulCorners.innerHTML = '';
  // A corner is “changed” if same id exists and position differs > epsilon
  // We’ll compute later from the two datasets
}

// Build diff overlay plot
function renderDiffOverlay(divId, beforeData, afterData) {
  const segB = buildWallSegments(beforeData);
  const segA = buildWallSegments(afterData);

  const traceBefore = segB.map(s => ({
    x: [s.from.x, s.to.x], y: [s.from.y, s.to.y],
    mode: 'lines', type: 'scatter', line: { color: '#ef4444', width: 2 }, hoverinfo: 'skip', name: 'Before'
  }));
  const traceAfter = segA.map(s => ({
    x: [s.from.x, s.to.x], y: [s.from.y, s.to.y],
    mode: 'lines', type: 'scatter', line: { color: '#22c55e', width: 2 }, hoverinfo: 'skip', name: 'After'
  }));

  const layout = {
    paper_bgcolor: '#111827', plot_bgcolor: '#111827',
    xaxis: { scaleanchor: 'y', color: '#e2e8f0' }, yaxis: { color: '#e2e8f0' },
    margin: { l: 30, r: 30, t: 20, b: 30 },
    showlegend: true, legend: { bgcolor: '#111827', font: { color: '#e2e8f0' } }
  };
  Plotly.newPlot(divId, [...traceBefore, ...traceAfter], layout, { displayModeBar: false });
}

// On-page wiring
document.getElementById('renderBtn').addEventListener('click', async () => {
  const beforeInput = document.getElementById('beforeFile');
  const afterInput = document.getElementById('afterFile');

  const beforeData = await readJsonFile(beforeInput);
  const afterData  = await readJsonFile(afterInput);

  if (!beforeData || !afterData) {
    alert('Please select both JSON files.');
    return;
  }

  // Render individual views and overlay
  renderPlot('plotBefore', beforeData, { walls: '#93c5fd', corners: '#fde68a' });
  renderPlot('plotAfter', afterData, { walls: '#34d399', corners: '#fca5a5' });
  renderDiffOverlay('plotDiff', beforeData, afterData);

  // Compute rating + diffs
  const { score, summary, wallsDiff, doorsDiff, windowsDiff } = computeScore(beforeData, afterData);
  document.getElementById('scoreValue').textContent = `${score.toFixed(1)} / 100`;
  document.getElementById('scoreSummary').textContent = summary;

  renderDiffLists(
    { wallsDiff, doorsDiff, windowsDiff },
    { walls: 'diffWalls', corners: 'diffCorners', doors: 'diffDoors', windows: 'diffWindows' }
  );

  // Corners moved list
  const cB = indexById(beforeData.corners || []);
  const cA = indexById(afterData.corners || []);
  const ulCorners = document.getElementById('diffCorners');
  const ids = new Set([...Object.keys(cB), ...Object.keys(cA)]);
  ulCorners.innerHTML = '';
  ids.forEach(id => {
    const b = cB[id], a = cA[id];
    if (b && a) {
      const d = distance(b, a);
      if (d > 1e-3) {
        const li = document.createElement('li'); li.className = 'changed';
        li.textContent = `~ corner ${id} moved ${d.toFixed(1)} units`;
        ulCorners.appendChild(li);
      }
    } else if (a && !b) {
      const li = document.createElement('li'); li.className = 'added';
      li.textContent = `+ corner ${id} added`;
      ulCorners.appendChild(li);
    } else if (b && !a) {
      const li = document.createElement('li'); li.className = 'removed';
      li.textContent = `- corner ${id} removed`;
      ulCorners.appendChild(li);
    }
  });
});

document.getElementById('resetBtn').addEventListener('click', () => {
  document.getElementById('beforeFile').value = '';
  document.getElementById('afterFile').value = '';
  document.getElementById('scoreValue').textContent = '—';
  document.getElementById('scoreSummary').textContent = '—';
  ['plotBefore', 'plotAfter', 'plotDiff'].forEach(id => Plotly.purge(id));
  ['diffWalls', 'diffCorners', 'diffDoors', 'diffWindows'].forEach(id => document.getElementById(id).innerHTML = '');
});
