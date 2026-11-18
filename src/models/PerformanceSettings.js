import mongoose from "mongoose";

// Optional points -> marks conversion, one document per teacher.
const performanceSettingsSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true, unique: true },
    marksEnabled: { type: Boolean, default: false },
    totalMarks: { type: Number, default: null },
    pointsForFull: { type: Number, default: null },
  },
  { timestamps: true }
);

export default mongoose.models.PerformanceSettings ||
  mongoose.model("PerformanceSettings", performanceSettingsSchema);
