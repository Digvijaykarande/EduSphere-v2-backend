import mongoose from "mongoose";

// A teacher-defined reward/deduction ("Correct answer" +10). Owned by one
// teacher; never shared across teachers (setup is per-teacher by design).
const performanceCategorySchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    label: { type: String, required: true, trim: true, minlength: 2, maxlength: 40 },
    // Lower-cased label — backs the per-teacher uniqueness rule.
    labelKey: { type: String, required: true },
    points: { type: Number, required: true },
    purpose: { type: String, default: "", trim: true, maxlength: 120 },
  },
  { timestamps: true }
);

performanceCategorySchema.index({ teacherId: 1, labelKey: 1 }, { unique: true });

export default mongoose.models.PerformanceCategory ||
  mongoose.model("PerformanceCategory", performanceCategorySchema);
