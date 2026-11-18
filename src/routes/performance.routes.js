import { Router } from "express";
import { protect } from "../middleware/auth.middleware.js";
import { authorizeRoles as authorize } from "../middleware/role.middleware.js";
import * as c from "../controllers/performance.controller.js";

const router = Router();
router.use(protect);

// Student (own section only; enforced in the service via the student's own profile)
router.get("/student/overview", authorize("STUDENT"), c.getStudentOverviewHandler);
router.get("/student/history", authorize("STUDENT"), c.getStudentHistoryHandler);

// Teacher (every query is scoped to the caller's own Teacher profile + assignments)
const teacher = Router();
teacher.use(authorize("TEACHER"));
teacher.get("/setup", c.getSetupHandler);
teacher.post("/categories", c.createCategoryHandler);
teacher.patch("/categories/:id", c.updateCategoryHandler);
teacher.delete("/categories/:id", c.deleteCategoryHandler);
teacher.put("/settings", c.saveSettingsHandler);
teacher.get("/snapshot", c.getTeacherSnapshotHandler);
teacher.post("/awards", c.awardHandler);
teacher.post("/batches/:batchId/undo", c.undoBatchHandler);
teacher.delete("/events/:id", c.deleteEventHandler);
teacher.post("/events/:id/restore", c.restoreEventHandler);
teacher.get("/sections/:sectionId/summary", c.getSummaryHandler);
teacher.get("/sections/:sectionId/leaderboard", c.getTeacherLeaderboardHandler);
teacher.get("/sections/:sectionId/history", c.getTeacherHistoryHandler);
teacher.get("/sections/:sectionId/exams", c.listExportExamsHandler);
teacher.post("/sections/:sectionId/export-to-exam", c.exportToExamHandler);
router.use("/teacher", teacher);

export default router;
