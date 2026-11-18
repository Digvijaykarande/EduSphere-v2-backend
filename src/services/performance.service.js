import crypto from "crypto";
import mongoose from "mongoose";
import AppError from "../utils/AppError.js";
import Student from "../models/Student.js";
import Teacher from "../models/Teacher.js";
import Section from "../models/Section.js";
import TeacherAssignment from "../models/TeacherAssignment.js";
import Exam from "../models/Exam.js";
import ExamResult from "../models/ExamResult.js";
import PerformanceCategory from "../models/PerformanceCategory.js";
import PerformanceSettings from "../models/PerformanceSettings.js";
import PerformanceEvent from "../models/PerformanceEvent.js";
import { computeResult } from "../utils/grading.js";
import { r2, pointsToMarks, byRoll, assignRanks, escapeRegex } from "../utils/performance.js";

const OID = (v) => new mongoose.Types.ObjectId(String(v));
const sid = (schoolId) => schoolId?._id || schoolId;
const fullName = (p) => [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || "Student";

// ---------------------------------------------------------------------------
// Lookups & ownership
// ---------------------------------------------------------------------------

async function getTeacher(schoolId, userId) {
  const teacher = await Teacher.findOne({ userId, schoolId: sid(schoolId) }).select("_id firstName lastName");
  if (!teacher) throw new AppError("Teacher profile not found", 404);
  return teacher;
}

// A teacher may only touch sections they actively teach (403 otherwise).
async function assertOwnsSection(schoolId, teacherId, sectionId) {
  const assignments = await TeacherAssignment.find({ schoolId: sid(schoolId), teacherId, sectionId, isActive: true });
  if (!assignments.length) throw new AppError("You are not assigned to this section", 403);
  return assignments;
}

async function getStudentByUser(schoolId, userId) {
  const student = await Student.findOne({ userId, schoolId: sid(schoolId) }).select(
    "_id firstName lastName rollNumber sectionId gradeClass section"
  );
  if (!student) throw new AppError("Student profile not found", 404);
  return student;
}

async function getRoster(schoolId, sectionId) {
  const students = await Student.find({ schoolId: sid(schoolId), sectionId, status: "ACTIVE" }).select(
    "_id firstName lastName rollNumber"
  );
  return students.sort(byRoll).map((s) => ({ id: String(s._id), name: fullName(s), roll: s.rollNumber || "" }));
}

async function getSettingsDoc(teacherId) {
  const s = await PerformanceSettings.findOne({ teacherId });
  return serializeSettings(s);
}

const serializeCategory = (c) => ({
  id: String(c._id),
  label: c.label,
  points: c.points,
  purpose: c.purpose || "",
});

const serializeSettings = (s) => ({
  marksEnabled: !!s?.marksEnabled,
  totalMarks: s?.totalMarks ?? null,
  pointsForFull: s?.pointsForFull ?? null,
});

const serializeEvent = (e) => ({
  id: String(e._id),
  studentId: String(e.studentId),
  studentName: e.studentName,
  rollNumber: e.rollNumber,
  label: e.label,
  points: e.points,
  categoryId: e.categoryId ? String(e.categoryId) : null,
  batchId: e.batchId,
  createdAt: e.createdAt,
});

// ---------------------------------------------------------------------------
// Leaderboard core (shared by teacher + student views)
// ---------------------------------------------------------------------------

async function buildLeaderboard({ roster, match, from, to, prevFrom, prevTo, settings, withTopCategory }) {
  const base = { ...match, deletedAt: null };
  const groupBy = { _id: { s: "$studentId", l: "$label" }, points: { $sum: "$points" }, count: { $sum: 1 } };

  const [cur, prev] = await Promise.all([
    PerformanceEvent.aggregate([{ $match: { ...base, createdAt: { $gte: from, $lt: to } } }, { $group: groupBy }]),
    prevFrom && prevTo
      ? PerformanceEvent.aggregate([
          { $match: { ...base, createdAt: { $gte: prevFrom, $lt: prevTo } } },
          { $group: { _id: "$studentId", points: { $sum: "$points" } } },
        ])
      : Promise.resolve([]),
  ]);

  const stats = new Map();
  for (const g of cur) {
    const key = String(g._id.s);
    const st = stats.get(key) || { points: 0, count: 0, labels: new Map() };
    st.points += g.points;
    st.count += g.count;
    st.labels.set(g._id.l, (st.labels.get(g._id.l) || 0) + g.count);
    stats.set(key, st);
  }
  const prevMap = new Map(prev.map((p) => [String(p._id), r2(p.points)]));

  const rows = roster.map((s) => {
    const st = stats.get(s.id);
    const points = r2(st?.points || 0);
    const prevPoints = prevMap.get(s.id) || 0;
    let topCategory = null;
    if (withTopCategory && st) {
      topCategory = [...st.labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    }
    return {
      id: s.id,
      name: s.name,
      roll: s.roll,
      points,
      count: st?.count || 0,
      prev: prevPoints,
      delta: r2(points - prevPoints),
      marks: pointsToMarks(points, settings),
      topCategory,
    };
  });

  assignRanks(rows);
  return {
    rows,
    maxPoints: Math.max(0, ...rows.map((r) => r.points)),
    totalPoints: r2(rows.reduce((sum, r) => sum + r.points, 0)),
  };
}

// ---------------------------------------------------------------------------
// Teacher: setup (categories + settings)
// ---------------------------------------------------------------------------

export async function getSetup(schoolId, userId) {
  const teacher = await getTeacher(schoolId, userId);
  const [categories, settings] = await Promise.all([
    PerformanceCategory.find({ teacherId: teacher._id }).sort({ createdAt: 1 }),
    getSettingsDoc(teacher._id),
  ]);
  return { categories: categories.map(serializeCategory), settings };
}

export async function createCategory(schoolId, userId, data) {
  const teacher = await getTeacher(schoolId, userId);
  try {
    const cat = await PerformanceCategory.create({
      schoolId: sid(schoolId),
      teacherId: teacher._id,
      label: data.label,
      labelKey: data.label.toLowerCase(),
      points: data.points,
      purpose: data.purpose || "",
    });
    return serializeCategory(cat);
  } catch (err) {
    if (err?.code === 11000) throw new AppError("A category with this name already exists", 409);
    throw err;
  }
}

export async function updateCategory(schoolId, userId, categoryId, patch) {
  const teacher = await getTeacher(schoolId, userId);
  const cat = await PerformanceCategory.findOne({ _id: categoryId, teacherId: teacher._id });
  if (!cat) throw new AppError("Category not found", 404);
  if (patch.label !== undefined) {
    cat.label = patch.label;
    cat.labelKey = patch.label.toLowerCase();
  }
  if (patch.points !== undefined) cat.points = patch.points;
  if (patch.purpose !== undefined) cat.purpose = patch.purpose;
  try {
    await cat.save();
  } catch (err) {
    if (err?.code === 11000) throw new AppError("A category with this name already exists", 409);
    throw err;
  }
  return serializeCategory(cat);
}

export async function deleteCategory(schoolId, userId, categoryId) {
  const teacher = await getTeacher(schoolId, userId);
  const cat = await PerformanceCategory.findOneAndDelete({ _id: categoryId, teacherId: teacher._id });
  if (!cat) throw new AppError("Category not found", 404);
  // History keeps its label/points snapshots; just detach the link.
  await PerformanceEvent.updateMany({ categoryId: cat._id }, { $set: { categoryId: null } });
  return { id: String(cat._id) };
}

export async function saveSettings(schoolId, userId, data) {
  const teacher = await getTeacher(schoolId, userId);
  const update = data.marksEnabled
    ? { marksEnabled: true, totalMarks: r2(data.totalMarks), pointsForFull: r2(data.pointsForFull) }
    : { marksEnabled: false, totalMarks: data.totalMarks ?? null, pointsForFull: data.pointsForFull ?? null };
  const doc = await PerformanceSettings.findOneAndUpdate(
    { teacherId: teacher._id },
    { $set: update, $setOnInsert: { schoolId: sid(schoolId) } },
    { new: true, upsert: true }
  );
  return serializeSettings(doc);
}

// ---------------------------------------------------------------------------
// Teacher: scoring
// ---------------------------------------------------------------------------

export async function getSectionSummary(schoolId, userId, sectionId, q) {
  const teacher = await getTeacher(schoolId, userId);
  await assertOwnsSection(schoolId, teacher._id, sectionId);

  const base = { teacherId: teacher._id, sectionId: OID(sectionId), deletedAt: null };
  const group = { _id: "$studentId", points: { $sum: "$points" }, count: { $sum: 1 } };
  const [today, week] = await Promise.all([
    PerformanceEvent.aggregate([{ $match: { ...base, createdAt: { $gte: q.todayFrom, $lt: q.todayTo } } }, { $group: group }]),
    PerformanceEvent.aggregate([{ $match: { ...base, createdAt: { $gte: q.weekFrom, $lt: q.weekTo } } }, { $group: group }]),
  ]);

  const map = new Map();
  const slot = (id) => {
    if (!map.has(id)) map.set(id, { studentId: id, today: { points: 0, count: 0 }, week: { points: 0, count: 0 } });
    return map.get(id);
  };
  today.forEach((g) => (slot(String(g._id)).today = { points: r2(g.points), count: g.count }));
  week.forEach((g) => (slot(String(g._id)).week = { points: r2(g.points), count: g.count }));
  return { students: [...map.values()] };
}

export async function awardPoints(schoolId, userId, data) {
  const teacher = await getTeacher(schoolId, userId);
  await assertOwnsSection(schoolId, teacher._id, data.sectionId);

  const studentIds = [...new Set(data.studentIds)];
  const students = await Student.find({
    _id: { $in: studentIds },
    schoolId: sid(schoolId),
    sectionId: data.sectionId,
    status: "ACTIVE",
  }).select("_id firstName lastName rollNumber");
  if (students.length !== studentIds.length) {
    throw new AppError("Some selected students are not active in this section", 400);
  }

  let label;
  let points;
  let category = null;

  if (data.categoryId) {
    category = await PerformanceCategory.findOne({ _id: data.categoryId, teacherId: teacher._id });
    if (!category) throw new AppError("Category not found", 404);
    ({ label, points } = category);
  } else {
    label = data.label;
    points = data.points;
    if (data.saveAsCategory) {
      category = await PerformanceCategory.findOne({ teacherId: teacher._id, labelKey: label.toLowerCase() });
      if (category) throw new AppError("A category with this name already exists", 409);
      category = await PerformanceCategory.create({
        schoolId: sid(schoolId),
        teacherId: teacher._id,
        label,
        labelKey: label.toLowerCase(),
        points,
      });
    }
  }

  const batchId = crypto.randomUUID();
  const docs = students.map((s) => ({
    schoolId: sid(schoolId),
    teacherId: teacher._id,
    sectionId: data.sectionId,
    studentId: s._id,
    categoryId: category?._id || null,
    label,
    points,
    studentName: fullName(s),
    rollNumber: s.rollNumber || "",
    batchId,
    awardedBy: userId,
  }));
  await PerformanceEvent.insertMany(docs);

  return {
    batchId,
    count: docs.length,
    label,
    points,
    category: category ? serializeCategory(category) : null,
  };
}

export async function getTeacherLeaderboard(schoolId, userId, sectionId, q) {
  const teacher = await getTeacher(schoolId, userId);
  await assertOwnsSection(schoolId, teacher._id, sectionId);
  const [roster, settings] = await Promise.all([getRoster(schoolId, sectionId), getSettingsDoc(teacher._id)]);

  const board = await buildLeaderboard({
    roster,
    match: { teacherId: teacher._id, sectionId: OID(sectionId) },
    from: q.from,
    to: q.to,
    prevFrom: q.prevFrom,
    prevTo: q.prevTo,
    settings,
    withTopCategory: true,
  });
  return { ...board, settings };
}

export async function getTeacherHistory(schoolId, userId, sectionId, q) {
  const teacher = await getTeacher(schoolId, userId);
  await assertOwnsSection(schoolId, teacher._id, sectionId);

  const match = { teacherId: teacher._id, sectionId: OID(sectionId), deletedAt: null };
  if (q.from) match.createdAt = { $gte: q.from };
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), "i");
    match.$or = [{ studentName: rx }, { rollNumber: rx }, { label: rx }];
  }

  const [events, agg] = await Promise.all([
    PerformanceEvent.find(match)
      .sort({ createdAt: -1, _id: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit),
    PerformanceEvent.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: 1 }, net: { $sum: "$points" } } },
    ]),
  ]);
  const total = agg[0]?.total || 0;
  return {
    events: events.map(serializeEvent),
    total,
    netPoints: r2(agg[0]?.net || 0),
    page: q.page,
    hasMore: q.page * q.limit < total,
  };
}

export async function deleteEvent(schoolId, userId, eventId) {
  const teacher = await getTeacher(schoolId, userId);
  const ev = await PerformanceEvent.findOneAndUpdate(
    { _id: eventId, teacherId: teacher._id, deletedAt: null },
    { $set: { deletedAt: new Date(), deletedBy: userId } },
    { new: true }
  );
  if (!ev) throw new AppError("Entry not found", 404);
  return serializeEvent(ev);
}

export async function restoreEvent(schoolId, userId, eventId) {
  const teacher = await getTeacher(schoolId, userId);
  const ev = await PerformanceEvent.findOneAndUpdate(
    { _id: eventId, teacherId: teacher._id, deletedAt: { $ne: null } },
    { $set: { deletedAt: null, deletedBy: null } },
    { new: true }
  );
  if (!ev) throw new AppError("Entry not found", 404);
  return serializeEvent(ev);
}

export async function undoBatch(schoolId, userId, batchId) {
  const teacher = await getTeacher(schoolId, userId);
  const res = await PerformanceEvent.updateMany(
    { teacherId: teacher._id, batchId, deletedAt: null },
    { $set: { deletedAt: new Date(), deletedBy: userId } }
  );
  if (!res.modifiedCount) throw new AppError("Nothing to undo", 404);
  return { removed: res.modifiedCount };
}

// ---------------------------------------------------------------------------
// Teacher: export to exam gradebook (internal marks)
// ---------------------------------------------------------------------------

export async function listExportableExams(schoolId, userId, sectionId) {
  const teacher = await getTeacher(schoolId, userId);
  const assignments = await assertOwnsSection(schoolId, teacher._id, sectionId);
  const subjects = [...new Set(assignments.flatMap((a) => a.subjects))];

  const exams = await Exam.find({
    schoolId: sid(schoolId),
    sections: sectionId,
    subject: { $in: subjects },
    status: { $ne: "Cancelled" },
    resultsStatus: { $ne: "Published" },
  })
    .sort({ date: -1 })
    .limit(50)
    .select("slug title subject type maxMarks date resultsStatus");

  return {
    exams: exams.map((e) => ({
      id: String(e._id),
      slug: e.slug,
      title: e.title,
      subject: e.subject,
      type: e.type,
      maxMarks: e.maxMarks,
      date: e.date,
      resultsStatus: e.resultsStatus,
    })),
  };
}

export async function exportToExam(schoolId, userId, sectionId, data) {
  const teacher = await getTeacher(schoolId, userId);
  const assignments = await assertOwnsSection(schoolId, teacher._id, sectionId);
  const settings = await getSettingsDoc(teacher._id);
  if (!settings.marksEnabled || !settings.totalMarks || !settings.pointsForFull) {
    throw new AppError("Turn on marks weightage in Setup before exporting to the gradebook", 400);
  }

  const isOid = /^[a-f\d]{24}$/i.test(data.examId);
  const exam = await Exam.findOne({
    schoolId: sid(schoolId),
    ...(isOid ? { _id: data.examId } : { slug: data.examId }),
  });
  if (!exam) throw new AppError("Exam not found", 404);
  if (!exam.sections.some((s) => String(s) === String(sectionId))) {
    throw new AppError("This exam is not scheduled for the selected section", 400);
  }
  if (!assignments.some((a) => a.subjects.includes(exam.subject))) {
    throw new AppError("You don't teach this exam's subject in the selected section", 403);
  }
  if (exam.status === "Cancelled") throw new AppError("This exam was cancelled", 409);
  if (exam.resultsStatus === "Published") {
    throw new AppError("Results are already published for this exam; marks can't be changed", 409);
  }

  const roster = await getRoster(schoolId, sectionId);
  const board = await buildLeaderboard({
    roster,
    match: { teacherId: teacher._id, sectionId: OID(sectionId) },
    from: data.from,
    to: data.to,
    settings,
    withTopCategory: false,
  });

  const existing = await ExamResult.find({
    examId: exam._id,
    studentId: { $in: roster.map((r) => r.id) },
    marksObtained: { $ne: null },
  }).select("studentId");
  const hasMarks = new Set(existing.map((e) => String(e.studentId)));

  const toWrite = board.rows.filter((r) => data.overwrite || !hasMarks.has(r.id));
  const skipped = board.rows.length - toWrite.length;
  const summary = {
    examId: String(exam._id),
    examSlug: exam.slug,
    examTitle: exam.title,
    maxMarks: exam.maxMarks,
    total: board.rows.length,
    existing: hasMarks.size,
    willWrite: toWrite.length,
    skipped,
  };
  if (data.dryRun) return { dryRun: true, ...summary };

  const now = new Date();
  const ops = toWrite.map((r) => {
    const marksObtained = r2((r.marks / settings.totalMarks) * exam.maxMarks);
    const { grade, isPassed } = computeResult({
      marksObtained,
      maxMarks: exam.maxMarks,
      passingMarks: exam.passingMarks,
    });
    return {
      updateOne: {
        filter: { examId: exam._id, studentId: OID(r.id) },
        update: {
          $set: { marksObtained, grade, isPassed, enteredBy: userId, enteredAt: now },
          $setOnInsert: { schoolId: sid(schoolId), sectionId: OID(sectionId) },
        },
        upsert: true,
      },
    };
  });
  if (ops.length) await ExamResult.bulkWrite(ops);

  const entered = await ExamResult.countDocuments({ examId: exam._id, marksObtained: { $ne: null } });
  exam.resultsStatus = entered === 0 ? "Not Started" : "Processing";
  await exam.save();

  return { dryRun: false, ...summary, written: ops.length };
}

// ---------------------------------------------------------------------------
// Teacher: dashboard snapshot
// ---------------------------------------------------------------------------

export async function getTeacherSnapshot(schoolId, userId, q) {
  const teacher = await getTeacher(schoolId, userId);
  const groups = await PerformanceEvent.aggregate([
    { $match: { teacherId: teacher._id, deletedAt: null, createdAt: { $gte: q.from, $lt: q.to } } },
    { $group: { _id: "$studentId", points: { $sum: "$points" }, count: { $sum: 1 }, name: { $first: "$studentName" } } },
  ]);
  const top = [...groups].sort((a, b) => b.points - a.points)[0];
  return {
    points: r2(groups.reduce((s, g) => s + g.points, 0)),
    awards: groups.reduce((s, g) => s + g.count, 0),
    students: groups.length,
    top: top && top.points > 0 ? { name: top.name, points: r2(top.points) } : null,
  };
}

// ---------------------------------------------------------------------------
// Student views
// ---------------------------------------------------------------------------

async function sectionTeachers(schoolId, sectionId) {
  const assignments = await TeacherAssignment.find({ schoolId: sid(schoolId), sectionId, isActive: true });
  const ids = [...new Set(assignments.map((a) => String(a.teacherId)))];
  const [teachers, settingsDocs] = await Promise.all([
    Teacher.find({ _id: { $in: ids } }).select("_id firstName lastName"),
    PerformanceSettings.find({ teacherId: { $in: ids } }),
  ]);
  const settingsBy = new Map(settingsDocs.map((s) => [String(s.teacherId), serializeSettings(s)]));
  return teachers.map((t) => ({
    id: String(t._id),
    name: fullName(t),
    subjects: [...new Set(assignments.filter((a) => String(a.teacherId) === String(t._id)).flatMap((a) => a.subjects))],
    settings: settingsBy.get(String(t._id)) || serializeSettings(null),
  }));
}

export async function getStudentOverview(schoolId, userId, q) {
  const student = await getStudentByUser(schoolId, userId);
  if (!student.sectionId) throw new AppError("You haven't been assigned to a class yet", 404);

  const [section, teachers, roster] = await Promise.all([
    Section.findById(student.sectionId).select("gradeClass section"),
    sectionTeachers(schoolId, student.sectionId),
    getRoster(schoolId, student.sectionId),
  ]);

  let teacher = null;
  if (q.teacherId) {
    teacher = teachers.find((t) => t.id === q.teacherId);
    if (!teacher) throw new AppError("That teacher doesn't teach your class", 400);
  }

  const match = { sectionId: student.sectionId, ...(teacher ? { teacherId: OID(teacher.id) } : {}) };
  const settings = teacher?.settings || serializeSettings(null);

  const board = await buildLeaderboard({
    roster,
    match: { ...match, schoolId: OID(sid(schoolId)) },
    from: q.from,
    to: q.to,
    prevFrom: q.prevFrom,
    prevTo: q.prevTo,
    settings,
    withTopCategory: false, // never expose classmates' individual reasons
  });

  const meId = String(student._id);
  const me = board.rows.find((r) => r.id === meId) || null;
  return {
    section: section ? { id: String(section._id), label: `${section.gradeClass}-${section.section}` } : null,
    teachers: teachers.map((t) => ({ id: t.id, name: t.name, subjects: t.subjects, marksEnabled: t.settings.marksEnabled })),
    teacherId: teacher?.id || null,
    settings,
    meId,
    me,
    classSize: roster.length,
    ...board,
  };
}

export async function getStudentHistory(schoolId, userId, q) {
  const student = await getStudentByUser(schoolId, userId);
  const match = { studentId: student._id, deletedAt: null };
  if (q.from) match.createdAt = { $gte: q.from };

  const [events, agg] = await Promise.all([
    PerformanceEvent.find(match)
      .sort({ createdAt: -1, _id: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .select("label points createdAt teacherId"),
    PerformanceEvent.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: 1 }, net: { $sum: "$points" } } }]),
  ]);

  const teacherIds = [...new Set(events.map((e) => String(e.teacherId)))];
  const teachers = await Teacher.find({ _id: { $in: teacherIds } }).select("_id firstName lastName");
  const names = new Map(teachers.map((t) => [String(t._id), fullName(t)]));
  const total = agg[0]?.total || 0;

  return {
    events: events.map((e) => ({
      id: String(e._id),
      label: e.label,
      points: e.points,
      createdAt: e.createdAt,
      teacherName: names.get(String(e.teacherId)) || "Teacher",
    })),
    total,
    netPoints: r2(agg[0]?.net || 0),
    page: q.page,
    hasMore: q.page * q.limit < total,
  };
}
