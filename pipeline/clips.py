"""The clip list (id, title, file, words with syllable counts), read from Firestore's clips
collection, which the admin page edits. Clips are publicly readable, so no credentials are needed.

clips.json is only where new clips are staged (pipeline/line_clips.py writes it); the admin page's
import copies the ones Firestore doesn't have yet.
"""

import json
import urllib.parse
import urllib.request

URL = "https://firestore.googleapis.com/v1/projects/click-alignment/databases/(default)/documents/clips"


def _value(v):
    """A Firestore REST value -> plain Python."""
    if "mapValue" in v:
        return {k: _value(x) for k, x in v["mapValue"].get("fields", {}).items()}
    if "arrayValue" in v:
        return [_value(x) for x in v["arrayValue"].get("values", [])]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "nullValue" in v:
        return None
    (x,) = v.values()  # stringValue, doubleValue, booleanValue
    return x


def load_clips():
    """Every clip not excluded from analysis, in the app's order."""
    clips, token = [], None
    while True:
        query = {"pageSize": 300, **({"pageToken": token} if token else {})}
        with urllib.request.urlopen(f"{URL}?{urllib.parse.urlencode(query)}") as res:
            page = json.load(res)
        clips += [_value({"mapValue": d}) for d in page.get("documents", [])]
        token = page.get("nextPageToken")
        if not token:
            return sorted((c for c in clips if not c.get("excludeFromAnalysis")), key=lambda c: c["order"])
