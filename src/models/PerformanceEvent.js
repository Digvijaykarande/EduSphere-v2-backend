import mongoose from "mongoose";

// One award/deduction for one student. label + points are snapshots, so
// editing or deleting a category never rewrites history. Deletes are soft
// (deletedAt) so "Undo" can restore an entry and there is an audit trail.
const performanceEventSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true },
    sectionId: { type: mongoose.Schema.Types.ObjectId, ref: "Section", required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "PerformanceCategory", default: null },
    label: { type: String, required: true, trim: true, maxlength: 40 },
    points: { type: Number, required: true },
    // Snapshots so history search needs no join.
    studentName: { type: String, default: "" },
    rollNumber: { type: String, default: "" },
    // Entries created by one multi-student award share a batchId (bulk undo).
    batchId: { type: String, required: true, index: true },
    awardedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

performanceEventSchema.index({ sectionId: 1, deletedAt: 1, createdAt: -1 });
performanceEventSchema.index({ teacherId: 1, sectionId: 1, deletedAt: 1, createdAt: -1 });
performanceEventSchema.index({ studentId: 1, deletedAt: 1, createdAt: -1 });

export default mongoose.models.PerformanceEvent ||
  mongoose.model("PerformanceEvent", performanceEventSchema);
