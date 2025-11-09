import { vol } from 'memfs';
import matter from 'gray-matter';

const knowledgeModule = await import(new URL('../packages/backend/src/knowledgeService.js', import.meta.url));
const constitutionModule = await import(new URL('../packages/backend/src/constitutionService.js', import.meta.url));

const { listArtefacts, getArtefact } = knowledgeModule;
const { listConstitutions, getConstitution } = constitutionModule;

process.env.MADE_HOME = '/home';

beforeEach(() => {
  vol.reset();
});

test('lists artefacts from .made/knowledge', async () => {
  const doc = matter.stringify('# Internal\nContent body', { type: 'internal', tags: ['rules'] });
  const web = matter.stringify('https://example.com', { type: 'external', tags: ['ref'] });
  vol.fromJSON({
    '/home/.made/knowledge/internal.md': doc,
    '/home/.made/knowledge/external.md': web
  });

  const artefacts = await listArtefacts({ fs: vol.promises });
  expect(artefacts.map((a) => a.name)).toEqual(['external.md', 'internal.md']);
  const internal = artefacts.find((a) => a.name === 'internal.md');
  expect(internal.type).toBe('internal');
  expect(internal.tags).toContain('rules');

  const readBack = await getArtefact('internal.md', { fs: vol.promises });
  expect(readBack.content.trim()).toContain('Content body');
});

test('lists constitutions from .made/constitutions', async () => {
  const base = matter.stringify('Guidelines', { scope: 'global' });
  vol.fromJSON({
    '/home/.made/constitutions/base.md': base
  });

  const constitutions = await listConstitutions({ fs: vol.promises });
  expect(constitutions).toHaveLength(1);
  expect(constitutions[0].name).toBe('base.md');

  const loaded = await getConstitution('base.md', { fs: vol.promises });
  expect(loaded.data.scope).toBe('global');
});
