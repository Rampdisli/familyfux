import { Ingredient, IngredientInput, Recipe, RecipeEdit, RecipeInput, IngredientStatus } from '../meals';

/** Only web links; anything else would end up in an href / background-image. */
export function webUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * One ingredient row of the recipe form. Rows loaded for editing keep their
 * id and what the original recipe said; new rows have neither (= added).
 */
export interface DraftRow {
  id?: string;
  quantity: string;
  /** null = left out (only rows from the original). */
  name: string | null;
  originalQuantity: string | null;
  /** null = added by the family. */
  originalName: string | null;
}

/** Unsaved values of "Rezept importieren" / "Rezept bearbeiten". */
export interface RecipeDraft {
  title: string;
  url: string;
  imageUrl: string;
  available: boolean;
  rows: DraftRow[];
}

export function emptyRow(): DraftRow {
  return { quantity: '', name: '', originalQuantity: null, originalName: null };
}

export function newRecipeDraft(): RecipeDraft {
  return { title: '', url: '', imageUrl: '', available: true, rows: [emptyRow()] };
}

export function recipeDraft(recipe: Recipe): RecipeDraft {
  return {
    title: recipe.title,
    url: recipe.url ?? '',
    imageUrl: recipe.image_url ?? '',
    available: recipe.ingredients_available,
    rows: recipe.ingredients.map((i: Ingredient) => ({
      id: i.id,
      quantity: i.quantity ?? '',
      name: i.name,
      originalQuantity: i.original_quantity,
      originalName: i.original_name,
    })),
  };
}

/** Like recipe_ingredients.status, while typing. */
export function rowStatus(row: DraftRow): IngredientStatus {
  if (row.originalName === null) return 'added';
  if (row.name === null) return 'removed';
  return (row.quantity.trim() || null) !== row.originalQuantity || row.name.trim() !== row.originalName
    ? 'changed'
    : 'original';
}

/** "2 angepasst · 1 ergänzt · 1 weggelassen" or "wie im Original" (as deviations() in recipe-detail). */
export function deviationSummary(rows: DraftRow[]): string {
  const count = (status: IngredientStatus) => rows.filter((r) => rowStatus(r) === status).length;
  const parts = [
    [count('changed'), 'angepasst'],
    [count('added'), 'ergänzt'],
    [count('removed'), 'weggelassen'],
  ]
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`);
  return parts.length ? parts.join(' · ') : 'wie im Original';
}

/** Rows with a name, as they are cooked (preview, create_recipe); a quantity alone isn't an ingredient. */
export function usedIngredients(rows: DraftRow[]): IngredientInput[] {
  return rows
    .filter((r) => r.name !== null)
    .map((r) => ({ quantity: r.quantity.trim() || null, name: (r.name ?? '').trim() }))
    .filter((r) => r.name);
}

/** What create_recipe saves. */
export function recipeInput(draft: RecipeDraft): RecipeInput {
  return {
    title: draft.title.trim(),
    url: webUrl(draft.url),
    image_url: webUrl(draft.imageUrl),
    ingredients: usedIngredients(draft.rows),
    ingredients_available: draft.available,
  };
}

/**
 * What update_recipe saves. Rows from the original with an empty name count as
 * left out; added rows without a name are dropped.
 */
export function recipeEdit(draft: RecipeDraft): RecipeEdit {
  return {
    title: draft.title.trim(),
    url: webUrl(draft.url),
    image_url: webUrl(draft.imageUrl),
    ingredients_available: draft.available,
    ingredients: draft.rows
      .map((r) => {
        const name = r.name?.trim() || null;
        return { ...(r.id ? { id: r.id } : {}), quantity: name ? r.quantity.trim() || null : null, name };
      })
      .filter((r) => r.id || r.name),
  };
}
