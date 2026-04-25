-- Asset lineage tracking — JSON-serialized AssetSource[].
--
-- Each entry: { assetId, role }. Roles:
--   - 'edit-source' : single upstream asset for image-editor / video-clipper output
--   - 'reference'   : reference image fed into image-gen / video-gen
--   - 'primary'     : primary input image for image-to-video generation
--
-- NULL on uploads, pre-existing rows, and any path that hasn't backfilled.
-- Not a query predicate (no WHERE / ORDER BY) → JSON column, no index.

ALTER TABLE `assets` ADD COLUMN `sources` TEXT;
