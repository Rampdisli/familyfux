import { amountText, boughtText, pluralUnit, rewardSummary, unitText } from './rewards';

const tablet = { title: 'Tabletzeit', price: 20, unit_amount: 5, unit_label: 'Minuten', description: null, max_quantity: 6 };
const episode = { title: 'Serienfolge', price: 30, unit_amount: 1, unit_label: 'Folge', description: null, max_quantity: 3 };
const dessert = { title: 'Dessert aussuchen', price: 25, unit_amount: null, unit_label: null, description: 'beim Abendessen', max_quantity: 1 };

describe('reward texts', () => {
  it('pluralises unit labels ending in "e"', () => {
    expect(pluralUnit('Folge', 1)).toBe('Folge');
    expect(pluralUnit('Folge', 2)).toBe('Folgen');
    expect(pluralUnit('Minuten', 15)).toBe('Minuten');
  });

  it('describes amounts and cards', () => {
    expect(amountText(tablet, 3)).toBe('15 Minuten');
    expect(amountText(episode, 2)).toBe('2 Folgen');
    expect(unitText(tablet)).toBe('5 Minuten');
    expect(unitText(episode)).toBe('1 Folge');
    expect(unitText(dessert)).toBe('beim Abendessen');
  });

  it('describes what was bought', () => {
    expect(boughtText(tablet, 3)).toBe('15 Minuten Tabletzeit');
    expect(boughtText(dessert, 1)).toBe('Dessert aussuchen');
  });

  it('summarises the form like the prototype', () => {
    expect(rewardSummary(tablet)).toBe('Im Shop: 20 ⭐ für 5 Minuten · bis 6× pro Kauf = 30 Minuten für 120 ⭐.');
    expect(rewardSummary({ ...tablet, max_quantity: 1 })).toBe('Im Shop: 20 ⭐ für 5 Minuten.');
    expect(rewardSummary(dessert)).toBe('Im Shop: „Dessert aussuchen“ für 25 ⭐, einmal pro Kauf.');
    expect(rewardSummary({ ...tablet, unit_label: ' ' })).toBe('Menge und Einheit ausfüllen.');
    expect(rewardSummary({ ...dessert, title: '' })).toBe('Im Shop: „Neue Belohnung“ für 25 ⭐, einmal pro Kauf.');
  });
});
