# scorer.py
import json, math, sys

def distance(a, b):
    return math.hypot(a['x'] - b['x'], a['y'] - b['y'])

def segment_length(seg):
    return distance(seg['from'], seg['to'])

def build_wall_segments(data):
    rooms = data.get('rooms', [])
    segs = []
    # Use interiorCorners for reliable outlines
    for r in rooms:
        ics = r.get('interiorCorners', [])
        for i in range(len(ics)):
            a = ics[i]; b = ics[(i+1) % len(ics)]
            segs.append({'from': {'x': a['x'], 'y': a['y']}, 'to': {'x': b['x'], 'y': b['y']}})
    return segs

def index_by_id(arr):
    return {x['id']: x for x in arr} if arr else {}

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

    summary = {
        'lenChange': round(lenChange, 2),
        'avgCornerMove': round(avgCornerMove, 2),
        'doorsAdded': doorsAdded, 'doorsRemoved': doorsRemoved,
        'windowsAdded': windowsAdded, 'windowsRemoved': windowsRemoved,
        'score': round(score, 1)
    }
    return summary

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python scorer.py before.json after.json")
        sys.exit(1)
    with open(sys.argv[1], 'r') as f: before = json.load(f)
    with open(sys.argv[2], 'r') as f: after = json.load(f)
    result = compute_score(before, after)
    print(json.dumps(result, indent=2))
