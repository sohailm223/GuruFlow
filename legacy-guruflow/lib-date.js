export function getRemainingDays(endDate) {
  if (!endDate) return null;

  const end = new Date(endDate);
  const today = new Date();

  const diff = Math.ceil(
    (end - today) / (1000 * 60 * 60 * 24)
  );

  return diff >= 0 ? diff : 0;
}
