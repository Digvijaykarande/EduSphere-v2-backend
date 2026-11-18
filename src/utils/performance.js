export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Points -> marks using a teacher's conversion settings. Null when the
// teacher hasn't enabled/configured marks. Clamped to [0, totalMarks].
export function pointsToMarks(points, settings) {
  if (!settings?.marksEnabled || !settings.totalMarks || !settings.pointsForFull) return null;
  const raw = (points / settings.pointsForFull) * settings.totalMarks;
  return r2(Math.min(Math.max(raw, 0), settings.totalMarks));
}

// Natural ordering for roll numbers ("2" before "10").
export const byRoll = (a, b) =>
  String(a.rollNumber ?? a.roll ?? "").localeCompare(String(b.rollNumber ?? b.roll ?? ""), undefined, { numeric: true });

// Competition ranking: equal points share a rank (1, 1, 3).
export function assignRanks(rows) {
  rows.sort((a, b) => b.points - a.points || b.count - a.count || byRoll(a, b));
  let lastPoints = null;
  let lastRank = 0;
  rows.forEach((row, i) => {
    if (row.points !== lastPoints) {
      lastRank = i + 1;
      lastPoints = row.points;
    }
    row.rank = lastRank;
  });
  return rows;
}

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
