import { DraftRow, deviationSummary, recipeEdit, rowStatus, webUrl } from './recipe-draft';

const row = (patch: Partial<DraftRow>): DraftRow => ({
  id: 'r1',
  quantity: '200 ml',
  name: 'Rahm',
  originalQuantity: '200 ml',
  originalName: 'Rahm',
  ...patch,
});

describe('recipe draft', () => {
  it('computes the status like recipe_ingredients.status', () => {
    expect(rowStatus(row({}))).toBe('original');
    expect(rowStatus(row({ quantity: ' 200 ml ' }))).toBe('original');
    expect(rowStatus(row({ name: 'Milch' }))).toBe('changed');
    expect(rowStatus(row({ quantity: '' }))).toBe('changed');
    expect(rowStatus(row({ name: null, quantity: '' }))).toBe('removed');
    expect(rowStatus(row({ id: undefined, originalName: null, originalQuantity: null }))).toBe('added');
  });

  it('summarises the deviations', () => {
    expect(deviationSummary([row({})])).toBe('wie im Original');
    expect(
      deviationSummary([row({ name: 'Milch' }), row({ name: 'Butter' }), row({ originalName: null }), row({ name: null })]),
    ).toBe('2 angepasst · 1 ergänzt · 1 weggelassen');
  });

  it('builds what update_recipe saves', () => {
    const edit = recipeEdit({
      title: ' Bolognese ',
      url: 'ftp://x',
      imageUrl: '',
      available: false,
      rows: [
        row({ name: 'Milch' }),
        row({ id: 'r2', name: '  ' }),
        row({ id: 'r3', name: null, quantity: '' }),
        row({ id: undefined, originalName: null, originalQuantity: null, quantity: '2', name: 'Karotten' }),
        row({ id: undefined, originalName: null, originalQuantity: null, quantity: '1', name: '' }),
      ],
    });
    expect(edit.title).toBe('Bolognese');
    expect(edit.url).toBeNull();
    expect(edit.ingredients).toEqual([
      { id: 'r1', quantity: '200 ml', name: 'Milch' },
      { id: 'r2', quantity: null, name: null },
      { id: 'r3', quantity: null, name: null },
      { quantity: '2', name: 'Karotten' },
    ]);
  });

  it('accepts only web links', () => {
    expect(webUrl(' https://fooby.ch/x ')).toBe('https://fooby.ch/x');
    expect(webUrl('javascript:alert(1)')).toBeNull();
    expect(webUrl('fooby.ch')).toBeNull();
  });
});
