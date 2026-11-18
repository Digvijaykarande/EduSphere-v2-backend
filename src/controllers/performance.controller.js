import { ApiResponse } from "../utils/apiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  categorySchema,
  categoryPatchSchema,
  settingsSchema,
  awardSchema,
  rangeQuerySchema,
  summaryQuerySchema,
  historyQuerySchema,
  exportSchema,
  snapshotQuerySchema,
  idParamSchema,
} from "../validations/performance.validation.js";
import * as svc from "../services/performance.service.js";

const school = (req) => req.user.schoolId;
const uid = (req) => req.user._id;
const param = (req, key = "id") => idParamSchema.parse(req.params[key]);

// ---- Teacher ----
export const getSetupHandler = asyncHandler(async (req, res) =>
  ApiResponse.success(res, "Setup retrieved", await svc.getSetup(school(req), uid(req)))
);

export const createCategoryHandler = asyncHandler(async (req, res) => {
  const category = await svc.createCategory(school(req), uid(req), categorySchema.parse(req.body));
  return ApiResponse.success(res, "Category created", { category }, 201);
});

export const updateCategoryHandler = asyncHandler(async (req, res) => {
  const category = await svc.updateCategory(school(req), uid(req), param(req), categoryPatchSchema.parse(req.body));
  return ApiResponse.success(res, "Category updated", { category });
});

export const deleteCategoryHandler = asyncHandler(async (req, res) =>
  ApiResponse.success(res, "Category deleted", await svc.deleteCategory(school(req), uid(req), param(req)))
);

export const saveSettingsHandler = asyncHandler(async (req, res) => {
  const settings = await svc.saveSettings(school(req), uid(req), settingsSchema.parse(req.body));
  return ApiResponse.success(res, "Settings saved", { settings });
});

export const getSummaryHandler = asyncHandler(async (req, res) =>
  ApiResponse.success(
    res,
    "Summary retrieved",
    await svc.getSectionSummary(school(req), uid(req), param(req, "sectionId"), summaryQuerySchema.parse(req.query))
  )
);

export const awardHandler = asyncHandler(async (req, res) =>
  ApiResponse.success(res, "Points awarded", await svc.awardPoints(school(req), uid(req), awardSchema.parse(req.body)), 201)
);

export const getTeacherLeaderboardHandler = asyncHandler(async (req, res) =>
  ApiResponse.success(
    res,
    "Leaderboard retrieved",
    await svc.getTeacherLeaderboard(school(req), uid(req), param(req, "sectionId"), rangeQuerySchema.parse(req.query))
  )
);

export const getTeacherHistoryHandler = asyncHandler(async (req, res) =>
  ApiResponse.success(
    res,
    "History retrieved",
    await svc.getTeacherHistory(school(req), uid(req), param(req, "sectionId"), historyQuerySchema.parse(req.query))
  )
);

export const deleteEventHandler = asyncHandler(async (req, res) =>
  ApiResponse.success(res, "Entry removed", { event: await svc.deleteEvent(school(req), uid(req), param(req)) })
);

export const restoreEventHandler = asyncHandler(async (req, res) =>
  ApiResponse.success(res, "Entry restored", { event: await svc.restoreEvent(school(req), uid(req), param(req)) })
);

export const undoBatchHandler = asyncHandler(async (req, res) => {
  const batchId = String(req.params.batchId || "");
  if (!/^[a-f\d-]{36}$/i.test(batchId)) return ApiResponse.error(res, "Invalid batch id", 400);
  return ApiResponse.success(res, "Award undone", await svc.undoBatch(school(req), uid(req), batchId));
});

export const listExportExamsHandler = asyncHandler(async (req, res) =>
  ApiResponse.success(res, "Exams retrieved", await svc.listExportableExams(school(req), uid(req), param(req, "sectionId")))
);

export const exportToExamHandler = asyncHandler(async (req, res) => {
  const result = await svc.exportToExam(school(req), uid(req), param(req, "sectionId"), exportSchema.parse(req.body));
  return ApiResponse.success(res, result.dryRun ? "Export preview" : "Marks exported to gradebook", result);
});

export const getTeacherSnapshotHandler = asyncHandler(async (req, res) =>
  ApiResponse.success(res, "Snapshot retrieved", await svc.getTeacherSnapshot(school(req), uid(req), snapshotQuerySchema.parse(req.query)))
);

// ---- Student ----
export const getStudentOverviewHandler = asyncHandler(async (req, res) =>
  ApiResponse.success(res, "Overview retrieved", await svc.getStudentOverview(school(req), uid(req), rangeQuerySchema.parse(req.query)))
);

export const getStudentHistoryHandler = asyncHandler(async (req, res) =>
  ApiResponse.success(res, "History retrieved", await svc.getStudentHistory(school(req), uid(req), historyQuerySchema.parse(req.query)))
);
