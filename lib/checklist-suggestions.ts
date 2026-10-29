/**
 * Small, deterministic checklist suggestions. They are intentionally local and
 * advisory: the Task drawer never applies one without an explicit click.
 */
const TEMPLATES: Array<{ pattern: RegExp; items: string[] }> = [
  { pattern: /\b(write|draft|copy|post|announce)\b/i, items: ["Outline the key points", "Write the first draft", "Edit for clarity", "Proofread the final copy"] },
  { pattern: /\b(launch|release|ship|deploy)\b/i, items: ["Confirm the release checklist", "Prepare the rollout note", "Verify the production smoke test", "Schedule the follow-up"] },
  { pattern: /\b(review|audit|check)\b/i, items: ["Define the review criteria", "Collect the source material", "Record findings", "Assign follow-ups"] },
  { pattern: /\b(plan|strategy|retro|meeting)\b/i, items: ["Clarify the desired outcome", "List the decisions needed", "Prepare the agenda", "Capture next actions"] },
  { pattern: /\b(design|mockup|wireframe|visual)\b/i, items: ["Collect references", "Sketch the primary flow", "Build the first pass", "Review responsive states"] },
  { pattern: /\b(record|video|demo|podcast)\b/i, items: ["Write the run sheet", "Prepare the recording setup", "Record the segment", "Review the final cut"] },
  { pattern: /\b(test|qa|verify|bug)\b/i, items: ["List the critical paths", "Run the happy path", "Test edge cases", "Log and verify fixes"] },
  { pattern: /\b(book|reserve|buy|order|schedule)\b/i, items: ["Confirm the details", "Compare the options", "Make the booking", "Add a reminder"] },
];

export function suggestChecklistItems(title: string, description: string, existing: string[] = []): string[] {
  const text = `${title} ${description}`;
  const already = new Set(existing.map((item) => item.trim().toLowerCase()));
  const suggestions = TEMPLATES
    .filter((template) => template.pattern.test(text))
    .flatMap((template) => template.items)
    .filter((item) => !already.has(item.toLowerCase()));
  return [...new Set(suggestions)].slice(0, 4);
}
