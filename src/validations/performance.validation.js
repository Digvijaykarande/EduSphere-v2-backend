import { z } from "zod";

export const MAX_ABS_POINTS = 1000;

const oid = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const decimalsOk = (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

const pointsField = z.coerce
  .number({ invalid_type_error: "Enter the points value" })
  .refine((n) => Number.isFinite(n), "Enter the points value")
  .refine(decimalsOk, "Use at most 2 decimal places")
  .refine((n) => n !== 0, "Points can't be zero")
  .refine((n) => Math.abs(n) <= MAX_ABS_POINTS, `Points must be between -${MAX_ABS_POINTS} and ${MAX_ABS_POINTS}`);

const labelField = z
  .string()
  .trim()
  .min(2, "Enter a category name (at least 2 characters)")
  .max(40, "Category name is too long (max 40 characters)");

export const categorySchema = z.object({
  label: labelField,
  points: pointsField,
  purpose: z.string().trim().max(120).optional().default(""),
});

export const categoryPatchSchema = categorySchema.partial().refine((d) => Object.keys(d).length > 0, {
  message: "Nothing to update",
});

export const settingsSchema = z
  .object({
    marksEnabled: z.boolean(),
    totalMarks: z.coerce.number().positive().max(1000).nullable().optional(),
    pointsForFull: z.coerce.number().positive().max(MAX_ABS_POINTS * 100).nullable().optional(),
  })
  .superRefine((d, ctx) => {
    if (!d.marksEnabled) return;
    if (!d.totalMarks) ctx.addIssue({ code: "custom", path: ["totalMarks"], message: "Enter the total marks (greater than 0)" });
    else if (!decimalsOk(d.totalMarks)) ctx.addIssue({ code: "custom", path: ["totalMarks"], message: "Total marks must have at most 2 decimals" });
    if (!d.pointsForFull) ctx.addIssue({ code: "custom", path: ["pointsForFull"], message: "Enter the points needed for full marks (greater than 0)" });
    else if (!decimalsOk(d.pointsForFull)) ctx.addIssue({ code: "custom", path: ["pointsForFull"], message: "Points for full marks must have at most 2 decimals" });
  });

export const awardSchema = z
  .object({
    sectionId: oid,
    studentIds: z.array(oid).min(1, "Select at least one student").max(200),
    categoryId: oid.nullable().optional(),
    label: labelField.optional(),
    points: pointsField.optional(),
    saveAsCategory: z.boolean().optional().default(false),
  })
  .superRefine((d, ctx) => {
    if (!d.categoryId && (d.label === undefined || d.points === undefined)) {
      ctx.addIssue({ code: "custom", path: ["label"], message: "Pick a category or enter a reason and points" });
    }
  });

const dateField = z.coerce.date();

// Client sends local-time period boundaries (the server never guesses a timezone).
export const rangeQuerySchema = z
  .object({
    from: dateField,
    to: dateField,
    prevFrom: dateField.optional(),
    prevTo: dateField.optional(),
    teacherId: oid.optional(),
  })
  .refine((d) => d.to > d.from, { message: "'to' must be after 'from'", path: ["to"] })
  .refine((d) => d.to - d.from <= 400 * 86400000, { message: "Range too large", path: ["to"] });

export const summaryQuerySchema = z
  .object({
    todayFrom: dateField,
    todayTo: dateField,
    weekFrom: dateField,
    weekTo: dateField,
  })
  .refine((d) => d.todayTo > d.todayFrom && d.weekTo > d.weekFrom, { message: "Invalid range" });

export const historyQuerySchema = z.object({
  from: dateField.optional(),
  search: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export const exportSchema = z
  .object({
    examId: z.string().trim().min(1),
    from: dateField,
    to: dateField,
    overwrite: z.boolean().optional().default(false),
    dryRun: z.boolean().optional().default(false),
  })
  .refine((d) => d.to > d.from, { message: "'to' must be after 'from'", path: ["to"] });

export const snapshotQuerySchema = z
  .object({ from: dateField, to: dateField })
  .refine((d) => d.to > d.from, { message: "Invalid range" });

export const idParamSchema = oid;
