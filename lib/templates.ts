export type BoardTemplate = {
  id: "blank" | "personal-week" | "project-sprint" | "content-calendar";
  name: string;
  description: string;
  columns: { name: string; isDone?: boolean; wipLimit?: number | null }[];
  sampleTasks?: { title: string; column: number; priority?: string; estimateMinutes?: number; offsetDays?: number }[];
};

export const BOARD_TEMPLATES: BoardTemplate[] = [
  { id: "blank", name: "Blank board", description: "Start with three calm columns.", columns: [{ name: "To do" }, { name: "In progress" }, { name: "Done", isDone: true }] },
  {
    id: "personal-week",
    name: "Personal week",
    description: "A gentle weekly rhythm for life admin and side projects.",
    columns: [
      { name: "This week", wipLimit: 7 },
      { name: "Today", wipLimit: 3 },
      { name: "Waiting" },
      { name: "Done", isDone: true },
    ],
  },
  {
    id: "project-sprint",
    name: "Project sprint",
    description: "Shape, build, review, ship.",
    columns: [
      { name: "Backlog" },
      { name: "Next up", wipLimit: 5 },
      { name: "In progress", wipLimit: 3 },
      { name: "Review", wipLimit: 4 },
      { name: "Done", isDone: true },
    ],
  },
  {
    id: "content-calendar",
    name: "Content calendar",
    description: "Move an idea from spark to published.",
    columns: [
      { name: "Ideas" },
      { name: "Drafting" },
      { name: "Review" },
      { name: "Scheduled" },
      { name: "Published", isDone: true },
    ],
  },
];

export function findTemplate(id: string): BoardTemplate {
  return BOARD_TEMPLATES.find((template) => template.id === id) ?? BOARD_TEMPLATES[0]!;
}
