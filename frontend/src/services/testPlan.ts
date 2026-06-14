
export async function createTestPlan(payload: {
  fullName: string;
  workEmail: string;
  companyName: string;
  testingGoal: string;
  usageLevel?: string;
  pageUrl?: string;
}) {
  const res = await fetch(`/api/test-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to submit test plan.");
  return data as { ok: true; id: string };
}
