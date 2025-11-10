const fs = require('fs');
const path = require('path');
const os = require('os');

const SAMPLE_CONTENT = `---
title: Demo Artefact
tags:
  - research
  - demo
type: internal
---

# Demo
`;

describe('knowledgeService', () => {
  let madeHome;
  let knowledgeService;

  beforeEach(() => {
    madeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'made-home-'));
    process.env.MADE_HOME = madeHome;
    jest.resetModules();
    knowledgeService = require('../packages/backend/src/knowledgeService');
    const knowledgeDir = path.join(madeHome, '.made', 'knowledge');
    fs.mkdirSync(knowledgeDir, { recursive: true });
    fs.writeFileSync(path.join(knowledgeDir, 'demo.md'), SAMPLE_CONTENT);
  });

  afterEach(() => {
    fs.rmSync(madeHome, { recursive: true, force: true });
  });

  it('lists knowledge artefacts with metadata', () => {
    const artefacts = knowledgeService.listKnowledgeArtefacts();
    expect(artefacts).toHaveLength(1);
    expect(artefacts[0].name).toBe('demo.md');
    expect(artefacts[0].tags).toEqual(['research', 'demo']);
    expect(artefacts[0].type).toBe('internal');
  });

  it('reads and writes artefact content', () => {
    const artefact = knowledgeService.readKnowledgeArtefact('demo.md');
    expect(artefact.data.title).toBe('Demo Artefact');

    knowledgeService.writeKnowledgeArtefact('demo.md', { title: 'Updated', type: 'external' }, '# Updated');
    const updated = knowledgeService.readKnowledgeArtefact('demo.md');
    expect(updated.data.title).toBe('Updated');
    expect(updated.data.type).toBe('external');
  });
});
