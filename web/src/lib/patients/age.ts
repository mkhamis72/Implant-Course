export function ageOn(dob: string | null, today: Date): number | null {
  const match = dob?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  let age = today.getFullYear() - year;
  const month0 = today.getMonth() + 1;
  if (month0 < month || (month0 === month && today.getDate() < day)) age -= 1;
  return age;
}
