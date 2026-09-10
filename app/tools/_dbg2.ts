import { readFileSync } from 'node:fs';
import { gradeQuestion } from '../src/engine/grader';
import { buildSampleAssignment } from '../src/devData/sampleData';
const a = buildSampleAssignment();
console.log(a.questions[0].label, a.questions[0].buildMode, JSON.stringify(a.questions[0].test_cases));
