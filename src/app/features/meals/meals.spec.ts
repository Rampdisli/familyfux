import { storedImagePath } from './meals';

describe('storedImagePath', () => {
  const base = 'https://abc.supabase.co';

  it('reads <family>/<file> from our bucket', () => {
    expect(storedImagePath(`${base}/storage/v1/object/public/recipe-images/fam-1/a8f3.jpg`, base)).toBe('fam-1/a8f3.jpg');
    expect(storedImagePath(`${base}/storage/v1/object/public/recipe-images/fam-1/a%20b.jpg?t=1`, base + '/')).toBe(
      'fam-1/a b.jpg',
    );
  });

  it('ignores pictures elsewhere', () => {
    expect(storedImagePath('https://fooby.ch/bild.jpg', base)).toBeNull();
    expect(storedImagePath(`https://other.supabase.co/storage/v1/object/public/recipe-images/fam-1/a.jpg`, base)).toBeNull();
    expect(storedImagePath(`${base}/storage/v1/object/public/other-bucket/fam-1/a.jpg`, base)).toBeNull();
    expect(storedImagePath(`${base}/storage/v1/object/public/recipe-images/a.jpg`, base)).toBeNull();
    expect(storedImagePath(null, base)).toBeNull();
  });
});
