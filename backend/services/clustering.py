"""
RESOLVIT - AI Clustering Service

Clusters nearby issues that report the same problem:
1. Check if a new issue is within 100m of existing issues
2. Compute Jaccard similarity of titles
3. If similarity > threshold → merge into a cluster
4. Update impact_scale and recalculate priority
"""
import math
from typing import Optional
from database import get_db


# ── Configuration ─────────────────────────────────────────────
CLUSTER_RADIUS_METERS    = 100   # meters
SIMILARITY_THRESHOLD     = 0.25  # Jaccard similarity threshold


def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute great-circle distance in meters between two (lat, lon) points."""
    R = 6371000  # Earth radius in meters
    phi1, phi2  = math.radians(lat1), math.radians(lat2)
    dphi        = math.radians(lat2 - lat1)
    dlambda     = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _jaccard_similarity(text1: str, text2: str) -> float:
    """Compute Jaccard similarity between two strings (word bag-of-words)."""
    s1 = set(text1.lower().split())
    s2 = set(text2.lower().split())
    if not s1 or not s2:
        return 0.0
    return len(s1 & s2) / len(s1 | s2)


def find_nearby_similar_issues(
    issue_id: str,
    title: str,
    category: str,
    latitude: Optional[float],
    longitude: Optional[float]
) -> Optional[dict]:
    """
    Finds the best matching existing issue to cluster this one with.
    Returns the matching issue row or None.
    """
    if latitude is None or longitude is None:
        return None

    with get_db() as cursor:
        # Get same-category, unresolved issues within a bounding box (roughly 0.001 deg ≈ 111m)
        bbox_delta = 0.001
        cursor.execute(
            """
            SELECT id, title, cluster_id, impact_scale, priority_score, latitude, longitude
            FROM issues
            WHERE id != %s
              AND category = %s
              AND status != 'resolved'
              AND latitude  BETWEEN %s AND %s
              AND longitude BETWEEN %s AND %s
            """,
            (
                issue_id, category,
                latitude  - bbox_delta, latitude  + bbox_delta,
                longitude - bbox_delta, longitude + bbox_delta
            )
        )
        candidates = cursor.fetchall()

    best_match = None
    best_score = 0.0

    for candidate in candidates:
        # Precise haversine distance check
        dist = _haversine_distance(
            latitude, longitude,
            candidate["latitude"], candidate["longitude"]
        )
        if dist > CLUSTER_RADIUS_METERS:
            continue

        # NLP similarity check
        sim = _jaccard_similarity(title, candidate["title"])
        combined = (sim * 0.7) + (1 - dist / CLUSTER_RADIUS_METERS) * 0.3

        if sim >= SIMILARITY_THRESHOLD and combined > best_score:
            best_score = combined
            best_match = dict(candidate)

    return best_match


def cluster_issue(new_issue_id: str, matching_issue: dict):
    """
    Merge new_issue into the cluster of matching_issue.
    Creates a new cluster if none exists.
    """
    with get_db() as cursor:
        existing_cluster_id = matching_issue.get("cluster_id")

        if existing_cluster_id:
            # Add to existing cluster
            cursor.execute(
                """
                UPDATE issue_clusters
                SET total_count = total_count + 1,
                    total_impact = total_impact + (
                        SELECT impact_scale FROM issues WHERE id = %s
                    ),
                    updated_at = NOW()
                WHERE id = %s
                """,
                (new_issue_id, existing_cluster_id)
            )
            cluster_id = existing_cluster_id
        else:
            # Create new cluster
            cursor.execute(
                """
                INSERT INTO issue_clusters
                    (representative_issue_id, total_count, total_impact,
                     centroid_lat, centroid_lon, cluster_radius)
                VALUES (%s, 2,
                    (SELECT impact_scale FROM issues WHERE id = %s) +
                    (SELECT impact_scale FROM issues WHERE id = %s),
                    %s, %s, %s)
                RETURNING id
                """,
                (
                    matching_issue["id"],
                    matching_issue["id"], new_issue_id,
                    matching_issue["latitude"],
                    matching_issue["longitude"],
                    CLUSTER_RADIUS_METERS
                )
            )
            cluster_id = str(cursor.fetchone()["id"])

            # Tag the original issue as clustered
            cursor.execute(
                "UPDATE issues SET cluster_id = %s, status = 'clustered' WHERE id = %s",
                (cluster_id, str(matching_issue["id"]))
            )

        # Tag new issue as clustered
        cursor.execute(
            "UPDATE issues SET cluster_id = %s, status = 'clustered' WHERE id = %s",
            (cluster_id, new_issue_id)
        )

        # Bump impact_scale on representative issue
        cursor.execute(
            """
            UPDATE issues
            SET impact_scale = impact_scale + (SELECT impact_scale FROM issues WHERE id = %s),
                updated_at = NOW()
            WHERE id = %s
            """,
            (new_issue_id, str(matching_issue["id"]))
        )

    return cluster_id


def attempt_clustering(issue_id: str, title: str, category: str,
                       latitude: float, longitude: float) -> Optional[str]:
    """
    Full clustering pipeline: find match → merge → return cluster_id or None.
    """
    match = find_nearby_similar_issues(issue_id, title, category, latitude, longitude)
    if match:
        cluster_id = cluster_issue(issue_id, match)
        print(f"[Clustering] Issue {issue_id} merged into cluster {cluster_id}")
        return cluster_id
    return None
