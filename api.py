# api.py
from flask import Flask, request, jsonify
import json, math

app = Flask(__name__)

def distance(a, b): return math.hypot(a['x'] - b['x'], a['y'] - b['y'])
def segment_length(seg): return distance(seg['from'], seg['to'])

def build_wall_segments(data):
    segs = []
    for r in data.get('rooms', []):
        ics = r.get('interiorCorners', [])
        for i in range(len(ics)):
            a = ics[i]; b = ics[(i+1) % len(ics)]
            segs.append({'from': {'x': a['x'], 'y': a['y']}, 'to': {'x': b['x'], 'y': b['y']}})
    return segs

def index_by_id(arr): return {x['id']: x for x in arr} if arr else {}

def compute_score(before, after):
    segB = build_wall_segments(before)
    segA = build_wall_segments(after)
    lenB = sum(segment_length(s) for s in segB)
    lenA = sum(segment_length(s) for s in segA)
    lenChange = abs(lenA - lenB)

    cB = index_by_id(before.get('corners', []))
    cA = index_by_id(after.get('corners', []))
    shared = [cid for cid in cB if cid in cA]
    avgCornerMove = sum(distance(cB[cid], cA[cid]) for cid in shared) / (len(shared) or 1)

    doorsB = before.get('doors', []); doorsA = after.get('doors', [])
    windowsB = before.get('windows', []); windowsA = after.get('windows', [])
    ids = lambda xs: set(x.get('id') for x in xs if x.get('id'))
    doorsAdded = len(ids(doorsA) - ids(doorsB))
    doorsRemoved = len(ids(doorsB) - ids(doorsA))
    windowsAdded = len(ids(windowsA) - ids(windowsB))
    windowsRemoved = len(ids(windowsB) - ids(windowsA))

    score = 100
    score -= min(25, lenChange / 100)
    score -= min(20, avgCornerMove / 20)
    score -= min(10, (doorsAdded + doorsRemoved) * 1.5)
    score -= min(5, (windowsAdded + windowsRemoved) * 1.0)
    score = max(0, min(100, score))

    return {
        'lenChange': round(lenChange, 2),
        'avgCornerMove': round(avgCornerMove, 2),
        'doorsAdded': doorsAdded, 'doorsRemoved': doorsRemoved,
        'windowsAdded': windowsAdded, 'windowsRemoved': windowsRemoved,
        'score': round(score, 1)
    }

@app.route('/score', methods=['POST'])
def score():
    payload = request.get_json(force=True)
    before = payload.get('before')
    after = payload.get('after')
    if not before or not after:
        return jsonify({'error': 'Provide JSON with keys: before, after'}), 400
    return jsonify(compute_score(before, after))

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5050, debug=True)
