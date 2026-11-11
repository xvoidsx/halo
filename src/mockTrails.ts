// MOCK TRAIL DATA — placeholder only.
//
// No real trail exists yet (Raven is setting up the Entire CLI and the
// first test repo). This data exists so the Trails view can be built and
// benched before any live backend lands. Everything rendered from here
// must carry the MOCK badge in the UI. Delete this file (and its imports)
// the moment real trail data flows through the herdr/Entire adapter.

import type { Trail } from './types.js';

export const mockTrails: Trail[] = [
  {
    id: 'trail-docs-typo',
    title: 'Fix typo in README quickstart',
    repo: 'xvoidsx/halo',
    branch: 'trail/docs-typo',
    status: 'green',
    agent: 'opencode',
    scores: { security: 98, slop: 4, humanReview: 96, confidence: 94, risk: 'low' },
    findings: [
      {
        id: 'f1',
        severity: 'low',
        status: 'fixed',
        file: 'README.md',
        message: 'Quickstart linked the old settings path.',
        suggestedFix: 'Point the link at the new settings section.',
      },
    ],
    sessions: [
      { id: 'c1', at: '15:02', agent: 'opencode', kind: 'prompt', summary: 'Fix the broken quickstart link in README.' },
      { id: 'c2', at: '15:04', agent: 'opencode', kind: 'commit', summary: 'README: quickstart link → settings' },
      { id: 'c3', at: '15:05', agent: 'entire-security', kind: 'review', summary: 'No issues. Docs-only change.' },
    ],
    gates: [
      { name: 'Security review', status: 'approved', by: 'entire-security' },
      { name: 'Human approval', status: 'approved', by: 'rav3ndust' },
    ],
    runs: [
      { id: 'r3', at: '15:05', status: 'green', security: 98, slop: 4, humanReview: 96 },
      { id: 'r2', at: '15:04', status: 'green', security: 97, slop: 6, humanReview: 90 },
      { id: 'r1', at: '15:03', status: 'amber', security: 90, slop: 12, humanReview: 0 },
    ],
  },
  {
    id: 'trail-sidebar-theme',
    title: 'Nightshade sidebar polish',
    repo: 'xvoidsx/halo',
    branch: 'trail/sidebar-theme',
    status: 'review',
    agent: 'opencode',
    scores: { security: 91, slop: 18, humanReview: 72, confidence: 68, risk: 'medium' },
    findings: [
      {
        id: 'f1',
        severity: 'medium',
        status: 'addressing',
        file: 'src/theme.css',
        message: 'Hover state on trail rows is barely visible at small sizes.',
        suggestedFix: 'Raise the hover background to rgba(255,16,240,0.12) and add a 1px pink left edge.',
      },
      {
        id: 'f2',
        severity: 'low',
        status: 'open',
        file: 'src/App.tsx',
        message: 'Trail status pill uses the same pink as the accent; hard to scan.',
        suggestedFix: 'Use green for green trails, keep pink for the brand mark only.',
      },
      {
        id: 'f3',
        severity: 'info',
        status: 'dismissed',
        file: 'src/theme.css',
        message: 'Reviewer suggested a pure-black sidebar; current #0a0a0a is fine.',
        suggestedFix: 'No change.',
      },
    ],
    sessions: [
      { id: 'c1', at: '14:40', agent: 'opencode', kind: 'prompt', summary: 'Polish the trail sidebar: hover states, status pills.' },
      { id: 'c2', at: '14:52', agent: 'opencode', kind: 'commit', summary: 'Sidebar: hover + pill contrast' },
      { id: 'c3', at: '14:53', agent: 'entire-slop', kind: 'review', summary: '2 findings: hover contrast, pill colour.' },
      { id: 'c4', at: '15:01', agent: 'opencode', kind: 'commit', summary: 'Raise hover background, add pink left edge' },
    ],
    gates: [
      { name: 'Security review', status: 'approved', by: 'entire-security' },
      { name: 'Slop review', status: 'pending' },
      { name: 'Human approval', status: 'pending' },
    ],
    runs: [
      { id: 'r4', at: '15:01', status: 'amber', security: 91, slop: 18, humanReview: 72 },
      { id: 'r3', at: '14:53', status: 'amber', security: 88, slop: 24, humanReview: 60 },
      { id: 'r2', at: '14:52', status: 'red', security: 80, slop: 31, humanReview: 0 },
      { id: 'r1', at: '14:41', status: 'red', security: 75, slop: 40, humanReview: 0 },
    ],
  },
];
