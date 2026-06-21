const axios  = require('axios');
const FormData = require('form-data');

const BASE = () => process.env.BACKEND_URL;

// ── Auth ──────────────────────────────────────────────────────────────────────

async function login(email, password) {
  // /api/auth/login is the unified endpoint (Admin, HOA, Secretary, Teacher, Principal)
  const { data } = await axios.post(`${BASE()}/api/auth/login`, { email, password });
  return data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function headers(token) {
  return { Authorization: `Bearer ${token}` };
}

// ── Classes ───────────────────────────────────────────────────────────────────

async function getClasses(token) {
  const { data } = await axios.get(`${BASE()}/api/admin/classes`, { headers: headers(token) });
  return data.classes || [];
}

/** Classes assigned to the logged-in teacher */
async function getMyClasses(token) {
  try {
    const { data } = await axios.get(`${BASE()}/api/admin/my-classes`, { headers: headers(token) });
    return data.classes || data.teacherClasses || [];
  } catch {
    // Fallback: return all classes if endpoint differs
    return getClasses(token);
  }
}

// ── Students ──────────────────────────────────────────────────────────────────

/**
 * Get students for a specific class via the results endpoint
 * Returns: { className, students: [{ fullname, registrationNumber, ... }] }
 */
async function getClassStudents(token, classId) {
  const { data } = await axios.get(
    `${BASE()}/api/results/class-students/${classId}`,
    { headers: headers(token) }
  );
  return { className: data.className, students: data.students || [] };
}

/** All students (optionally filtered by classId) */
async function getAllStudents(token, classId) {
  const params = classId ? { classId } : {};
  const { data } = await axios.get(`${BASE()}/api/admin/students`, {
    headers: headers(token),
    params,
  });
  return data.students || [];
}

/**
 * Search students by name, reg number, or email.
 * @param {string} q        - search term (min 1 char)
 * @param {string} classId  - optional class filter
 * @param {number} limit    - max results (default 20)
 */
async function searchStudents(token, q, classId, limit = 20) {
  const params = { q, limit };
  if (classId) params.classId = classId;
  const { data } = await axios.get(`${BASE()}/api/admin/students/search`, {
    headers: headers(token),
    params,
  });
  return data.students || [];
}

/** Get a single student's full details by MongoDB _id */
async function getStudentById(token, studentId) {
  const { data } = await axios.get(`${BASE()}/api/admin/students/${studentId}`, {
    headers: headers(token),
  });
  return data.student;
}

// ── Results ───────────────────────────────────────────────────────────────────

/**
 * Upload result Excel to the backend.
 * @param {string} token   - teacher JWT
 * @param {Buffer} fileBuffer - cleaned Excel buffer (xlsx)
 * @param {string} fileName
 * @param {string} classId
 * @param {string} term
 * @param {string} session
 */
async function uploadResults(token, fileBuffer, fileName, classId, term, session) {
  const form = new FormData();
  form.append('file', fileBuffer, { filename: fileName, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  form.append('classId', classId);
  form.append('term', term);
  form.append('session', session);

  const { data } = await axios.post(`${BASE()}/api/results/upload`, form, {
    headers: {
      ...headers(token),
      ...form.getHeaders(),
    },
  });
  return data;
}

// ── Payments ──────────────────────────────────────────────────────────────────

async function getPaidStudents(token) {
  const { data } = await axios.get(`${BASE()}/api/fees/paid-students`, {
    headers: headers(token),
  });
  return data.payments || [];
}

module.exports = {
  login,
  getClasses,
  getMyClasses,
  getClassStudents,
  getAllStudents,
  searchStudents,
  getStudentById,
  uploadResults,
  getPaidStudents,
};
