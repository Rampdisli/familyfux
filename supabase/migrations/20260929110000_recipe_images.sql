-- Recipe pictures in our own storage: the MCP recipe import copies a recipe's
-- picture here instead of pointing at the recipe site, so it stays even if the
-- original page goes away. recipes.image_url then holds the public URL of the
-- copy, so the app shows it like any other picture.
--
-- Files live under <family_id>/<random>.<ext>. The bucket is public (the
-- random file names aren't guessable, and recipe pictures aren't private);
-- only members of the family can add or remove files in its folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recipe-images',
  'recipe-images',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
);

-- Compared as text: a folder name that isn't a uuid is simply refused.
create policy "Members can add pictures to their family's recipe folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] in (
      select family_id::text from public.family_members where user_id = (select auth.uid())
    )
  );

-- E.g. when saving the recipe fails after its picture was uploaded.
create policy "Members can remove pictures from their family's recipe folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] in (
      select family_id::text from public.family_members where user_id = (select auth.uid())
    )
  );

-- Removing goes through select (DELETE … RETURNING); public URLs don't need it.
create policy "Members can see their family's recipe pictures"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] in (
      select family_id::text from public.family_members where user_id = (select auth.uid())
    )
  );
